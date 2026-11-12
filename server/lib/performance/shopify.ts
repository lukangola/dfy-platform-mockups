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
 * performance_variant_costs and refreshed only when older than 30 days and seen again
 * in a synced order. cogs = Σ quantity × unit cost; cogs_complete = every line item had one.
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
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db.js";
import type { PerformanceClientConfig } from "./config.js";
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

interface ShopifyOrder {
  id: number; created_at: string; updated_at: string; processed_at?: string | null; cancelled_at?: string | null;
  test?: boolean; currency?: string; financial_status?: string | null;
  total_price?: string; subtotal_price?: string; email?: string | null;
  customer?: { id?: number; created_at?: string; email?: string | null; default_address?: { country_code?: string | null } | null } | null;
  shipping_address?: { country_code?: string | null } | null;
  billing_address?: { country_code?: string | null } | null;
  line_items?: Array<{ variant_id?: number | null; quantity?: number | null }>;
}

export function regionFor(country: string | null | undefined, mapping: Record<string, RegionKey>): RegionKey {
  if (!country) return "OTH";
  return mapping[country.toUpperCase()] ?? "OTH";
}

function shopHost(domain: string): string {
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
type TokenSource = (fresh?: boolean) => Promise<string>;
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

function tokenSource(config: PerformanceClientConfig): TokenSource {
  return (fresh) => shopifyAccessToken(config, fresh);
}

/** GET with Shopify rate-limit handling (429 → wait Retry-After, default 2s); one retry with a fresh token on 401. */
async function shopifyGet(url: string, auth: TokenSource): Promise<{ body: unknown; link: string | null }> {
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
        throw new Error(`Shopify: unit costs need the read_products + read_inventory scopes on the app (${msg})`);
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

export async function testShopify(config: PerformanceClientConfig): Promise<{
  ok: true; shop: string; currency: string | null; scopes: string[]; missingScopes: string[]; writeScopes: string[];
  history: ShopifyHistoryProbe | null;
}> {
  const { shopDomain } = config.shopify;
  if (!shopDomain) throw new Error("Shopify shop domain is required");
  const host = shopHost(shopDomain);
  const auth = tokenSource(config);
  await auth(true); // validate the credentials as typed, not a cached token
  const { body } = await shopifyGet(`https://${host}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, auth);
  const shop = (body as { shop?: { name?: string; currency?: string } }).shop;
  let scopes: string[] = [];
  try {
    const r = await shopifyGet(`https://${host}/admin/oauth/access_scopes.json`, auth);
    scopes = ((r.body as { access_scopes?: Array<{ handle: string }> }).access_scopes ?? []).map((x) => x.handle).sort();
  } catch { /* older tokens may not expose scopes — not fatal */ }
  const have = new Set(scopes);
  const history = await probeOrderHistory(host, auth);
  return {
    ok: true, shop: shop?.name ?? host, currency: shop?.currency ?? null, scopes,
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
    const rows = await db.select({ variantId: schema.performanceVariantCosts.variantId, unitCost: schema.performanceVariantCosts.unitCost, fetchedAt: schema.performanceVariantCosts.fetchedAt })
      .from(schema.performanceVariantCosts).where(eq(schema.performanceVariantCosts.brandId, this.config.brandId));
    const cutoff = Date.now() - COST_TTL_MS;
    for (const r of rows) {
      this.costs.set(r.variantId, r.unitCost == null ? null : Number(r.unitCost));
      if (r.fetchedAt.getTime() < cutoff) this.stale.add(r.variantId);
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
    type Node = { id: string; inventoryItem?: { id?: string; unitCost?: { amount?: string; currencyCode?: string } | null } | null } | null;
    const data = await shopifyGraphql<{ nodes: Node[] }>(this.host, this.auth, `
      query VariantCosts($ids: [ID!]!) {
        nodes(ids: $ids) { ... on ProductVariant { id inventoryItem { id unitCost { amount currencyCode } } } }
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
        unitCost: cost != null && Number.isFinite(cost) ? cost.toFixed(4) : null,
        currency: node?.inventoryItem?.unitCost?.currencyCode ?? null,
        fetchedAt: now,
      };
    });
    await db.insert(schema.performanceVariantCosts).values(values).onConflictDoUpdate({
      target: [schema.performanceVariantCosts.brandId, schema.performanceVariantCosts.variantId],
      set: { inventoryItemId: sql`excluded.inventory_item_id`, unitCost: sql`excluded.unit_cost`, currency: sql`excluded.currency`, fetchedAt: sql`excluded.fetched_at` },
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
  const base = `https://${host}/admin/api/${SHOPIFY_API_VERSION}/orders.json`;
  const params = new URLSearchParams({ status: "any", limit: "250", fields: FIELDS });
  if (cursor) params.set("updated_at_min", cursor);
  else params.set("created_at_min", backfillStart().toISOString());
  // Shopify's cursor pagination (page_info) forbids changing filters, so page requests carry only limit + page_info.
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
  await recomputeNewCustomer(config);
  // Orders are in; if unit costs could not be loaded, surface it (status = error) so the margin isn't silently 100%.
  if (costs.error) throw new Error(`Orders synced (${rows}), but cost of goods could not be loaded: ${costs.error}`);
  return { rows, cursor: maxUpdated || cursor };
}

async function upsertOrders(config: PerformanceClientConfig, orders: ShopifyOrder[], costs: VariantCostCache): Promise<void> {
  const values = orders.map((o) => {
    const [cogs, cogsComplete] = costs.cogsFor(o);
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
      cogs, cogsComplete,
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
        cogs: sql`excluded.cogs`, cogsComplete: sql`excluded.cogs_complete`,
      },
    });
}

/** Recompute is_new_customer for the whole brand (cheap: one window query per sync). */
export async function recomputeNewCustomer(config: PerformanceClientConfig): Promise<void> {
  // History floor: customers created before the oldest order we can see may have earlier orders
  // we cannot see (a Partner-organization app only gets the last 60 days), so they count as
  // returning. With full history this is the backfill start, as before.
  const [oldest] = (await db.execute<{ min: string | null }>(sql`
    SELECT MIN(created_at)::text AS min FROM performance_orders
    WHERE brand_id = ${config.brandId} AND cancelled = FALSE AND test = FALSE
  `)).rows;
  const floor = oldest?.min ? new Date(oldest.min) : null;
  const start = floor && floor > backfillStart() ? floor : backfillStart();
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
