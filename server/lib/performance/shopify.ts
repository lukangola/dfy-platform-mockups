/**
 * Shopify orders → performance_orders (sales side).
 *
 * Admin REST API (custom app token, scopes read_orders + read_customers).
 *   First run : backfill every order since Jan 1 of last year (created_at_min), 250/page.
 *   Next runs : incremental by updated_at_min = cursor (catches edits, cancellations, refunds
 *               that change totals), so a 10-minute poll is enough for a live dashboard
 *               without a public webhook URL.
 * After every run NC/RC is recomputed for the whole brand from nc_definition:
 *   first_ever  — the customer's earliest order in our table, and the customer record was
 *                 created inside the backfill window (older customers are returning)
 *   window_days — no earlier order by the same customer within N days
 * Guest orders are keyed by email; orders with neither are treated as new-customer.
 */
import { sql } from "drizzle-orm";
import { db, schema } from "../db.js";
import type { PerformanceClientConfig } from "./config.js";
import { backfillStart, sleep } from "./time.js";
import type { RegionKey } from "../../../shared/performance/engine.js";

export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2025-01";
const FIELDS = [
  "id", "created_at", "updated_at", "processed_at", "cancelled_at", "test", "currency", "financial_status",
  "total_price", "subtotal_price", "email", "customer", "shipping_address", "billing_address",
].join(",");

interface ShopifyOrder {
  id: number; created_at: string; updated_at: string; processed_at?: string | null; cancelled_at?: string | null;
  test?: boolean; currency?: string; financial_status?: string | null;
  total_price?: string; subtotal_price?: string; email?: string | null;
  customer?: { id?: number; created_at?: string; email?: string | null; default_address?: { country_code?: string | null } | null } | null;
  shipping_address?: { country_code?: string | null } | null;
  billing_address?: { country_code?: string | null } | null;
}

export function regionFor(country: string | null | undefined, mapping: Record<string, RegionKey>): RegionKey {
  if (!country) return "OTH";
  return mapping[country.toUpperCase()] ?? "OTH";
}

function shopHost(domain: string): string {
  const d = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return d.includes(".") ? d : `${d}.myshopify.com`;
}

/** GET with Shopify rate-limit handling (429 → wait Retry-After, default 2s). */
async function shopifyGet(url: string, token: string): Promise<{ body: unknown; link: string | null }> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token, Accept: "application/json" } });
    if (res.status === 429) {
      const wait = Number(res.headers.get("Retry-After") ?? "2") * 1000;
      await sleep(Math.min(wait || 2000, 10_000));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Shopify ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
    }
    return { body: await res.json(), link: res.headers.get("link") };
  }
  throw new Error("Shopify: rate limited repeatedly");
}

function nextPageInfo(link: string | null): string | null {
  if (!link) return null;
  const m = link.split(",").map((s) => s.trim()).find((s) => s.endsWith('rel="next"'));
  const url = m?.match(/<([^>]+)>/)?.[1];
  return url ? new URL(url).searchParams.get("page_info") : null;
}

