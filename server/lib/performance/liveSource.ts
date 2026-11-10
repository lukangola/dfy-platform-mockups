/**
 * LiveSource — hourly buckets from the synced tables.
 *   sales: performance_orders  (Shopify)   → c[REGION] = [ncOrders, ncRev, rcOrders, rcRev, cogs]
 *   spend: performance_spend_hours (Meta/Google/TikTok) → s[PLATFORM] = [spend per region]
 * Same shape as the mock, so agg/metrics/series and the UI are untouched.
 */
import { sql } from "drizzle-orm";
import { db } from "../db.js";
import { HOUR, PLATFORMS, REGIONS, type Dataset, type HourBucket, type PlatformKey, type RegionKey } from "../../../shared/performance/engine.js";
import type { PerformanceClientConfig } from "./config.js";
import type { DataSource } from "./source.js";

const REGION_SET = new Set<string>(REGIONS.map((r) => r.key));
const PLATFORM_SET = new Set<string>(PLATFORMS.map((p) => p.key));

function emptyBucket(t: number): HourBucket {
  return {
    t,
    c: { NLBE: [0, 0, 0, 0, 0], UK: [0, 0, 0, 0, 0], USA: [0, 0, 0, 0, 0], OTH: [0, 0, 0, 0, 0] },
    s: { META: [0, 0, 0, 0], GOOG: [0, 0, 0, 0], TT: [0, 0, 0, 0] },
  };
}

export class LiveSource implements DataSource {
  readonly kind = "live" as const;
  constructor(private readonly config: PerformanceClientConfig) {}

  async fetchHours(fromMs: number, toMs: number): Promise<Dataset> {
    const now = Date.now();
    const startMs = Math.floor(fromMs / HOUR) * HOUR;
    const endHourMs = Math.floor(Math.min(toMs, now) / HOUR) * HOUR;
    const n = endHourMs >= startMs ? Math.floor((endHourMs - startMs) / HOUR) + 1 : 0;
    const hours: HourBucket[] = Array.from({ length: n }, (_, i) => emptyBucket(startMs + i * HOUR));
    const idx = (t: number) => Math.floor((t - startMs) / HOUR);
    const from = new Date(startMs), to = new Date(endHourMs + HOUR);
    const revenueCol = this.config.revenueField === "subtotal" ? sql`COALESCE(subtotal_price, total_price)` : sql`total_price`;

    const sales = await db.execute<{ h: string; region: string; nc: boolean; n: string; rev: string; cogs: string }>(sql`
      SELECT date_trunc('hour', created_at) AS h, region, is_new_customer AS nc, COUNT(*)::text AS n, SUM(${revenueCol})::text AS rev,
             SUM(COALESCE(cogs, 0))::text AS cogs
      FROM performance_orders
      WHERE brand_id = ${this.config.brandId} AND created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz
        AND cancelled = FALSE AND test = FALSE
      GROUP BY 1, 2, 3
    `);
    for (const r of sales.rows) {
      const i = idx(new Date(r.h).getTime());
      if (i < 0 || i >= n || !REGION_SET.has(r.region)) continue;
      const cell = hours[i].c[r.region as RegionKey];
      const orders = Number(r.n), rev = Math.round(Number(r.rev) * 100) / 100;
      if (r.nc) { cell[0] += orders; cell[1] += rev; } else { cell[2] += orders; cell[3] += rev; }
      cell[4] += Math.round(Number(r.cogs) * 100) / 100;
    }

    // Share of revenue whose orders carry a complete cost of goods (every line item had a Shopify unit cost).
    const cov = await db.execute<{ total: string | null; covered: string | null }>(sql`
      SELECT SUM(${revenueCol})::text AS total, SUM(${revenueCol}) FILTER (WHERE cogs_complete)::text AS covered
      FROM performance_orders
      WHERE brand_id = ${this.config.brandId} AND created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz
        AND cancelled = FALSE AND test = FALSE
    `);
    const total = Number(cov.rows[0]?.total ?? 0);
    const costCoverage = total > 0 ? Number(cov.rows[0]?.covered ?? 0) / total : null;

    const spend = await db.execute<{ hour: string; platform: string; region: string; spend: string }>(sql`
      SELECT hour, platform, region, SUM(spend)::text AS spend
      FROM performance_spend_hours
      WHERE brand_id = ${this.config.brandId} AND hour >= ${from.toISOString()}::timestamptz AND hour < ${to.toISOString()}::timestamptz
      GROUP BY 1, 2, 3
    `);
    for (const r of spend.rows) {
      const i = idx(new Date(r.hour).getTime());
      if (i < 0 || i >= n || !PLATFORM_SET.has(r.platform) || !REGION_SET.has(r.region)) continue;
      const ri = REGIONS.findIndex((x) => x.key === r.region);
      hours[i].s[r.platform as PlatformKey][ri] += Math.round(Number(r.spend) * 100) / 100;
    }

    return { hours, startMs, now, nowHourMs: Math.floor(now / HOUR) * HOUR, costCoverage };
  }
}
