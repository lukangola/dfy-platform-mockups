/**
 * Shopify orders → performance_orders (sales side) + cost of goods.
 *
 * Admin REST API, READ-ONLY scopes: read_orders, read_customers, read_products,
 * read_inventory. Nothing is ever written to the shop. Credentials (see shopifyAccessToken):
 * a Dev Dashboard app's Client ID + secret (exchanged here for 24h tokens) or, for apps
 * created in the admin before 2026, the legacy static access token.
 *
 * Cost of goods: each order's line items carry a variant id; the variant's unit cost
 * (InventoryItem.unitCost) is fetched once via Admin GraphQL, cached per brand in
 * performance_variant_costs (with the variant's SKU, so Amazon orders can reuse the cost — see
 * amazon.ts) and refreshed only when older than 30 days and seen again in a synced order.
 * cogs = Σ quantity × unit cost; cogs_complete = every line item had one.
 *   First run : backfill every order since Jan 1 of last year (created_at_min), 250/page.
 *   Next runs : incremental by updated_at_min = cursor (catches edits, cancellations, refunds
 *               that change totals), so a 10-minute poll is enough for a live dashboard
 *               without a public webhook URL.
 * After every run NC/RC is recomputed for the whole brand from nc_definition:
 *   first_ever  — the customer's earliest order in our table and none hidden before it: for
 *                 customers whose record predates the oldest order we hold, Shopify's lifetime
 *                 order count decides (performance_customers); without a count they are returning
 *   window_days — no earlier order by the same customer within N days
 * Guest orders are keyed by email; orders with neither are treated as new-customer.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db.js";
import { productLineForTitle, type PerformanceClientConfig } from "./config.js";
import { backfillStart, sleep } from "./time.js";
import { refreshShopifyInstallToken, storeShopifyTokens } from "./shopifyOAuth.js";
import type { RegionKey } from "../../../shared/performance/engine.js";

export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2025-01";
const FIELDS = [
  "id", "created_at", "updated_at", "processed_at", "cancelled_at", "test", "currency", "financial_status",
  "total_price", "subtotal_price", "email", "customer", "shipping_address", "billing_address", "line_items",
].join(",");
/** Read-only scopes the dashboard needs (orders + customers for NC/RC, products + inventory for unit costs). */
export const REQUIRED_SCOPES = ["read_orders", "read_customers", "read_products", "read_inventory"];
const COST_TTL_MS = 30 * 86_400_000;
const COST_BATCH = 100;
const CUSTOMER_BATCH = 100;

interface ShopifyOrder {
  id: number; created_at: string; updated_at: string; processed_at?: string | null; cancelled_at?: string | null;
  test?: boolean; currency?: string; financial_status?: string | null;
  total_price?: string; subtotal_price?: string; email?: string | null;
  customer?: { id?: number; created_at?: string; email?: string | null; default_address?: { country_code?: string | null } | null } | null;
  shipping_address?: { country_code?: string | null } | null;
  billing_address?: { country_code?: string | null } | null;
  line_items?: Array<{
    id?: number | string; title?: string | null; variant_title?: string | null; sku?: string | null;
    product_id?: number | null; variant_id?: number | null; quantity?: number | null;
    price?: string | null; total_discount?: string | null;
  }>;
}

export function regionFor(country: string | null | undefined, mapping: Record<string, RegionKey>): RegionKey {
  if (!country) return "OTH";
  return mapping[country.toUpperCase()] ?? "OTH";
}

export function shopHost(domain: string): string {
  const d = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return d.includes(".") ? d : `${d}.myshopify.com`;
}

/**
 * Access token for the shop. Three ways in:
 *  - Dev Dashboard app in the store's own organization: no token is shown anywhere; its Client ID
 *    + Client secret are exchanged here for a 24-hour token (client credentials grant). Cached per
 *    brand in memory and renewed ~10 minutes before expiry: one small request a day, never one per sync.
 *  - Partner-organization app installed on the store through the install flow (shopifyOAuth.ts):
 *    the stored token is used; if it came with an expiry + refresh token it is refreshed ~10 minutes
 *    before expiry and the new pair is persisted.
 *  - Legacy custom app (created in the admin before 2026): its static `shpat_` token is used as is.
 * `fresh` forces a new exchange/refresh (after a 401, or when "Test connection" validates credentials).
 */
