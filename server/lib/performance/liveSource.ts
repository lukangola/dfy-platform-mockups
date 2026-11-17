/**
 * LiveSource — hourly buckets from the synced tables.
 *   sales: performance_orders  (Shopify + Amazon, every channel) → c[REGION] = [ncOrders, ncRev, rcOrders, rcRev, cogs]
 *   spend: performance_spend_hours (Meta/Google/TikTok) → s[PLATFORM] = [spend per region]
 * Same shape as the mock, so agg/metrics/series and the UI are untouched.
 */
import { sql } from "drizzle-orm";
import { db } from "../db.js";
import { HOUR, OTHER_PRODUCT, PLATFORMS, type Dataset, type HourBucket, type PlatformKey, type ProductCell, type ProductLineDef, type RegionCell, type RegionDef } from "../../../shared/performance/engine.js";
import { productDefs, regionDefs, type PerformanceClientConfig } from "./config.js";
import { ProductSplitter, type CampaignDay } from "./productSplit.js";
import { regionFor } from "./shopify.js";
import type { DataSource } from "./source.js";

const PLATFORM_SET = new Set<string>(PLATFORMS.map((p) => p.key));

function emptyBucket(t: number, regions: RegionDef[], products: ProductLineDef[]): HourBucket {
  const c: Record<string, RegionCell> = {};
  for (const r of regions) c[r.key] = [0, 0, 0, 0, 0];
  const zeros = () => regions.map(() => 0);
  const b: HourBucket = { t, c, s: { META: zeros(), GOOG: zeros(), TT: zeros() } };
  if (products.length) {
    b.pc = {}; b.ps = {};
    for (const p of products) {
      const cells: Record<string, ProductCell> = {};
      for (const r of regions) cells[r.key] = [0, 0, 0, 0];
      b.pc[p.key] = cells; b.ps[p.key] = zeros();
    }
  }
  return b;
}

export class LiveSource implements DataSource {
  readonly kind = "live" as const;
  constructor(private readonly config: PerformanceClientConfig) {}

  async fetchHours(fromMs: number, toMs: number): Promise<Dataset> {
    const now = Date.now();
    const startMs = Math.floor(fromMs / HOUR) * HOUR;
    const endHourMs = Math.floor(Math.min(toMs, now) / HOUR) * HOUR;
    const n = endHourMs >= startMs ? Math.floor((endHourMs - startMs) / HOUR) + 1 : 0;
    const regions = regionDefs(this.config);
    const products = productDefs(this.config);
    const regionIndex = new Map(regions.map((r, i) => [r.key, i]));
    const hours: HourBucket[] = Array.from({ length: n }, (_, i) => emptyBucket(startMs + i * HOUR, regions, products));
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
      if (i < 0 || i >= n || !regionIndex.has(r.region)) continue;
      const cell = hours[i].c[r.region];
      const orders = Number(r.n), rev = Math.round(Number(r.rev) * 100) / 100;
      if (r.nc) { cell[0] += orders; cell[1] += rev; } else { cell[2] += orders; cell[3] += rev; }
      cell[4] += Math.round(Number(r.cogs) * 100) / 100;
    }

    // Share of revenue whose orders carry a complete cost of goods (every line item had a Shopify unit cost;
    // for Amazon orders: every SKU matched a Shopify variant SKU with a cost).
    const cov = await db.execute<{ total: string | null; covered: string | null }>(sql`
      SELECT SUM(${revenueCol})::text AS total, SUM(${revenueCol}) FILTER (WHERE cogs_complete)::text AS covered
      FROM performance_orders
      WHERE brand_id = ${this.config.brandId} AND created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz
        AND cancelled = FALSE AND test = FALSE
    `);
    const total = Number(cov.rows[0]?.total ?? 0);
    const costCoverage = total > 0 ? Number(cov.rows[0]?.covered ?? 0) / total : null;

    const spend = await db.execute<{ hour: string; platform: string; account_id: string; country: string; region: string; spend: string }>(sql`
      SELECT hour, platform, account_id, country, region, SUM(spend)::text AS spend
      FROM performance_spend_hours
      WHERE brand_id = ${this.config.brandId} AND hour >= ${from.toISOString()}::timestamptz AND hour < ${to.toISOString()}::timestamptz
      GROUP BY 1, 2, 3, 4, 5
    `);
    const splitter = products.length ? await this.splitter(from, to, products) : null;
    for (const r of spend.rows) {
      const t = new Date(r.hour).getTime();
      const i = idx(t);
      const ri = regionIndex.get(r.region);
      if (i < 0 || i >= n || !PLATFORM_SET.has(r.platform) || ri === undefined) continue;
      const v = Number(r.spend);
      hours[i].s[r.platform as PlatformKey][ri] += Math.round(v * 100) / 100;
      if (splitter) {
        const ps = hours[i].ps!;
        for (const [key, amount] of splitter.split(v, splitter.shares(r.platform, r.account_id, t, r.country, r.region))) (ps[key] ?? ps[OTHER_PRODUCT.key])[ri] += amount;
      }
    }