/** Quick credential check used by the UI's "Test connection". */
export async function testShopify(config: PerformanceClientConfig): Promise<{ ok: true; shop: string; currency: string | null }> {
  const { shopDomain, token } = config.shopify;
  if (!shopDomain || !token) throw new Error("Shopify shop domain and admin token are required");
  const { body } = await shopifyGet(`https://${shopHost(shopDomain)}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, token);
  const shop = (body as { shop?: { name?: string; currency?: string } }).shop;
  return { ok: true, shop: shop?.name ?? shopHost(shopDomain), currency: shop?.currency ?? null };
}

export interface SyncResult { rows: number; cursor: string | null }

/**
 * Pull orders (backfill or incremental) and upsert them. `cursor` is the max updated_at
 * seen so far (ISO); null = backfill. Returns the new cursor.
 */
export async function syncShopifyOrders(config: PerformanceClientConfig, cursor: string | null, onProgress?: (rows: number) => void): Promise<SyncResult> {
  const { shopDomain, token } = config.shopify;
  if (!shopDomain || !token) throw new Error("Shopify is not connected (shop domain + admin token)");
  const host = shopHost(shopDomain);
  const base = `https://${host}/admin/api/${SHOPIFY_API_VERSION}/orders.json`;
  const params = new URLSearchParams({ status: "any", limit: "250", fields: FIELDS });
  if (cursor) params.set("updated_at_min", cursor);
  else params.set("created_at_min", backfillStart().toISOString());
  // Shopify's cursor pagination (page_info) forbids changing filters, so page requests carry only limit + page_info.
  let url: string | null = `${base}?${params.toString()}`;
  let rows = 0;
  let maxUpdated = cursor ?? "";
  while (url) {
    const { body, link }: { body: unknown; link: string | null } = await shopifyGet(url, token);
    const orders = ((body as { orders?: ShopifyOrder[] }).orders ?? []);
    if (orders.length) {
      await upsertOrders(config, orders);
      rows += orders.length;
      for (const o of orders) if (o.updated_at > maxUpdated) maxUpdated = o.updated_at;
      onProgress?.(rows);
    }
    const next = nextPageInfo(link);
    url = next ? `${base}?limit=250&fields=${encodeURIComponent(FIELDS)}&page_info=${encodeURIComponent(next)}` : null;
  }
  await recomputeNewCustomer(config);
  return { rows, cursor: maxUpdated || cursor };
}

async function upsertOrders(config: PerformanceClientConfig, orders: ShopifyOrder[]): Promise<void> {
  const values = orders.map((o) => {
    const country = o.shipping_address?.country_code ?? o.billing_address?.country_code ?? o.customer?.default_address?.country_code ?? null;
    const customerKey = o.customer?.id != null ? `id:${o.customer.id}` : (o.email ?? o.customer?.email) ? `email:${(o.email ?? o.customer?.email ?? "").toLowerCase()}` : null;
    return {
      brandId: config.brandId,
      shopifyOrderId: String(o.id),
      createdAt: new Date(o.processed_at ?? o.created_at),
      updatedAt: new Date(o.updated_at),
      customerKey,
      customerCreatedAt: o.customer?.created_at ? new Date(o.customer.created_at) : null,
      country: country?.toUpperCase() ?? null,
      region: regionFor(country, config.regionMapping),
      totalPrice: o.total_price ?? "0",
      subtotalPrice: o.subtotal_price ?? null,
      currency: o.currency ?? null,
      financialStatus: o.financial_status ?? null,
      cancelled: Boolean(o.cancelled_at) || o.financial_status === "voided",
      test: Boolean(o.test),
    };
  });
  await db
    .insert(schema.performanceOrders)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.performanceOrders.brandId, schema.performanceOrders.shopifyOrderId],
      set: {
        createdAt: sql`excluded.created_at`, updatedAt: sql`excluded.updated_at`,
        customerKey: sql`excluded.customer_key`, customerCreatedAt: sql`excluded.customer_created_at`,
        country: sql`excluded.country`, region: sql`excluded.region`,
        totalPrice: sql`excluded.total_price`, subtotalPrice: sql`excluded.subtotal_price`,
        currency: sql`excluded.currency`, financialStatus: sql`excluded.financial_status`,
        cancelled: sql`excluded.cancelled`, test: sql`excluded.test`,
      },
    });
}

/** Recompute is_new_customer for the whole brand (cheap: one window query per sync). */
export async function recomputeNewCustomer(config: PerformanceClientConfig): Promise<void> {
  const start = backfillStart();
  const windowMs = config.ncWindowDays * 86_400_000;
  const rule = config.ncDefinition === "window_days"
    ? sql`(r.prev_created IS NULL OR (EXTRACT(EPOCH FROM (r.created_at - r.prev_created)) * 1000) > ${windowMs})`
    : sql`(r.prev_created IS NULL AND (r.customer_created_at IS NULL OR r.customer_created_at >= ${start.toISOString()}::timestamptz))`;
  await db.execute(sql`
    UPDATE performance_orders o SET is_new_customer = r.is_nc
    FROM (
      SELECT id,
             CASE WHEN customer_key IS NULL THEN TRUE ELSE ${rule} END AS is_nc
      FROM (
        SELECT id, customer_key, created_at, customer_created_at,
               LAG(created_at) OVER (PARTITION BY customer_key ORDER BY created_at, id) AS prev_created
        FROM performance_orders
        WHERE brand_id = ${config.brandId} AND cancelled = FALSE AND test = FALSE
      ) r
    ) r
    WHERE o.id = r.id AND o.is_new_customer IS DISTINCT FROM r.is_nc
  `);
}