export type TokenSource = (fresh?: boolean) => Promise<string>;
const tokenCache = new Map<string, { token: string; expiresAt: number; refreshToken?: string | null }>();
const TOKEN_RENEW_MARGIN_MS = 10 * 60_000;

export function forgetShopifyToken(brandId: string): void {
  tokenCache.delete(brandId);
}

async function shopifyAccessToken(config: PerformanceClientConfig, fresh = false): Promise<string> {
  const { shopDomain, token, clientId, clientSecret, refreshToken, tokenExpiresAt } = config.shopify;
  if (!shopDomain) throw new Error("Shopify shop domain is required");
  if (token) {
    if (!refreshToken || !tokenExpiresAt || !clientId || !clientSecret) return token; // static token
    const hit = tokenCache.get(config.brandId);
    if (!fresh && hit && hit.expiresAt - Date.now() > TOKEN_RENEW_MARGIN_MS) return hit.token;
    if (!fresh && !hit && tokenExpiresAt.getTime() - Date.now() > TOKEN_RENEW_MARGIN_MS) return token;
    const set = await refreshShopifyInstallToken(shopHost(shopDomain), clientId, clientSecret, hit?.refreshToken ?? refreshToken);
    await storeShopifyTokens(config.brandId, set);
    tokenCache.set(config.brandId, { token: set.token, expiresAt: set.expiresAt?.getTime() ?? Date.now() + 86_400_000, refreshToken: set.refreshToken });
    return set.token;
  }
  if (!clientId || !clientSecret) {
    throw new Error("Shopify is not connected: paste the app's Client ID and Client secret (Dev Dashboard) — or, for a legacy custom app, its access token");
  }
  const hit = tokenCache.get(config.brandId);
  if (!fresh && hit && hit.expiresAt - Date.now() > TOKEN_RENEW_MARGIN_MS) return hit.token;
  const res = await fetch(`https://${shopHost(shopDomain)}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    const detail = body.error_description ?? body.error ?? `${res.status} ${res.statusText}`;
    if (body.error === "shop_not_permitted") {
      throw new Error("Shopify refused the client credentials: the app and the store must belong to the same Shopify organization. Create the app in the Dev Dashboard of the organization that owns this store (or have the store owner do it), install it on the store, then paste its Client ID + secret here.");
    }
    if (res.status === 401 || body.error === "invalid_client") throw new Error(`Shopify rejected the Client ID / Client secret (${detail})`);
    throw new Error(`Shopify token exchange failed: ${detail}. Is the app installed on this store?`);
  }
  const ttl = Number(body.expires_in) > 0 ? Number(body.expires_in) * 1000 : 86_400_000;
  tokenCache.set(config.brandId, { token: body.access_token, expiresAt: Date.now() + ttl });
  return body.access_token;
}

export function tokenSource(config: PerformanceClientConfig): TokenSource {
  return (fresh) => shopifyAccessToken(config, fresh);
}

/** GET with Shopify rate-limit handling (429 → wait Retry-After, default 2s); one retry with a fresh token on 401. */
export async function shopifyGet(url: string, auth: TokenSource): Promise<{ body: unknown; link: string | null }> {
  let renewed = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": await auth(), Accept: "application/json" } });
    if (res.status === 429) {
      const wait = Number(res.headers.get("Retry-After") ?? "2") * 1000;
      await sleep(Math.min(wait || 2000, 10_000));
      continue;
    }
    if (res.status === 401 && !renewed) { renewed = true; await auth(true); continue; }
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

/** Admin GraphQL (same credentials). Retries on THROTTLED; one retry with a fresh token on 401; throws on other errors. */
async function shopifyGraphql<T>(host: string, auth: TokenSource, query: string, variables: Record<string, unknown>): Promise<T> {
  let renewed = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://${host}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": await auth(), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) { await sleep(2000); continue; }
    if (res.status === 401 && !renewed) { renewed = true; await auth(true); continue; }
    const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: Array<{ message?: string; extensions?: { code?: string } }> };
    if (!res.ok) throw new Error(`Shopify GraphQL ${res.status} ${res.statusText}`);
    if (body.errors?.length) {
      if (body.errors.some((e) => e.extensions?.code === "THROTTLED")) { await sleep(2000 * (attempt + 1)); continue; }
      const msg = body.errors.map((e) => e.message).filter(Boolean).join("; ");
      if (body.errors.some((e) => e.extensions?.code === "ACCESS_DENIED") || /access denied|scope/i.test(msg)) {
        throw new Error(`Shopify: the app is missing a scope (unit costs need read_products + read_inventory, customer order counts need read_customers): ${msg}`);
      }
      throw new Error(`Shopify GraphQL: ${msg}`);
    }
    if (!body.data) throw new Error("Shopify GraphQL: empty response");
    return body.data;
  }
  throw new Error("Shopify GraphQL: throttled repeatedly");
}

/** Quick credential check used by the UI's "Test connection": shop + which scopes the token really has. */
/** Shopify only returns the last 60 days of orders to apps without `read_all_orders`; probe just past that. */
const ORDER_HISTORY_PROBE_DAYS = 61;

/**
 * Can this app see orders older than Shopify's 60-day default window? Count is not
 * subject to the window, the list is — so "count > 0 but list empty" means the app is
 * limited (Partner-account app without read_all_orders). Two tiny requests, never fatal.
 */
async function probeOrderHistory(host: string, auth: TokenSource): Promise<ShopifyHistoryProbe | null> {
  try {
    const cutoff = new Date(Date.now() - ORDER_HISTORY_PROBE_DAYS * 86_400_000).toISOString();
    const q = `status=any&created_at_max=${encodeURIComponent(cutoff)}`;
    const base = `https://${host}/admin/api/${SHOPIFY_API_VERSION}/orders`;
    const c = await shopifyGet(`${base}/count.json?${q}`, auth);
    const olderCount = Number((c.body as { count?: number }).count ?? 0);
    if (!olderCount) return { cutoff, olderCount: 0, olderReachable: true };
    const l = await shopifyGet(`${base}.json?${q}&limit=1&fields=id`, auth);
    const olderReachable = ((l.body as { orders?: unknown[] }).orders ?? []).length > 0;
    return { cutoff, olderCount, olderReachable };
  } catch {
    return null; // the probe is advisory; a failure here must not fail the connection test
  }
}