    if (products.length) {
      // Sales per product line: an order counts in every product line it has a line item in; its revenue is
      // split across them by net line value (gross when every line is fully discounted, equally when both are 0).
      // Orders without stored line items (Amazon, not yet re-synced) fall into "Other / unassigned" whole; an order
      // that has a named product line is not *counted* in Other for an add-on item (shipping protection), only its
      // revenue share lands there, so Other's order count means "orders no product line claims".
      const prod = await db.execute<{ h: string; region: string; nc: boolean; pl: string; n: string; rev: string }>(sql`
        WITH lines AS (
          SELECT o.id AS oid, date_trunc('hour', o.created_at) AS h, o.region, o.is_new_customer AS nc, ${revenueCol} AS orev,
                 COALESCE(l.product_line, ${OTHER_PRODUCT.key}) AS pl, COALESCE(SUM(l.net), 0) AS net, COALESCE(SUM(l.gross), 0) AS gross
          FROM performance_orders o LEFT JOIN performance_order_lines l ON l.order_id = o.id
          WHERE o.brand_id = ${this.config.brandId} AND o.created_at >= ${from.toISOString()}::timestamptz AND o.created_at < ${to.toISOString()}::timestamptz
            AND o.cancelled = FALSE AND o.test = FALSE
          GROUP BY o.id, o.created_at, o.region, o.is_new_customer, o.total_price, o.subtotal_price, l.product_line
        ), alloc AS (
          SELECT h, region, nc, pl,
                 CASE WHEN SUM(net) OVER w > 0 THEN orev * net / SUM(net) OVER w
                      WHEN SUM(gross) OVER w > 0 THEN orev * gross / SUM(gross) OVER w
                      ELSE orev / COUNT(*) OVER w END AS rev,
                 (pl <> ${OTHER_PRODUCT.key} OR COUNT(*) FILTER (WHERE pl <> ${OTHER_PRODUCT.key}) OVER w = 0) AS counted
          FROM lines WINDOW w AS (PARTITION BY oid)
        )
        SELECT h, region, nc, pl, (COUNT(*) FILTER (WHERE counted))::text AS n, SUM(rev)::text AS rev FROM alloc GROUP BY 1, 2, 3, 4
      `);
      for (const r of prod.rows) {
        const i = idx(new Date(r.h).getTime());
        if (i < 0 || i >= n || !regionIndex.has(r.region)) continue;
        const pc = hours[i].pc!;
        const cell = (pc[r.pl] ?? pc[OTHER_PRODUCT.key])[r.region];
        const orders = Number(r.n), rev = Math.round(Number(r.rev) * 100) / 100;
        if (r.nc) { cell[0] += orders; cell[1] += rev; } else { cell[2] += orders; cell[3] += rev; }
      }
    }

    return { regions, products, hours, startMs, now, nowHourMs: Math.floor(now / HOUR) * HOUR, costCoverage };
  }

  /** Campaign days overlapping the window → the splitter that turns account spend into product spend. */
  private async splitter(from: Date, to: Date, products: ProductLineDef[]): Promise<ProductSplitter> {
    const rows = await db.execute<{ platform: string; account_id: string; day_start: string; day_end: string; country: string; product_line: string; spend: string }>(sql`
      SELECT platform, account_id, day_start, day_end, country, product_line, SUM(spend)::text AS spend
      FROM performance_spend_campaign_days
      WHERE brand_id = ${this.config.brandId} AND day_end > ${from.toISOString()}::timestamptz AND day_start < ${to.toISOString()}::timestamptz
      GROUP BY 1, 2, 3, 4, 5, 6
    `);
    const days: CampaignDay[] = rows.rows.map((r) => ({
      platform: r.platform, accountId: r.account_id, dayStartMs: new Date(r.day_start).getTime(), dayEndMs: new Date(r.day_end).getTime(),
      country: r.country, region: r.country ? regionFor(r.country, this.config.regionMapping) : "OTH", productLine: r.product_line, spend: Number(r.spend),
    }));
    return new ProductSplitter(days, products.map((p) => p.key));
  }
}
