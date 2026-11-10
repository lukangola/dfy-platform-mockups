/**
 * Meta Marketing API → performance_spend_hours (platform META).
 * Account-level insights with time_increment=1 and the hourly breakdown
 * (hourly_stats_aggregated_by_advertiser_time_zone), converted from the ad
 * account's time zone to UTC hour buckets. Each configured account maps to one
 * dashboard region. Pulled in 60-day chunks; incremental runs re-pull the last
 * 3 days so late-attributed spend settles.
 * The token travels only in the Authorization header — never in a URL, so it
 * can't end up in logs, error messages or paging links.
 */
import { sql } from "drizzle-orm";
import { db, schema } from "../db.js";
import type { PerformanceClientConfig } from "./config.js";
import { backfillStart, dateChunks, sleep, zonedHourToUtcMs } from "./time.js";

export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v23.0";
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

interface InsightRow { date_start: string; spend?: string; impressions?: string; clicks?: string; hourly_stats_aggregated_by_advertiser_time_zone?: string }

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
      const params = new URLSearchParams({
        level: "account",
        fields: "spend,impressions,clicks",
        time_increment: "1",
        breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone",
        time_range: JSON.stringify({ since, until }),
        limit: "500",
      });
      let url: string | null = `${GRAPH}/${id}/insights?${params.toString()}`;
      while (url) {
        const page: { data?: InsightRow[]; paging?: { next?: string } } = await graphGet(url, token);
        const values = (page.data ?? []).flatMap((r) => {
          const h = hourFromBreakdown(r.hourly_stats_aggregated_by_advertiser_time_zone);
          if (h == null) return [];
          return [{
            brandId: config.brandId, platform: "META", accountId: id,
            hour: new Date(zonedHourToUtcMs(r.date_start, h, tz)),
            region: acct.region,
            spend: r.spend ?? "0",
            impressions: r.impressions != null ? Number(r.impressions) : null,
            clicks: r.clicks != null ? Number(r.clicks) : null,
          }];
        });
        if (values.length) { await upsertSpend(values); rows += values.length; onProgress?.(rows); }
        url = page.paging?.next ?? null;
      }
    }
  }
  return { rows };
}

export type SpendRow = typeof schema.performanceSpendHours.$inferInsert;

export async function upsertSpend(values: SpendRow[]): Promise<void> {
  for (let i = 0; i < values.length; i += 500) {
    await db.insert(schema.performanceSpendHours).values(values.slice(i, i + 500)).onConflictDoUpdate({
      target: [schema.performanceSpendHours.brandId, schema.performanceSpendHours.platform, schema.performanceSpendHours.accountId, schema.performanceSpendHours.hour],
      set: { region: sql`excluded.region`, spend: sql`excluded.spend`, impressions: sql`excluded.impressions`, clicks: sql`excluded.clicks` },
    });
  }
}
