/**
 * Google Ads API → performance_spend_hours (platform GOOG).
 * OAuth refresh-token flow (developer token + OAuth client + refresh token, optional
 * MCC login-customer-id), GAQL searchStream on the customer resource segmented by
 * date + hour, converted from the account's time zone to UTC hour buckets.
 * API version: GOOGLE_ADS_API_VERSION (default v22) — bump when Google sunsets it.
 */
import type { PerformanceClientConfig } from "./config.js";
import { upsertSpend, type SpendRow } from "./meta.js";
import { backfillStart, dateChunks, zonedHourToUtcMs } from "./time.js";

export const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION ?? "v22";

async function accessToken(config: PerformanceClientConfig): Promise<string> {
  const { clientId, clientSecret, refreshToken } = config.google;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google Ads: OAuth client id, client secret and refresh token are required");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`Google OAuth: ${body.error_description ?? body.error ?? res.statusText}`);
  return body.access_token;
}

export function digits(id: string): string {
  return id.replace(/\D/g, "");
}

interface GaqlRow { segments?: { date?: string; hour?: number }; metrics?: { costMicros?: string; impressions?: string; clicks?: string }; customer?: { timeZone?: string; currencyCode?: string; descriptiveName?: string } }

async function searchStream(config: PerformanceClientConfig, token: string, customerId: string, query: string): Promise<GaqlRow[]> {
  const { developerToken, loginCustomerId } = config.google;
  if (!developerToken) throw new Error("Google Ads: developer token is required");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`, "developer-token": developerToken, "Content-Type": "application/json",
  };
  if (loginCustomerId) headers["login-customer-id"] = digits(loginCustomerId);
  const res = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${digits(customerId)}/googleAds:searchStream`, {
    method: "POST", headers, body: JSON.stringify({ query }),
  });
  const body = (await res.json().catch(() => ({}))) as Array<{ results?: GaqlRow[] }> | { error?: { message?: string; details?: unknown } };
  if (!res.ok) {
    const err = (body as { error?: { message?: string } }).error;
    throw new Error(`Google Ads API ${res.status}: ${err?.message ?? res.statusText}`);
  }
  return (body as Array<{ results?: GaqlRow[] }>).flatMap((chunk) => chunk.results ?? []);
}

export async function testGoogle(config: PerformanceClientConfig): Promise<{ ok: true; accounts: Array<{ id: string; name: string; timezone: string; currency: string }> }> {
  if (!config.google.accounts.length) throw new Error("Add at least one Google Ads customer id (digits → region)");
  const token = await accessToken(config);
  const out = [];
  for (const a of config.google.accounts) {
    const rows = await searchStream(config, token, a.id, "SELECT customer.descriptive_name, customer.time_zone, customer.currency_code FROM customer LIMIT 1");
    const c = rows[0]?.customer;
    out.push({ id: digits(a.id), name: c?.descriptiveName ?? digits(a.id), timezone: c?.timeZone ?? "UTC", currency: c?.currencyCode ?? "" });
  }
  return { ok: true, accounts: out };
}

export async function syncGoogleSpend(config: PerformanceClientConfig, lastSyncedAt: Date | null, onProgress?: (rows: number) => void): Promise<{ rows: number }> {
  if (!config.google.accounts.length) throw new Error("Google Ads: no customer ids configured");
  const token = await accessToken(config);
  const from = lastSyncedAt ? new Date(lastSyncedAt.getTime() - 3 * 86_400_000) : backfillStart();
  const to = new Date();
  let rows = 0;
  for (const acct of config.google.accounts) {
    const cid = digits(acct.id);
    const tzRows = await searchStream(config, token, cid, "SELECT customer.time_zone FROM customer LIMIT 1");
    const tz = tzRows[0]?.customer?.timeZone ?? "UTC";
    for (const [a, b] of dateChunks(from, to, 90)) {
      const q = `SELECT segments.date, segments.hour, metrics.cost_micros, metrics.impressions, metrics.clicks FROM customer WHERE segments.date BETWEEN '${a}' AND '${b}'`;
      const result = await searchStream(config, token, cid, q);
      const values: SpendRow[] = result.flatMap((r) => {
        const date = r.segments?.date, hour = r.segments?.hour;
        if (!date || hour == null) return [];
        return [{
          brandId: config.brandId, platform: "GOOG", accountId: cid,
          hour: new Date(zonedHourToUtcMs(date, Number(hour), tz)),
          region: acct.region,
          spend: (Number(r.metrics?.costMicros ?? 0) / 1_000_000).toFixed(4),
          impressions: r.metrics?.impressions != null ? Number(r.metrics.impressions) : null,
          clicks: r.metrics?.clicks != null ? Number(r.metrics.clicks) : null,
        }];
      });
      if (values.length) { await upsertSpend(values); rows += values.length; onProgress?.(rows); }
    }
  }
  return { rows };
}
