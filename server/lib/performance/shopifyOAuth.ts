/**
 * Shopify install flow (authorization code grant) for apps that live in a Partner
 * organization and get installed on a client's store — the case where the
 * client-credentials exchange in shopify.ts is refused ("same organization").
 *
 *   1. GET /api/performance/shopify/install?brandId=  → 302 to
 *      https://{shop}/admin/oauth/authorize?client_id&scope&redirect_uri&state
 *   2. The manager approves the read-only scopes on the store.
 *   3. Shopify redirects to /api/performance/shopify/callback?code&hmac&shop&state&timestamp
 *      → state checked (one-time, 10 min), hmac checked with the client secret, shop checked
 *      against the brand's configured domain, code exchanged for a token.
 *   4. The token (plus refresh token + expiry for newer apps) is stored encrypted on the
 *      brand's config row; shopify.ts refreshes it when it is about to expire.
 *
 * The store only ever sees the four read_* scopes; nothing here can write to it.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db.js";
import { encryptSecret } from "./secrets.js";

export interface ShopifyTokenSet {
  token: string;
  /** null = non-expiring (legacy-style) token */
  expiresAt: Date | null;
  refreshToken: string | null;
}

interface PendingInstall { brandId: string; shop: string; origin: string; expiresAt: number }
/** Must match the redirect URL entered in the app's settings: `{origin}/api/performance/shopify/callback` */
export const SHOPIFY_CALLBACK_PATH = "/api/performance/shopify/callback";
const pending = new Map<string, PendingInstall>();
const STATE_TTL_MS = 10 * 60_000;

/** `my-shop` | `my-shop.myshopify.com` | `https://my-shop.myshopify.com/` → `my-shop.myshopify.com` */
export function shopifyShopHost(domain: string): string {
  const d = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return d.includes(".") ? d : `${d}.myshopify.com`;
}

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** Build the authorize URL and remember the one-time state for the callback. */
export function createShopifyInstallUrl(opts: { brandId: string; shopDomain: string; clientId: string; scopes: string[]; origin: string }): string {
  const shop = shopifyShopHost(opts.shopDomain);
  if (!SHOP_RE.test(shop)) throw new Error(`"${opts.shopDomain}" is not a myshopify.com domain`);
  const origin = opts.origin.replace(/\/+$/, "");
  if (!/^https?:\/\/[^/?#\s]+$/.test(origin)) throw new Error("origin must be an http(s) origin like http://localhost:3000");
  pending.forEach((v, k) => { if (v.expiresAt < Date.now()) pending.delete(k); });
  const state = randomBytes(24).toString("hex");
  pending.set(state, { brandId: opts.brandId, shop, origin, expiresAt: Date.now() + STATE_TTL_MS });
  const q = new URLSearchParams({ client_id: opts.clientId, scope: opts.scopes.join(","), redirect_uri: `${origin}${SHOPIFY_CALLBACK_PATH}`, state });
  return `https://${shop}/admin/oauth/authorize?${q.toString()}`;
}

/** Consume the state; returns the brand it was issued for, or null if unknown/expired. */
export function takeShopifyInstallState(state: string): PendingInstall | null {
  const p = pending.get(state);
  pending.delete(state);
  return p && p.expiresAt >= Date.now() ? p : null;
}

/** Shopify signs the callback query with the client secret: HMAC-SHA256 over the sorted params minus `hmac`. */
export function verifyShopifyCallbackHmac(query: Record<string, unknown>, clientSecret: string): boolean {
  const hmac = typeof query.hmac === "string" ? query.hmac : "";
  if (!/^[0-9a-f]{64}$/i.test(hmac)) return false;
  const message = Object.keys(query).filter((k) => k !== "hmac" && typeof query[k] === "string").sort()
    .map((k) => `${k}=${query[k] as string}`).join("&");
  const expected = createHmac("sha256", clientSecret).update(message).digest("hex");
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hmac, "hex"));
}

function parseTokenBody(body: Record<string, unknown>, fallbackRefresh: string | null): ShopifyTokenSet {
  const token = typeof body.access_token === "string" ? body.access_token : "";
  const expiresIn = Number(body.expires_in);
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : fallbackRefresh;
  return {
    token,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
    refreshToken,
  };
}

async function postToken(shop: string, form: Record<string, string>, what: string): Promise<ShopifyTokenSet> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const set = parseTokenBody(body, form.refresh_token ?? null);
  if (!res.ok || !set.token) {
    const detail = (body.error_description as string | undefined) ?? (body.error as string | undefined) ?? `${res.status} ${res.statusText}`;
    throw new Error(`Shopify ${what} failed: ${detail}`);
  }
  return set;
}

/** Step 3: swap the one-time code for a token. */
export function exchangeShopifyCode(shop: string, clientId: string, clientSecret: string, code: string): Promise<ShopifyTokenSet> {
  return postToken(shop, { client_id: clientId, client_secret: clientSecret, code }, "code exchange");
}

/** Newer apps: 1-hour tokens, renewed with the 90-day refresh token. */
export function refreshShopifyInstallToken(shop: string, clientId: string, clientSecret: string, refreshToken: string): Promise<ShopifyTokenSet> {
  return postToken(shop, { grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }, "token refresh");
}

/** Persist a token set on the brand's config row (encrypted). `installed` also stamps shopify_installed_at. */
export async function storeShopifyTokens(brandId: string, set: ShopifyTokenSet, installed = false): Promise<void> {
  const values: Partial<typeof schema.performanceClientConfigs.$inferInsert> = {
    shopifyTokenEnc: encryptSecret(set.token),
    shopifyRefreshTokenEnc: set.refreshToken ? encryptSecret(set.refreshToken) : null,
    shopifyTokenExpiresAt: set.expiresAt,
    updatedAt: new Date(),
  };
  if (installed) values.shopifyInstalledAt = new Date();
  await db.update(schema.performanceClientConfigs).set(values).where(eq(schema.performanceClientConfigs.brandId, brandId));
}
