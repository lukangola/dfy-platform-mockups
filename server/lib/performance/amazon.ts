/**
 * Amazon orders → performance_orders (channel = "amazon"), next to the Shopify rows.
 *
 * Selling Partner API (SP-API), Orders API only — the read-only "Inventory and Order Tracking"
 * role of a private, self-authorised Seller Central app. Nothing is ever written to Seller Central.
 * Auth: Login-with-Amazon (LWA) refresh token + the app's client id / secret, swapped here for
 * 1-hour access tokens (cached per brand in memory, never stored). No AWS signing is needed any more.
 *
 *   First run : every order created since backfillStart() (CreatedAfter), 100/page via NextToken.
 *   Next runs : LastUpdatedAfter = cursor (max LastUpdateDate seen), so status changes and
 *               cancellations come through without a webhook.
 *   Items     : getOrderItems per order for SKU + quantity → cost of goods, matched against the
 *               Shopify variant SKUs cached in performance_variant_costs (case-insensitive).
 *               An order with any unmatched SKU keeps cogs_complete = false, so the dashboard's
 *               margin-coverage warning fires.
 *   Excluded  : Pending / PendingAvailability orders are not stored (no total yet; they come back
 *               as Unshipped on the next incremental run). Canceled and Unfulfillable orders are
 *               stored with cancelled = true so an earlier row is neutralised.
 *   Region    : ShippingAddress.CountryCode when Amazon returns it, else the marketplace's country
 *               (amazon.de → DE). The sync log counts how many orders used the fallback.
 *   Customer  : BuyerInfo.BuyerEmail (an anonymised, per-buyer address that is stable across that
 *               buyer's orders) → customer_key "amz:<email>". It is PII for Amazon, so it needs a
 *               Restricted Data Token (Tokens API) and the "Direct-to-Consumer Shipping (Restricted)"
 *               role on the app; without that role the key is null and such orders count as
 *               new-customer (same rule as Shopify guests). NC/RC is per channel: an Amazon buyer
 *               who also bought on Shopify is "new" on both.
 *
 * Rate limits: Amazon answers 429 (QuotaExceeded) and tells the per-second rate in
 * x-amzn-RateLimit-Limit; after a 429 the client paces that operation at that rate. getOrders is
 * 0.0167/s (burst 20) — one page a minute once the burst is used — and getOrderItems 0.5/s, so a
 * first backfill of a few thousand orders takes a while. It runs in the background and upserts
 * page by page, so the dashboard fills up progressively.
 */
import { sql } from "drizzle-orm";
import { db, schema } from "../db.js";
import type { AmazonRegion, PerformanceClientConfig } from "./config.js";
import { recomputeNewCustomer, regionFor } from "./shopify.js";
import { backfillStart, sleep } from "./time.js";

export const SP_API_ENDPOINTS: Record<AmazonRegion, string> = {
  EU: "https://sellingpartnerapi-eu.amazon.com",
  NA: "https://sellingpartnerapi-na.amazon.com",
  FE: "https://sellingpartnerapi-fe.amazon.com",
};
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const PAGE_SIZE = 100;
const MAX_ATTEMPTS = 8;
const TOKEN_RENEW_MARGIN_MS = 5 * 60_000;

export interface MarketplaceInfo { id: string; name: string; country: string | null; currency: string | null }