export interface ShopifyHistoryProbe {
  /** ISO instant 61 days ago — orders created before it are "older" */
  cutoff: string;
  /** orders older than the cutoff, per the (unrestricted) count endpoint */
  olderCount: number;
  /** false = the list endpoint hides them: the app only sees the last 60 days */
  olderReachable: boolean;
}

export interface ShopInfo { name: string | null; currency: string | null; timezone: string | null }

/**
 * shop.json → name, currency and IANA time zone, stored on the brand's config row so the
 * dashboard can format money in the shop's currency and cut its days at the shop's midnight.
 * Read at the start of every sync (and by Test connection): one small request, and a store
 * that changes its currency or time zone is picked up within a sync interval.
 */
export async function fetchShopInfo(config: PerformanceClientConfig, host: string, auth: TokenSource): Promise<ShopInfo> {
  const { body } = await shopifyGet(`https://${host}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, auth);
  const shop = (body as { shop?: { name?: string; currency?: string; iana_timezone?: string } }).shop;
  const info: ShopInfo = { name: shop?.name ?? null, currency: shop?.currency?.toUpperCase() ?? null, timezone: shop?.iana_timezone ?? null };
  if (info.currency || info.timezone) {
    await db.update(schema.performanceClientConfigs)
      .set({ ...(info.currency ? { shopCurrency: info.currency } : {}), ...(info.timezone ? { shopTimezone: info.timezone } : {}) })
      .where(eq(schema.performanceClientConfigs.brandId, config.brandId));
  }
  return info;
}

export async function testShopify(config: PerformanceClientConfig): Promise<{
  ok: true; shop: string; currency: string | null; timezone: string | null; scopes: string[]; missingScopes: string[]; writeScopes: string[];
  history: ShopifyHistoryProbe | null;
}> {
  const { shopDomain } = config.shopify;
  if (!shopDomain) throw new Error("Shopify shop domain is required");
  const host = shopHost(shopDomain);
  const auth = tokenSource(config);
  await auth(true); // validate the credentials as typed, not a cached token
  const shop = await fetchShopInfo(config, host, auth);
  let scopes: string[] = [];
  try {
    const r = await shopifyGet(`https://${host}/admin/oauth/access_scopes.json`, auth);
    scopes = ((r.body as { access_scopes?: Array<{ handle: string }> }).access_scopes ?? []).map((x) => x.handle).sort();
  } catch { /* older tokens may not expose scopes — not fatal */ }
  const have = new Set(scopes);
  const history = await probeOrderHistory(host, auth);
  return {
    ok: true, shop: shop.name ?? host, currency: shop.currency, timezone: shop.timezone, scopes,
    missingScopes: scopes.length ? REQUIRED_SCOPES.filter((sc) => !have.has(sc)) : [],
    writeScopes: scopes.filter((sc) => sc.startsWith("write_")),
    history,
  };
}

