/**
 * Meta Marketing API → performance_spend_hours (platform META).
 * Account-level insights with time_increment=1 and the hourly breakdown
 * (hourly_stats_aggregated_by_advertiser_time_zone), converted from the ad
 * account's time zone to UTC hour buckets. Meta refuses hourly + country in one
 * request, so a second, daily request with breakdowns=country gives each day's
 * spend per country; every hour is pro-rated by that day's country shares and
 * each slice is stored with its country and the region it maps to (like orders).
 * Days without country rows fall back to the account's configured region
 * (country ""). Pulled in 60-day chunks; a chunk replaces the account's rows in
 * its window, and incremental runs re-pull the last 3 days so late-attributed
 * spend settles.
 * The token travels only in the Authorization header — never in a URL, so it
 * can't end up in logs, error messages or paging links.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "../db.js";
import type { PerformanceClientConfig } from "./config.js";
import { regionFor } from "./shopify.js";
import { backfillStart, dateChunks, sleep, zonedHourToUtcMs } from "./time.js";

export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v23.0";
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

interface InsightRow { date_start: string; spend?: string; impressions?: string; clicks?: string; hourly_stats_aggregated_by_advertiser_time_zone?: string; country?: string }

/** One day's spend per country, as shares of the day's total (country "" never appears here). */
export type CountryShares = Map<string, Array<{ country: string; share: number }>>;

/** Turn daily country rows into per-day shares; days with zero total are left out (→ fallback). */
export function countryShares(rows: InsightRow[]): CountryShares {
  const byDay = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const cc = (r.country ?? "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) continue;
    const day = byDay.get(r.date_start) ?? new Map<string, number>();
    day.set(cc, (day.get(cc) ?? 0) + Number(r.spend ?? 0));
    byDay.set(r.date_start, day);
  }
  const out: CountryShares = new Map();
  byDay.forEach((day, date) => {
    const total = Array.from(day.values()).reduce((a, b) => a + b, 0);
    if (total <= 0) return;
    out.set(date, Array.from(day.entries()).map(([country, v]) => ({ country, share: v / total })));
  });
  return out;
}

/** Split one hour's spend/impressions/clicks by the day's shares; the last slice takes the rounding remainder. */
export function splitHour(spend: number, impressions: number | null, clicks: number | null, shares: Array<{ country: string; share: number }>) {
  const out: Array<{ country: string; spend: number; impressions: number | null; clicks: number | null }> = [];
  let sSum = 0, iSum = 0, cSum = 0;
  shares.forEach((x, i) => {
    const last = i === shares.length - 1;
    const sp = last ? Math.round((spend - sSum) * 10000) / 10000 : Math.round(spend * x.share * 10000) / 10000;
    const im = impressions == null ? null : last ? impressions - iSum : Math.round(impressions * x.share);
    const cl = clicks == null ? null : last ? clicks - cSum : Math.round(clicks * x.share);
    sSum += sp; iSum += im ?? 0; cSum += cl ?? 0;
    out.push({ country: x.country, spend: sp, impressions: im, clicks: cl });
  });
  return out;
}

async function graphGet<T>(url: string, token: string): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
    if (res.ok && !body.error) return body;
    const code = body.error?.code;
    // 17 / 32 / 613 = rate limits, 4 = app-level throttle → back off and retry
    if ([4, 17, 32, 613].includes(code ?? -1) || res.status === 429) { await sleep(5000 * (attempt + 1)); continue; }
    throw new Error(`Meta API: ${body.error?.message ?? `${res.status} ${res.statusText}`}`);
  }
  throw new Error("Meta API: rate limited repeatedly");
}

export function actId(id: string): string {
  const d = id.trim();
  return d.startsWith("act_") ? d : `act_${d}`;
}

/** Hour index from "00:00:00 - 00:59:59". */
export function hourFromBreakdown(v: string | undefined): number | null {
  const m = v?.match(/^(\d{2}):/);
  return m ? Number(m[1]) : null;
}

export async function testMeta(config: PerformanceClientConfig): Promise<{ ok: true; accounts: Array<{ id: string; name: string; timezone: string; currency: string }> }> {
  const { token, accounts } = config.meta;
  if (!token) throw new Error("Meta access token is required");
  if (!accounts.length) throw new Error("Add at least one Meta ad account (act_… → region)");
  const out = [];
  for (const a of accounts) {
    const r = await graphGet<{ id: string; name?: string; timezone_name?: string; currency?: string }>(
      `${GRAPH}/${actId(a.id)}?fields=name,timezone_name,currency`, token,
    );
    out.push({ id: r.id, name: r.name ?? r.id, timezone: r.timezone_name ?? "UTC", currency: r.currency ?? "" });
  }
  return { ok: true, accounts: out };
}