/** Fallback when the Sellers API can't be read: the public marketplace ids per region. */
export const KNOWN_MARKETPLACES: Record<string, Omit<MarketplaceInfo, "id"> & { region: AmazonRegion }> = {
  A1PA6795UKMFR9: { name: "Amazon.de", country: "DE", currency: "EUR", region: "EU" },
  A1F83G8C2ARO7P: { name: "Amazon.co.uk", country: "GB", currency: "GBP", region: "EU" },
  A13V1IB3VIYZZH: { name: "Amazon.fr", country: "FR", currency: "EUR", region: "EU" },
  APJ6JRA9NG5V4: { name: "Amazon.it", country: "IT", currency: "EUR", region: "EU" },
  A1RKKUPIHCS9HS: { name: "Amazon.es", country: "ES", currency: "EUR", region: "EU" },
  A1805IZSGTT6HS: { name: "Amazon.nl", country: "NL", currency: "EUR", region: "EU" },
  AMEN7PMS3EDWL: { name: "Amazon.com.be", country: "BE", currency: "EUR", region: "EU" },
  A2NODRKZP88ZB9: { name: "Amazon.se", country: "SE", currency: "SEK", region: "EU" },
  A1C3SOZRARQ6R3: { name: "Amazon.pl", country: "PL", currency: "PLN", region: "EU" },
  A28R8C7NBKEWEA: { name: "Amazon.ie", country: "IE", currency: "EUR", region: "EU" },
  A33AVAJ2PDY3EV: { name: "Amazon.com.tr", country: "TR", currency: "TRY", region: "EU" },
  A2VIGQ35RCS4UG: { name: "Amazon.ae", country: "AE", currency: "AED", region: "EU" },
  A17E79C6D8DWNP: { name: "Amazon.sa", country: "SA", currency: "SAR", region: "EU" },
  ARBP9OOSHTCHU: { name: "Amazon.eg", country: "EG", currency: "EGP", region: "EU" },
  A21TJRUUN4KGV: { name: "Amazon.in", country: "IN", currency: "INR", region: "EU" },
  ATVPDKIKX0DER: { name: "Amazon.com", country: "US", currency: "USD", region: "NA" },
  A2EUQ1WTGCTBG2: { name: "Amazon.ca", country: "CA", currency: "CAD", region: "NA" },
  A1AM78C64UM0Y8: { name: "Amazon.com.mx", country: "MX", currency: "MXN", region: "NA" },
  A2Q3Y263D00KWC: { name: "Amazon.com.br", country: "BR", currency: "BRL", region: "NA" },
  A1VC38T7YXB528: { name: "Amazon.co.jp", country: "JP", currency: "JPY", region: "FE" },
  A39IBJ37TRP1C6: { name: "Amazon.com.au", country: "AU", currency: "AUD", region: "FE" },
  A19VAU5U5O7RUS: { name: "Amazon.sg", country: "SG", currency: "SGD", region: "FE" },
};