/**
 * Per-brand cache of variant unit costs. Loaded once per sync; unknown or stale
 * (> 30 days) variants that appear in synced orders are fetched in batches of 100
 * through one GraphQL `nodes` query each — so a 10-minute poll with a handful of
 * new orders costs at most one small request, usually none.
 */
class VariantCostCache {
  private readonly costs = new Map<string, number | null>();
  private readonly stale = new Set<string>();
  /** first error from the cost lookup — orders still sync; reported at the end */
  error: string | null = null;

  constructor(private readonly config: PerformanceClientConfig, private readonly host: string, private readonly auth: TokenSource) {}

  async load(): Promise<void> {
    const rows = await db.select({ variantId: schema.performanceVariantCosts.variantId, unitCost: schema.performanceVariantCosts.unitCost, sku: schema.performanceVariantCosts.sku, fetchedAt: schema.performanceVariantCosts.fetchedAt })
      .from(schema.performanceVariantCosts).where(eq(schema.performanceVariantCosts.brandId, this.config.brandId));
    const cutoff = Date.now() - COST_TTL_MS;
    for (const r of rows) {
      this.costs.set(r.variantId, r.unitCost == null ? null : Number(r.unitCost));
      // rows cached before the sku column existed are refreshed the next time the variant is seen (Amazon matches on sku)
      if (r.fetchedAt.getTime() < cutoff || r.sku == null) this.stale.add(r.variantId);
    }
  }

  /** Make sure every variant id has a (fresh) cost in the cache; failures are recorded, not thrown. */
  async ensure(variantIds: Iterable<string>): Promise<void> {
    if (this.error) return;
    const need = Array.from(new Set(variantIds)).filter((id) => !this.costs.has(id) || this.stale.has(id));
    for (let i = 0; i < need.length; i += COST_BATCH) {
      const batch = need.slice(i, i + COST_BATCH);
      try {
        await this.fetchBatch(batch);
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        return;
      }
    }
  }

  private async fetchBatch(ids: string[]): Promise<void> {
    type Node = { id: string; sku?: string | null; inventoryItem?: { id?: string; unitCost?: { amount?: string; currencyCode?: string } | null } | null } | null;
    const data = await shopifyGraphql<{ nodes: Node[] }>(this.host, this.auth, `
      query VariantCosts($ids: [ID!]!) {
        nodes(ids: $ids) { ... on ProductVariant { id sku inventoryItem { id unitCost { amount currencyCode } } } }
      }`, { ids: ids.map((id) => `gid://shopify/ProductVariant/${id}`) });
    const now = new Date();
    const values = ids.map((id, i) => {
      const node = data.nodes[i];
      const amount = node?.inventoryItem?.unitCost?.amount;
      const cost = amount != null && amount !== "" ? Number(amount) : null;
      this.costs.set(id, Number.isFinite(cost as number) ? cost : null);
      this.stale.delete(id);
      return {
        brandId: this.config.brandId, variantId: id,
        inventoryItemId: node?.inventoryItem?.id?.split("/").pop() ?? null,
        // "" when the variant has no SKU in Shopify (so it is not refetched every run); null only for deleted variants
        sku: node ? (node.sku ?? "").trim() : null,
        unitCost: cost != null && Number.isFinite(cost) ? cost.toFixed(4) : null,
        currency: node?.inventoryItem?.unitCost?.currencyCode ?? null,
        fetchedAt: now,
      };
    });
    await db.insert(schema.performanceVariantCosts).values(values).onConflictDoUpdate({
      target: [schema.performanceVariantCosts.brandId, schema.performanceVariantCosts.variantId],
      set: { inventoryItemId: sql`excluded.inventory_item_id`, sku: sql`excluded.sku`, unitCost: sql`excluded.unit_cost`, currency: sql`excluded.currency`, fetchedAt: sql`excluded.fetched_at` },
    });
  }