export async function syncMetaSpend(config: PerformanceClientConfig, lastSyncedAt: Date | null, onProgress?: (rows: number) => void): Promise<{ rows: number }> {
  const { token, accounts } = config.meta;
  if (!token) throw new Error("Meta is not connected (access token)");
  if (!accounts.length) throw new Error("Meta: no ad accounts configured");
  const from = lastSyncedAt ? new Date(lastSyncedAt.getTime() - 3 * 86_400_000) : backfillStart();
  const to = new Date();
  let rows = 0;
  for (const acct of accounts) {
    const id = actId(acct.id);
    const meta = await graphGet<{ timezone_name?: string }>(`${GRAPH}/${id}?fields=timezone_name`, token);
    const tz = meta.timezone_name ?? "UTC";
    for (const [since, until] of dateChunks(from, to, 60)) {
      const insights = async (breakdowns: string): Promise<InsightRow[]> => {
        const params = new URLSearchParams({
          level: "account", fields: "spend,impressions,clicks", time_increment: "1", breakdowns,
          time_range: JSON.stringify({ since, until }), limit: "500",
        });
        const all: InsightRow[] = [];
        let url: string | null = `${GRAPH}/${id}/insights?${params.toString()}`;
        while (url) {
          const page: { data?: InsightRow[]; paging?: { next?: string } } = await graphGet(url, token);
          all.push(...(page.data ?? []));
          url = page.paging?.next ?? null;
        }
        return all;
      };
      const hourly = await insights("hourly_stats_aggregated_by_advertiser_time_zone");
      const shares = countryShares(await insights("country"));
      const values: SpendRow[] = hourly.flatMap((r) => {
        const h = hourFromBreakdown(r.hourly_stats_aggregated_by_advertiser_time_zone);
        if (h == null) return [];
        const hour = new Date(zonedHourToUtcMs(r.date_start, h, tz));
        const spend = Number(r.spend ?? 0);
        const impressions = r.impressions != null ? Number(r.impressions) : null;
        const clicks = r.clicks != null ? Number(r.clicks) : null;
        const day = shares.get(r.date_start);
        const base = { brandId: config.brandId, platform: "META", accountId: id, hour };
        if (!day) return [{ ...base, country: "", region: acct.region, spend: spend.toFixed(4), impressions, clicks }];
        return splitHour(spend, impressions, clicks, day).map((x) => ({
          ...base, country: x.country, region: regionFor(x.country, config.regionMapping), spend: x.spend.toFixed(4), impressions: x.impressions, clicks: x.clicks,
        }));
      });
      // The chunk's window is re-pulled as a whole: replace the account's rows in it (stale country slices go away).
      const winFrom = new Date(zonedHourToUtcMs(since, 0, tz)), winTo = new Date(zonedHourToUtcMs(until, 23, tz) + 3_600_000);
      await db.transaction(async (tx) => {
        await tx.delete(schema.performanceSpendHours).where(and(
          eq(schema.performanceSpendHours.brandId, config.brandId), eq(schema.performanceSpendHours.platform, "META"),
          eq(schema.performanceSpendHours.accountId, id), gte(schema.performanceSpendHours.hour, winFrom), lt(schema.performanceSpendHours.hour, winTo),
        ));
        for (let i = 0; i < values.length; i += 500) await tx.insert(schema.performanceSpendHours).values(values.slice(i, i + 500));
      });
      rows += values.length; onProgress?.(rows);
    }
  }
  return { rows };
}

export type SpendRow = typeof schema.performanceSpendHours.$inferInsert;

export async function upsertSpend(values: SpendRow[]): Promise<void> {
  for (let i = 0; i < values.length; i += 500) {
    await db.insert(schema.performanceSpendHours).values(values.slice(i, i + 500)).onConflictDoUpdate({
      target: [schema.performanceSpendHours.brandId, schema.performanceSpendHours.platform, schema.performanceSpendHours.accountId, schema.performanceSpendHours.hour, schema.performanceSpendHours.country],
      set: { region: sql`excluded.region`, spend: sql`excluded.spend`, impressions: sql`excluded.impressions`, clicks: sql`excluded.clicks` },
    });
  }
}