/** "Amazon.co.uk" → GB, "Amazon.com" → US, "Amazon.de" → DE — last resort for an unknown marketplace. */
export function countryFromSalesChannel(salesChannel: string | null | undefined): string | null {
  const host = (salesChannel ?? "").trim().toLowerCase().replace(/^https?:\/\//, "");
  const m = host.match(/^(?:www\.)?amazon\.(.+)$/);
  if (!m) return null;
  const tld = m[1];
  const special: Record<string, string> = { "co.uk": "GB", com: "US", "com.mx": "MX", "com.br": "BR", "com.be": "BE", "com.au": "AU", "com.tr": "TR", "co.jp": "JP" };
  if (special[tld]) return special[tld];
  return /^[a-z]{2}$/.test(tld) ? tld.toUpperCase() : null;
}

// ── HTTP client: LWA tokens, rate limits, Restricted Data Tokens ───────────────────────────────

interface AmazonOrder {
  AmazonOrderId: string; PurchaseDate: string; LastUpdateDate: string; OrderStatus: string;
  MarketplaceId?: string; SalesChannel?: string; FulfillmentChannel?: string;
  OrderTotal?: { CurrencyCode?: string; Amount?: string } | null;
  ShippingAddress?: { CountryCode?: string | null } | null;
  BuyerInfo?: { BuyerEmail?: string | null } | null;
}
interface AmazonOrderItem {
  OrderItemId?: string; SellerSKU?: string | null; ASIN?: string | null; QuantityOrdered?: number;
  ItemPrice?: { CurrencyCode?: string; Amount?: string } | null;
  PromotionDiscount?: { CurrencyCode?: string; Amount?: string } | null;
}
interface SpApiError { errors?: Array<{ code?: string; message?: string; details?: string }> }

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
export function forgetAmazonToken(brandId: string): void { tokenCache.delete(brandId); }

/** Test hook: the scratch test swaps the real sleep for a no-op so 429 handling is fast. */
let sleepFn: (ms: number) => Promise<void> = sleep;
export function __setAmazonSleepForTests(fn: (ms: number) => Promise<void>): void { sleepFn = fn; }

export class AmazonClient {
  readonly base: string;
  /** per operation: minimum ms between calls once Amazon has throttled us (from x-amzn-RateLimit-Limit) */
  private readonly pace = new Map<string, { everyMs: number; nextAt: number }>();
  private rdt: { token: string; expiresAt: number } | null = null;
  /** why buyer info / shipping PII is not available (missing restricted role), once known */
  rdtError: string | null = null;

  constructor(private readonly config: PerformanceClientConfig) {
    this.base = SP_API_ENDPOINTS[config.amazon.region] ?? SP_API_ENDPOINTS.EU;
  }

  async accessToken(fresh = false): Promise<string> {
    const { clientId, clientSecret, refreshToken } = this.config.amazon;
    if (!clientId || !clientSecret || !refreshToken) throw new Error("Amazon is not connected: paste the app's LWA client id, client secret and refresh token");
    const hit = tokenCache.get(this.config.brandId);
    if (!fresh && hit && hit.expiresAt - Date.now() > TOKEN_RENEW_MARGIN_MS) return hit.token;
    const res = await fetch(LWA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      const detail = body.error_description ?? body.error ?? `${res.status} ${res.statusText}`;
      if (body.error === "invalid_client") throw new Error(`Amazon rejected the LWA client id / client secret (${detail})`);
      if (body.error === "invalid_grant") throw new Error(`Amazon rejected the refresh token (${detail}). In Seller Central → Develop Apps → Authorize, generate a new refresh token and paste it here.`);
      throw new Error(`Amazon token exchange failed: ${detail}`);
    }
    const ttl = Number(body.expires_in) > 0 ? Number(body.expires_in) * 1000 : 3_600_000;
    tokenCache.set(this.config.brandId, { token: body.access_token, expiresAt: Date.now() + ttl });
    return body.access_token;
  }

  /**
   * One SP-API call with throttling: 429 → wait 1/rate (header) with backoff and retry; one retry
   * with a fresh LWA token on 401; other errors throw with Amazon's message.
   */
  async request<T>(op: string, method: "GET" | "POST", path: string, params?: Record<string, string>, opts: { body?: unknown; token?: string } = {}): Promise<T> {
    const url = `${this.base}${path}${params && Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : ""}`;
    let renewed = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await this.waitFor(op);
      const token = opts.token ?? await this.accessToken();
      const res = await fetch(url, {
        method,
        headers: { "x-amz-access-token": token, Accept: "application/json", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const rate = Number(res.headers.get("x-amzn-RateLimit-Limit") ?? "");
      if (res.status === 429) {
        const everyMs = rate > 0 ? Math.ceil(1000 / rate) : 2000;
        this.pace.set(op, { everyMs, nextAt: Date.now() + everyMs });
        await sleepFn(Math.min(everyMs * (attempt + 1), 65_000));
        continue;
      }
      if (res.status === 401 && !renewed && !opts.token) { renewed = true; await this.accessToken(true); continue; }
      if (res.status === 503 && attempt < MAX_ATTEMPTS - 1) { await sleepFn(2000 * (attempt + 1)); continue; }
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        let detail = text.slice(0, 300);
        try { const e = (JSON.parse(text) as SpApiError).errors?.[0]; if (e) detail = `${e.code ?? ""} ${e.message ?? ""}${e.details ? ` — ${e.details}` : ""}`.trim(); } catch { /* keep raw */ }
        throw new Error(`Amazon ${res.status} on ${op}: ${detail}`);
      }
      return (text ? JSON.parse(text) : {}) as T;
    }
    throw new Error(`Amazon: ${op} rate limited repeatedly`);
  }

  private async waitFor(op: string): Promise<void> {
    const p = this.pace.get(op);
    if (!p) return;
    const wait = p.nextAt - Date.now();
    if (wait > 0) await sleepFn(wait);
    p.nextAt = Math.max(Date.now(), p.nextAt) + p.everyMs;
  }

  /**
   * Restricted Data Token for getOrders with buyer info + shipping address. Needs the
   * "Direct-to-Consumer Shipping (Restricted)" role; without it Amazon answers 403 and we carry
   * on without PII (country from the marketplace, no customer key). Never throws.
   */
  async restrictedToken(): Promise<string | null> {
    if (this.rdtError) return null;
    if (this.rdt && this.rdt.expiresAt - Date.now() > TOKEN_RENEW_MARGIN_MS) return this.rdt.token;
    try {
      const r = await this.request<{ restrictedDataToken?: string; expiresIn?: number }>("createRestrictedDataToken", "POST", "/tokens/2021-03-01/restrictedDataToken", undefined, {
        body: { restrictedResources: [{ method: "GET", path: "/orders/v0/orders", dataElements: ["buyerInfo", "shippingAddress"] }] },
      });
      if (!r.restrictedDataToken) throw new Error("Amazon returned no restricted data token");
      this.rdt = { token: r.restrictedDataToken, expiresAt: Date.now() + (Number(r.expiresIn) > 0 ? Number(r.expiresIn) * 1000 : 3_600_000) };
      return this.rdt.token;
    } catch (err) {
      this.rdtError = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  /** Marketplaces the seller participates in (Sellers API; available to every app). */
  async marketplaces(): Promise<MarketplaceInfo[]> {
    type Part = { marketplace?: { id?: string; name?: string; countryCode?: string; defaultCurrencyCode?: string }; participation?: { isParticipating?: boolean } };
    const r = await this.request<{ payload?: Part[] }>("getMarketplaceParticipations", "GET", "/sellers/v1/marketplaceParticipations");
    return (r.payload ?? []).filter((p) => p.marketplace?.id && p.participation?.isParticipating !== false).map((p) => ({
      id: p.marketplace!.id!, name: p.marketplace!.name ?? p.marketplace!.id!,
      country: p.marketplace!.countryCode?.toUpperCase() ?? null, currency: p.marketplace!.defaultCurrencyCode ?? null,
    }));
  }

  /** Seller's business name (Sellers API getAccount; newer endpoint — advisory, never fatal). */
  async sellerName(): Promise<string | null> {
    try {
      const r = await this.request<{ payload?: { business?: { name?: string }; businessType?: string } }>("getAccount", "GET", "/sellers/v1/account");
      return r.payload?.business?.name ?? null;
    } catch { return null; }
  }

  async ordersPage(params: Record<string, string>, rdt: string | null): Promise<{ orders: AmazonOrder[]; nextToken: string | null }> {
    const r = await this.request<{ payload?: { Orders?: AmazonOrder[]; NextToken?: string } }>("getOrders", "GET", "/orders/v0/orders", params, rdt ? { token: rdt } : {});
    return { orders: r.payload?.Orders ?? [], nextToken: r.payload?.NextToken ?? null };
  }

  async orderItems(orderId: string): Promise<AmazonOrderItem[]> {
    const out: AmazonOrderItem[] = [];
    let next: string | null = null;
    do {
      const params: Record<string, string> = next ? { NextToken: next } : {};
      const r: { payload?: { OrderItems?: AmazonOrderItem[]; NextToken?: string } } =
        await this.request("getOrderItems", "GET", `/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems`, params);
      out.push(...(r.payload?.OrderItems ?? []));
      next = r.payload?.NextToken ?? null;
    } while (next);
    return out;
  }
}

// ── Pull (DB-free) ─────────────────────────────────────────────────────────────────────────────

export type OrderRow = typeof schema.performanceOrders.$inferInsert;
export interface PullStats {
  /** orders stored (incl. cancelled ones) */ rows: number;
  /** Pending / PendingAvailability orders skipped */ pending: number;
  cancelled: number;
  /** country taken from ShippingAddress vs. the marketplace */ countryFromShipping: number; countryFromMarketplace: number;
  /** orders with every SKU matched to a Shopify unit cost */ cogsComplete: number;
  /** distinct Amazon SKUs with no matching Shopify SKU */ unmatchedSkus: string[];
  buyerInfo: boolean;
}
export interface PullResult extends PullStats { cursor: string | null; pages: number }

export const normalizeSku = (sku: string | null | undefined): string => (sku ?? "").trim().toUpperCase();

/**
 * Marketplace ids to pull: the configured list, else every marketplace the seller participates in
 * (resolved once per run through the Sellers API; falls back to the public ids of the region).
 */
export async function resolveMarketplaces(client: AmazonClient, config: PerformanceClientConfig): Promise<MarketplaceInfo[]> {
  const configured = config.amazon.marketplaceIds;
  let known: MarketplaceInfo[] = [];
  try { known = await client.marketplaces(); } catch { /* fall back to the static table */ }
  const byId = new Map<string, MarketplaceInfo>(known.map((m) => [m.id, m]));
  for (const [id, m] of Object.entries(KNOWN_MARKETPLACES)) if (!byId.has(id)) byId.set(id, { id, ...m });
  if (configured.length) return configured.map((id) => byId.get(id) ?? { id, name: id, country: null, currency: null });
  if (known.length) return known;
  return Object.entries(KNOWN_MARKETPLACES).filter(([, m]) => m.region === config.amazon.region).map(([id, m]) => ({ id, ...m }));
}

const SKIP_STATUSES = new Set(["Pending", "PendingAvailability"]);
const CANCELLED_STATUSES = new Set(["Canceled", "Cancelled", "Unfulfillable"]);

/**
 * Walk getOrders (backfill or incremental), fetch items for live orders, build rows and hand each
 * page to `onPage` (the DB upsert). `costForSku` maps a normalised SKU to a unit cost (null = no
 * cost known). Returns stats + the new cursor (max LastUpdateDate seen, else the old cursor).
 */
export async function pullAmazonOrders(
  client: AmazonClient, config: PerformanceClientConfig, cursor: string | null,
  deps: { marketplaces: MarketplaceInfo[]; costForSku: (sku: string) => number | null | undefined; onPage: (rows: OrderRow[]) => Promise<void> },
): Promise<PullResult> {
  const ids = deps.marketplaces.map((m) => m.id);
  if (!ids.length) throw new Error("Amazon: no marketplace to pull — the seller participates in none, and none is configured");
  const mk = new Map(deps.marketplaces.map((m) => [m.id, m]));
  const rdt = await client.restrictedToken();
  const stats: PullStats = { rows: 0, pending: 0, cancelled: 0, countryFromShipping: 0, countryFromMarketplace: 0, cogsComplete: 0, unmatchedSkus: [], buyerInfo: Boolean(rdt) };
  const unmatched = new Set<string>();
  const base: Record<string, string> = { MarketplaceIds: ids.join(","), MaxResultsPerPage: String(PAGE_SIZE) };
  if (cursor) base.LastUpdatedAfter = cursor; else base.CreatedAfter = backfillStart().toISOString();
  let next: string | null = null;
  let maxUpdated = cursor ?? "";
  let pages = 0;
  do {
    const page: { orders: AmazonOrder[]; nextToken: string | null } = await client.ordersPage(next ? { ...base, NextToken: next } : base, rdt);
    pages++;
    const rows: OrderRow[] = [];
    for (const o of page.orders) {
      if (!o.AmazonOrderId || !o.PurchaseDate) continue;
      if (o.LastUpdateDate && o.LastUpdateDate > maxUpdated) maxUpdated = o.LastUpdateDate;
      if (SKIP_STATUSES.has(o.OrderStatus)) { stats.pending++; continue; }
      const cancelled = CANCELLED_STATUSES.has(o.OrderStatus);
      const market = o.MarketplaceId ? mk.get(o.MarketplaceId) : undefined;
      const shipCountry = o.ShippingAddress?.CountryCode?.trim().toUpperCase() || null;
      const country = shipCountry ?? market?.country ?? KNOWN_MARKETPLACES[o.MarketplaceId ?? ""]?.country ?? countryFromSalesChannel(o.SalesChannel);
      if (shipCountry) stats.countryFromShipping++; else stats.countryFromMarketplace++;
      let cogs: string | null = null, cogsComplete = false, subtotal: string | null = null;
      if (!cancelled) {
        const items = await client.orderItems(o.AmazonOrderId);
        const live = items.filter((it) => (it.QuantityOrdered ?? 0) > 0);
        let sum = 0, known = 0, sub = 0, priced = 0;
        for (const it of live) {
          const sku = normalizeSku(it.SellerSKU);
          const cost = sku ? deps.costForSku(sku) : null;
          if (cost != null && Number.isFinite(cost)) { sum += cost * (it.QuantityOrdered ?? 1); known++; } else unmatched.add(it.SellerSKU?.trim() || `ASIN:${it.ASIN ?? "?"}`);
          const price = Number(it.ItemPrice?.Amount);
          if (Number.isFinite(price)) { sub += price - (Number(it.PromotionDiscount?.Amount) || 0); priced++; }
        }
        cogs = known ? (Math.round(sum * 100) / 100).toFixed(2) : null;
        cogsComplete = live.length > 0 && known === live.length;
        if (live.length && priced === live.length) subtotal = (Math.round(sub * 100) / 100).toFixed(2);
        if (cogsComplete) stats.cogsComplete++;
      } else stats.cancelled++;
      const email = o.BuyerInfo?.BuyerEmail?.trim().toLowerCase() || null;
      rows.push({
        brandId: config.brandId, channel: "amazon", shopifyOrderId: o.AmazonOrderId,
        createdAt: new Date(o.PurchaseDate), updatedAt: o.LastUpdateDate ? new Date(o.LastUpdateDate) : null,
        customerKey: email ? `amz:${email}` : null, customerCreatedAt: null,
        country, region: regionFor(country, config.regionMapping),
        totalPrice: o.OrderTotal?.Amount && Number.isFinite(Number(o.OrderTotal.Amount)) ? Number(o.OrderTotal.Amount).toFixed(2) : "0",
        subtotalPrice: subtotal, currency: o.OrderTotal?.CurrencyCode ?? market?.currency ?? null,
        financialStatus: o.OrderStatus ? o.OrderStatus.toLowerCase() : null,
        cancelled, test: false, cogs, cogsComplete,
      });
    }
    if (rows.length) { await deps.onPage(rows); stats.rows += rows.length; }
    next = page.nextToken;
  } while (next);
  stats.unmatchedSkus = Array.from(unmatched).sort();
  return { ...stats, cursor: maxUpdated || cursor, pages };
}

// ── DB side ────────────────────────────────────────────────────────────────────────────────────

/** Shopify variant SKUs → unit cost for the brand (first non-null cost wins when SKUs repeat). */
export async function loadSkuCosts(brandId: string): Promise<Map<string, number>> {
  const rows = await db.execute<{ sku: string; unit_cost: string }>(sql`
    SELECT sku, unit_cost::text AS unit_cost FROM performance_variant_costs
    WHERE brand_id = ${brandId} AND sku IS NOT NULL AND unit_cost IS NOT NULL
    ORDER BY fetched_at DESC
  `);
  const m = new Map<string, number>();
  for (const r of rows.rows) {
    const k = normalizeSku(r.sku);
    if (k && !m.has(k)) m.set(k, Number(r.unit_cost));
  }
  return m;
}

export async function upsertAmazonOrders(rows: OrderRow[]): Promise<void> {
  if (!rows.length) return;
  await db.insert(schema.performanceOrders).values(rows).onConflictDoUpdate({
    target: [schema.performanceOrders.brandId, schema.performanceOrders.channel, schema.performanceOrders.shopifyOrderId],
    set: {
      createdAt: sql`excluded.created_at`, updatedAt: sql`excluded.updated_at`,
      customerKey: sql`excluded.customer_key`, country: sql`excluded.country`, region: sql`excluded.region`,
      totalPrice: sql`excluded.total_price`, subtotalPrice: sql`excluded.subtotal_price`, currency: sql`excluded.currency`,
      financialStatus: sql`excluded.financial_status`, cancelled: sql`excluded.cancelled`,
      cogs: sql`excluded.cogs`, cogsComplete: sql`excluded.cogs_complete`,
    },
  });
}

export interface AmazonSyncResult { rows: number; cursor: string | null }

/** Pull orders (backfill or incremental) into performance_orders and recompute NC/RC. */
export async function syncAmazonOrders(config: PerformanceClientConfig, cursor: string | null): Promise<AmazonSyncResult> {
  const client = new AmazonClient(config);
  const marketplaces = await resolveMarketplaces(client, config);
  const costs = await loadSkuCosts(config.brandId);
  const r = await pullAmazonOrders(client, config, cursor, { marketplaces, costForSku: (sku) => costs.get(sku) ?? null, onPage: upsertAmazonOrders });
  await recomputeNewCustomer(config);
  const notes = [
    `${r.pages} page(s)`, `${r.pending} pending skipped`, `${r.cancelled} cancelled`,
    `country from shipping ${r.countryFromShipping} / marketplace ${r.countryFromMarketplace}`,
    r.buyerInfo ? "buyer info on" : `buyer info off (${client.rdtError ?? "no restricted token"}) — Amazon orders count as new-customer`,
    r.unmatchedSkus.length ? `${r.unmatchedSkus.length} Amazon SKU(s) without a Shopify cost: ${r.unmatchedSkus.slice(0, 10).join(", ")}${r.unmatchedSkus.length > 10 ? ", …" : ""}` : "every SKU matched a Shopify cost",
  ];
  console.log(`[performance] ${config.name}: amazon — ${notes.join(" · ")}`);
  return { rows: r.rows, cursor: r.cursor };
}

/** Quick credential check for "Test connection": seller, marketplaces, oldest order in the backfill window, PII access. */
export async function testAmazon(config: PerformanceClientConfig): Promise<{
  ok: true; seller: string | null; region: AmazonRegion; marketplaces: MarketplaceInfo[];
  /** PurchaseDate of the oldest order in the first page since the backfill start (null = none) */
  oldestOrder: string | null;
  /** orders in that first page (100 = at least 100) */
  ordersSeen: number;
  backfillFrom: string;
  /** buyer email + shipping address readable (restricted role granted)? */
  buyerInfo: boolean; buyerInfoError: string | null;
}> {
  const client = new AmazonClient(config);
  await client.accessToken(true); // validate the credentials as typed, not a cached token
  const all = await client.marketplaces();
  const configured = new Set(config.amazon.marketplaceIds);
  const marketplaces = configured.size ? all.filter((m) => configured.has(m.id)) : all;
  const missing = Array.from(configured).filter((id) => !all.some((m) => m.id === id));
  if (missing.length) throw new Error(`This seller does not participate in marketplace ${missing.join(", ")} — check the marketplace ids (or leave the field empty for all)`);
  if (!marketplaces.length) throw new Error("This seller account participates in no marketplace on this region endpoint — try another region (EU / NA / FE)");
  const seller = await client.sellerName();
  const rdt = await client.restrictedToken();
  const from = backfillStart().toISOString();
  const page = await client.ordersPage({ MarketplaceIds: marketplaces.map((m) => m.id).join(","), CreatedAfter: from, MaxResultsPerPage: String(PAGE_SIZE) }, rdt);
  const dates = page.orders.map((o) => o.PurchaseDate).filter(Boolean).sort();
  return {
    ok: true, seller, region: config.amazon.region, marketplaces,
    oldestOrder: dates[0] ?? null, ordersSeen: page.orders.length, backfillFrom: from,
    buyerInfo: Boolean(rdt), buyerInfoError: client.rdtError,
  };
}