  /** [cogs, complete] for an order; cogs null when no line item had a cost. */
  cogsFor(order: ShopifyOrder): [string | null, boolean] {
    const items = order.line_items ?? [];
    if (!items.length) return [null, false];
    let sum = 0, known = 0;
    for (const li of items) {
      const vid = li.variant_id != null ? String(li.variant_id) : null;
      const cost = vid ? this.costs.get(vid) : undefined;
      if (cost == null) continue;
      sum += cost * (li.quantity ?? 1); known++;
    }
    return [known ? (Math.round(sum * 100) / 100).toFixed(2) : null, known === items.length];
  }
}

export interface SyncResult { rows: number; cursor: string | null }

/**
 * Pull orders (backfill or incremental) and upsert them. `cursor` is the max updated_at
 * seen so far (ISO); null = backfill. Returns the new cursor.
 */
export async function syncShopifyOrders(config: PerformanceClientConfig, cursor: string | null, onProgress?: (rows: number) => void): Promise<SyncResult> {
  const { shopDomain } = config.shopify;
  if (!shopDomain) throw new Error("Shopify is not connected (shop domain missing)");
  const host = shopHost(shopDomain);
  const auth = tokenSource(config);
  await fetchShopInfo(config, host, auth); // keeps currency + time zone current; cheap
  const base = `https://${host}/admin/api/${SHOPIFY_API_VERSION}/orders.json`;
  const params = new URLSearchParams({ status: "any", limit: "250", fields: FIELDS });
  if (cursor) params.set("updated_at_min", cursor);
  else params.set("created_at_min", backfillStart().toISOString());
  // Shopify's cursor pagination (page_info) forbids changing filters, so page requests carry only limit + page_info.
  // Product lines were configured after the orders were synced (no line items stored yet): one full
  // re-pull of the window brings the line items in; afterwards every sync keeps them current.
  if (cursor && config.productLines.length && !(await hasOrderLines(config.brandId))) {
    params.delete("updated_at_min"); params.set("created_at_min", backfillStart().toISOString());
  }
  let url: string | null = `${base}?${params.toString()}`;
  let rows = 0;
  let maxUpdated = cursor ?? "";
  const costs = new VariantCostCache(config, host, auth);
  await costs.load();
  while (url) {
    const { body, link }: { body: unknown; link: string | null } = await shopifyGet(url, auth);
    const orders = ((body as { orders?: ShopifyOrder[] }).orders ?? []);
    if (orders.length) {
      await costs.ensure(orders.flatMap((o) => (o.line_items ?? []).flatMap((li) => (li.variant_id != null ? [String(li.variant_id)] : []))));
      await upsertOrders(config, orders, costs);
      rows += orders.length;
      for (const o of orders) if (o.updated_at > maxUpdated) maxUpdated = o.updated_at;
      onProgress?.(rows);
    }
    const next = nextPageInfo(link);
    url = next ? `${base}?limit=250&fields=${encodeURIComponent(FIELDS)}&page_info=${encodeURIComponent(next)}` : null;
  }
  const customerError = await fetchCustomerOrderCounts(config, host, auth);
  await recomputeNewCustomer(config);
  // Orders are in; if unit costs or customer counts could not be loaded, surface it (status = error)
  // so the margin isn't silently 100% and new customers aren't silently under-counted.
  const problems = [
    costs.error && `cost of goods could not be loaded: ${costs.error}`,
    customerError && `customer order counts could not be loaded: ${customerError}`,
  ].filter(Boolean);
  if (problems.length) throw new Error(`Orders synced (${rows}), but ${problems.join("; ")}`);
  return { rows, cursor: maxUpdated || cursor };
}

async function hasOrderLines(brandId: string): Promise<boolean> {
  const [r] = (await db.execute<{ n: string }>(sql`SELECT COUNT(*)::text AS n FROM performance_order_lines WHERE brand_id = ${brandId}`)).rows;
  return Number(r?.n ?? 0) > 0;
}

/** Replace the stored line items of these orders (ids = performance_orders.id by Shopify order id). */
async function upsertOrderLines(config: PerformanceClientConfig, orders: ShopifyOrder[], ids: Map<string, string>): Promise<void> {
  const values: Array<typeof schema.performanceOrderLines.$inferInsert> = [];
  for (const o of orders) {
    const orderId = ids.get(String(o.id));
    if (!orderId) continue;
    const seen = new Set<string>();
    (o.line_items ?? []).forEach((li, i) => {
      const lineId = li.id != null ? String(li.id) : `i${i}`;
      if (seen.has(lineId)) return; seen.add(lineId);
      const qty = Number(li.quantity ?? 1) || 0;
      const gross = Math.round(Number(li.price ?? 0) * qty * 100) / 100;
      const net = Math.max(0, Math.round((gross - Number(li.total_discount ?? 0)) * 100) / 100);
      values.push({
        brandId: config.brandId, orderId, lineId,
        title: li.title ?? "", variantTitle: li.variant_title ?? null, sku: li.sku ?? null,
        productId: li.product_id != null ? String(li.product_id) : null, variantId: li.variant_id != null ? String(li.variant_id) : null,
        quantity: qty, gross: gross.toFixed(2), net: net.toFixed(2),
        productLine: productLineForTitle(li.title, config.productLines),
      });
    });
  }
  const orderIds = Array.from(new Set(Array.from(ids.values())));
  await db.transaction(async (tx) => {
    if (orderIds.length) await tx.delete(schema.performanceOrderLines).where(and(eq(schema.performanceOrderLines.brandId, config.brandId), inArray(schema.performanceOrderLines.orderId, orderIds)));
    for (let i = 0; i < values.length; i += 500) await tx.insert(schema.performanceOrderLines).values(values.slice(i, i + 500));
  });
}

async function upsertOrders(config: PerformanceClientConfig, orders: ShopifyOrder[], costs: VariantCostCache): Promise<void> {
  const values = orders.map((o) => {
    const [cogs, cogsComplete] = costs.cogsFor(o);
    const country = o.shipping_address?.country_code ?? o.billing_address?.country_code ?? o.customer?.default_address?.country_code ?? null;
    const customerKey = o.customer?.id != null ? `id:${o.customer.id}` : (o.email ?? o.customer?.email) ? `email:${(o.email ?? o.customer?.email ?? "").toLowerCase()}` : null;
    return {
      brandId: config.brandId,
      channel: "shopify",
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
      cogs, cogsComplete,
    };
  });
  const saved = await db
    .insert(schema.performanceOrders)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.performanceOrders.brandId, schema.performanceOrders.channel, schema.performanceOrders.shopifyOrderId],
      set: {
        createdAt: sql`excluded.created_at`, updatedAt: sql`excluded.updated_at`,
        customerKey: sql`excluded.customer_key`, customerCreatedAt: sql`excluded.customer_created_at`,
        country: sql`excluded.country`, region: sql`excluded.region`,
        totalPrice: sql`excluded.total_price`, subtotalPrice: sql`excluded.subtotal_price`,
        currency: sql`excluded.currency`, financialStatus: sql`excluded.financial_status`,
        cancelled: sql`excluded.cancelled`, test: sql`excluded.test`,
        cogs: sql`excluded.cogs`, cogsComplete: sql`excluded.cogs_complete`,
      },
    })
    .returning({ id: schema.performanceOrders.id, shopifyOrderId: schema.performanceOrders.shopifyOrderId });
  await upsertOrderLines(config, orders, new Map(saved.map((r) => [r.shopifyOrderId, r.id])));
}

/**
 * Recompute is_new_customer for the whole brand (cheap: one window query per sync). Runs over both
 * channels at once; Shopify keys ("id:…", "email:…") and Amazon keys ("amz:…") never coincide, so
 * new/returning is effectively per channel.
 */
export async function recomputeNewCustomer(config: PerformanceClientConfig): Promise<void> {
  const start = await historyStart(config);
  const windowMs = config.ncWindowDays * 86_400_000;
  // first_ever: no earlier visible order, and — for customers whose record predates the history
  // start — Shopify's lifetime count says none is hidden either. Without a count, such customers
  // count as returning (they may have earlier orders we cannot see).
  const rule = config.ncDefinition === "window_days"
    ? sql`(r.prev_created IS NULL OR (EXTRACT(EPOCH FROM (r.created_at - r.prev_created)) * 1000) > ${windowMs})`
    : sql`(r.prev_created IS NULL AND CASE
             WHEN r.hidden_orders IS NOT NULL THEN r.hidden_orders = 0
             ELSE (r.customer_created_at IS NULL OR r.customer_created_at >= ${start.toISOString()}::timestamptz)
           END)`;
  await db.execute(sql`
    UPDATE performance_orders o SET is_new_customer = r.is_nc
    FROM (
      SELECT id,
             CASE WHEN customer_key IS NULL THEN TRUE ELSE ${rule} END AS is_nc
      FROM (
        SELECT p.id, p.customer_key, p.created_at, p.customer_created_at, c.hidden_orders,
               LAG(p.created_at) OVER (PARTITION BY p.customer_key ORDER BY p.created_at, p.id) AS prev_created
        FROM performance_orders p
        LEFT JOIN performance_customers c ON c.brand_id = p.brand_id AND c.customer_key = p.customer_key
        WHERE p.brand_id = ${config.brandId} AND p.cancelled = FALSE AND p.test = FALSE
      ) r
    ) r
    WHERE o.id = r.id AND o.is_new_customer IS DISTINCT FROM r.is_nc
  `);
}

/**
 * Where our order history starts: the oldest order we hold (a Partner-organization app only gets
 * the last 60 days) or the backfill start with full history. Customers created before it may have
 * orders we cannot see.
 */
async function historyStart(config: PerformanceClientConfig): Promise<Date> {
  const [oldest] = (await db.execute<{ min: string | null }>(sql`
    SELECT MIN(created_at)::text AS min FROM performance_orders
    WHERE brand_id = ${config.brandId} AND cancelled = FALSE AND test = FALSE
  `)).rows;
  const floor = oldest?.min ? new Date(oldest.min) : null;
  return floor && floor > backfillStart() ? floor : backfillStart();
}

/**
 * Lifetime order counts (Customer.numberOfOrders, needs read_customers) for Shopify customers whose
 * record predates the history start and have no cached count yet — fetched once per customer in
 * batches of 100 and stored with how many of those orders are missing from our table. Returns an
 * error message instead of throwing so the orders still sync (the NC rule then falls back).
 */
async function fetchCustomerOrderCounts(config: PerformanceClientConfig, host: string, auth: TokenSource): Promise<string | null> {
  const start = await historyStart(config);
  const need = (await db.execute<{ key: string }>(sql`
    SELECT DISTINCT o.customer_key AS key
    FROM performance_orders o
    LEFT JOIN performance_customers c ON c.brand_id = o.brand_id AND c.customer_key = o.customer_key
    WHERE o.brand_id = ${config.brandId} AND o.channel = 'shopify' AND o.customer_key LIKE 'id:%'
      AND c.id IS NULL
      AND (o.customer_created_at IS NULL OR o.customer_created_at < ${start.toISOString()}::timestamptz)
  `)).rows.map((r) => r.key);
  type Node = { id: string; numberOfOrders?: string | number | null } | null;
  for (let i = 0; i < need.length; i += CUSTOMER_BATCH) {
    const keys = need.slice(i, i + CUSTOMER_BATCH);
    try {
      const data = await shopifyGraphql<{ nodes: Node[] }>(host, auth, `
        query CustomerOrderCounts($ids: [ID!]!) {
          nodes(ids: $ids) { ... on Customer { id numberOfOrders } }
        }`, { ids: keys.map((k) => `gid://shopify/Customer/${k.slice(3)}`) });
      const visible = new Map((await db.select({ key: schema.performanceOrders.customerKey, n: sql<number>`count(*)::int` })
        .from(schema.performanceOrders)
        .where(and(eq(schema.performanceOrders.brandId, config.brandId), inArray(schema.performanceOrders.customerKey, keys)))
        .groupBy(schema.performanceOrders.customerKey)).map((r) => [r.key as string, Number(r.n)]));
      const now = new Date();
      const values = keys.flatMap((key, j) => {
        const n = data.nodes[j]?.numberOfOrders;
        const lifetime = n == null ? NaN : Number(n);
        if (!Number.isFinite(lifetime)) return []; // customer deleted or merged — leave the fallback rule
        return [{ brandId: config.brandId, customerKey: key, lifetimeOrders: lifetime, hiddenOrders: Math.max(0, lifetime - (visible.get(key) ?? 0)), fetchedAt: now }];
      });
      if (values.length) {
        await db.insert(schema.performanceCustomers).values(values).onConflictDoUpdate({
          target: [schema.performanceCustomers.brandId, schema.performanceCustomers.customerKey],
          set: { lifetimeOrders: sql`excluded.lifetime_orders`, hiddenOrders: sql`excluded.hidden_orders`, fetchedAt: sql`excluded.fetched_at` },
        });
      }
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
  return null;
}
