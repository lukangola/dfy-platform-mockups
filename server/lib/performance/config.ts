/**
 * Performance dashboard — per-client ("brand") configuration, DB-backed.
 *
 * Row: performance_client_configs (one per brand; none = defaults, mock data).
 * Secrets (Shopify token, Meta token, Google secrets) are AES-GCM encrypted at
 * rest and only ever leave the server as "set / not set". The UI panel on the
 * Performance page writes this row; nothing lives in .env except defaults and
 * the encryption key. No economics inputs live here: margin is derived from
 * Shopify unit costs (see shopify.ts).
 */
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db.js";
import type { PlatformKey, RegionKey } from "../../../shared/performance/engine.js";
import { decryptSecret, encryptSecret } from "./secrets.js";
import { forgetShopifyToken } from "./shopify.js";

export type DataSourceKind = "mock" | "live";
export type NcDefinition = "first_ever" | "window_days";
export type RevenueField = "total" | "subtotal";
export interface AccountMap { id: string; region: RegionKey }

export interface PerformanceClientConfig {
  brandId: string;
  name: string;
  dataSource: DataSourceKind;
  ncDefinition: NcDefinition;
  ncWindowDays: number;
  revenueField: RevenueField;
  regionMapping: Record<string, RegionKey>;
  syncEveryMinutes: number;
  mockSeed: number;
  /** token = legacy custom app (pre-2026); clientId + clientSecret = Dev Dashboard app (exchanged for 24h tokens server-side) */
  shopify: {
    shopDomain: string | null; token: string | null; clientId: string | null; clientSecret: string | null;
    /** install-flow extras (Partner app): refresh token + expiry of `token`, and when it was installed */
    refreshToken: string | null; tokenExpiresAt: Date | null; installedAt: Date | null;
  };
  meta: { token: string | null; accounts: AccountMap[] };
  google: {
    developerToken: string | null; clientId: string | null; clientSecret: string | null;
    refreshToken: string | null; loginCustomerId: string | null; accounts: AccountMap[];
  };
}

export const DEFAULT_REGION_MAPPING: Record<string, RegionKey> = { NL: "NLBE", BE: "NLBE", GB: "UK", US: "USA" };
const REGION_KEYS: RegionKey[] = ["NLBE", "UK", "USA", "OTH"];

/** Stable small integer from a brand id — different brands, different mock series. */
function seedFromId(id: string): number {
  if (id === "00000000-0000-0000-0000-000000000001") return 42; // bootstrap brand = reference mock
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 100_000;
}

function defaults(brandId: string, name: string): PerformanceClientConfig {
  return {
    brandId, name,
    dataSource: process.env.PERFORMANCE_DATA_SOURCE === "live" ? "live" : "mock",
    ncDefinition: "first_ever", ncWindowDays: 365, revenueField: "total",
    regionMapping: { ...DEFAULT_REGION_MAPPING },
    syncEveryMinutes: 10,
    mockSeed: seedFromId(brandId),
    shopify: { shopDomain: null, token: null, clientId: null, clientSecret: null, refreshToken: null, tokenExpiresAt: null, installedAt: null },
    meta: { token: null, accounts: [] },
    google: { developerToken: null, clientId: null, clientSecret: null, refreshToken: null, loginCustomerId: null, accounts: [] },
  };
}

function parseAccounts(v: unknown): AccountMap[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    const id = typeof x?.id === "string" ? x.id.trim() : "";
    const region = REGION_KEYS.includes(x?.region) ? (x.region as RegionKey) : null;
    return id && region ? [{ id, region }] : [];
  });
}

function parseMapping(v: unknown): Record<string, RegionKey> | null {
  if (!v || typeof v !== "object") return null;
  const out: Record<string, RegionKey> = {};
  for (const [k, r] of Object.entries(v as Record<string, unknown>)) if (REGION_KEYS.includes(r as RegionKey)) out[k.toUpperCase()] = r as RegionKey;
  return Object.keys(out).length ? out : null;
}

export async function getClientConfig(brandId: string, brandName: string): Promise<PerformanceClientConfig> {
  const base = defaults(brandId, brandName);
  const [row] = await db.select().from(schema.performanceClientConfigs).where(eq(schema.performanceClientConfigs.brandId, brandId)).limit(1);
  if (!row) return base;
  return {
    ...base,
    dataSource: row.dataSource === "live" ? "live" : "mock",
    ncDefinition: row.ncDefinition === "window_days" ? "window_days" : "first_ever",
    ncWindowDays: row.ncWindowDays, revenueField: row.revenueField === "subtotal" ? "subtotal" : "total",
    regionMapping: parseMapping(row.regionMapping) ?? base.regionMapping,
    syncEveryMinutes: row.syncEveryMinutes,
    shopify: {
      shopDomain: row.shopifyShopDomain, token: decryptSecret(row.shopifyTokenEnc),
      clientId: row.shopifyClientId, clientSecret: decryptSecret(row.shopifyClientSecretEnc),
      refreshToken: decryptSecret(row.shopifyRefreshTokenEnc), tokenExpiresAt: row.shopifyTokenExpiresAt, installedAt: row.shopifyInstalledAt,
    },
    meta: { token: decryptSecret(row.metaTokenEnc), accounts: parseAccounts(row.metaAccounts) },
    google: {
      developerToken: decryptSecret(row.googleDeveloperTokenEnc), clientId: row.googleClientId,
      clientSecret: decryptSecret(row.googleClientSecretEnc), refreshToken: decryptSecret(row.googleRefreshTokenEnc),
      loginCustomerId: row.googleLoginCustomerId, accounts: parseAccounts(row.googleAccounts),
    },
  };
}

/** Every brand with a saved config whose source is live — the sync loop's work list. */
export async function liveBrandIds(): Promise<string[]> {
  const rows = await db.select({ brandId: schema.performanceClientConfigs.brandId }).from(schema.performanceClientConfigs).where(eq(schema.performanceClientConfigs.dataSource, "live"));
  return rows.map((r) => r.brandId);
}

/**
 * Patch from the UI. Secret fields: a non-empty string replaces the stored
 * secret, "" (or undefined) keeps it, null clears it.
 */
export interface ConfigPatch {
  dataSource?: DataSourceKind;
  ncDefinition?: NcDefinition; ncWindowDays?: number; revenueField?: RevenueField;
  regionMapping?: Record<string, string> | null;
  syncEveryMinutes?: number;
  shopifyShopDomain?: string | null; shopifyToken?: string | null;
  shopifyClientId?: string | null; shopifyClientSecret?: string | null;
  metaToken?: string | null; metaAccounts?: AccountMap[];
  googleDeveloperToken?: string | null; googleClientId?: string | null; googleClientSecret?: string | null;
  googleRefreshToken?: string | null; googleLoginCustomerId?: string | null; googleAccounts?: AccountMap[];
}

function secretSet(v: string | null | undefined): { set: boolean; value: string | null } {
  if (v === undefined || v === "") return { set: false, value: null };
  return { set: true, value: v === null ? null : encryptSecret(v) };
}

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;
}

export async function saveClientConfig(brandId: string, patch: ConfigPatch): Promise<void> {
  const set: Partial<typeof schema.performanceClientConfigs.$inferInsert> = { updatedAt: new Date() };
  if (patch.dataSource) set.dataSource = patch.dataSource === "live" ? "live" : "mock";
  if (patch.ncDefinition) set.ncDefinition = patch.ncDefinition === "window_days" ? "window_days" : "first_ever";
  if (patch.ncWindowDays != null) set.ncWindowDays = Math.round(clamp(patch.ncWindowDays, 1, 3650, 365));
  if (patch.revenueField) set.revenueField = patch.revenueField === "subtotal" ? "subtotal" : "total";
  if (patch.regionMapping !== undefined) set.regionMapping = patch.regionMapping ? parseMapping(patch.regionMapping) : null;
  if (patch.syncEveryMinutes != null) set.syncEveryMinutes = Math.round(clamp(patch.syncEveryMinutes, 2, 1440, 10));
  if (patch.shopifyShopDomain !== undefined) set.shopifyShopDomain = patch.shopifyShopDomain?.trim() || null;
  const st = secretSet(patch.shopifyToken); if (st.set) set.shopifyTokenEnc = st.value;
  if (patch.shopifyClientId !== undefined) set.shopifyClientId = patch.shopifyClientId?.trim() || null;
  const sc = secretSet(patch.shopifyClientSecret); if (sc.set) set.shopifyClientSecretEnc = sc.value;
  // A token pasted by hand, or new app credentials / another shop, supersedes an earlier install-flow token.
  if (st.set || sc.set || set.shopifyClientId !== undefined || set.shopifyShopDomain !== undefined) {
    const [cur] = await db.select({ clientId: schema.performanceClientConfigs.shopifyClientId, shop: schema.performanceClientConfigs.shopifyShopDomain, installedAt: schema.performanceClientConfigs.shopifyInstalledAt })
      .from(schema.performanceClientConfigs).where(eq(schema.performanceClientConfigs.brandId, brandId)).limit(1);
    const changed = st.set || sc.set
      || (set.shopifyClientId !== undefined && set.shopifyClientId !== (cur?.clientId ?? null))
      || (set.shopifyShopDomain !== undefined && set.shopifyShopDomain !== (cur?.shop ?? null));
    if (changed && cur?.installedAt) {
      if (!st.set) set.shopifyTokenEnc = null;
      set.shopifyRefreshTokenEnc = null; set.shopifyTokenExpiresAt = null; set.shopifyInstalledAt = null;
    }
  }
  const mt = secretSet(patch.metaToken); if (mt.set) set.metaTokenEnc = mt.value;
  if (patch.metaAccounts) set.metaAccounts = parseAccounts(patch.metaAccounts);
  const gd = secretSet(patch.googleDeveloperToken); if (gd.set) set.googleDeveloperTokenEnc = gd.value;
  if (patch.googleClientId !== undefined) set.googleClientId = patch.googleClientId?.trim() || null;
  const gs = secretSet(patch.googleClientSecret); if (gs.set) set.googleClientSecretEnc = gs.value;
  const gr = secretSet(patch.googleRefreshToken); if (gr.set) set.googleRefreshTokenEnc = gr.value;
  if (patch.googleLoginCustomerId !== undefined) set.googleLoginCustomerId = patch.googleLoginCustomerId?.replace(/\D/g, "") || null;
  if (patch.googleAccounts) set.googleAccounts = parseAccounts(patch.googleAccounts);

  await db.insert(schema.performanceClientConfigs).values({ brandId, ...set }).onConflictDoUpdate({
    target: schema.performanceClientConfigs.brandId,
    set: { ...set, updatedAt: sql`now()` },
  });
  forgetShopifyToken(brandId); // credentials may have changed — next call exchanges them again
}

/** Shopify is usable: shop domain + either a legacy token or Dev Dashboard client credentials. */
export function shopifyConnected(c: PerformanceClientConfig): boolean {
  return Boolean(c.shopify.shopDomain && (c.shopify.token || (c.shopify.clientId && c.shopify.clientSecret)));
}

/** What the client sees — never a secret, only whether one is set. */
export function publicConfig(c: PerformanceClientConfig) {
  return {
    brandId: c.brandId, name: c.name, dataSource: c.dataSource,
    ncDefinition: c.ncDefinition, ncWindowDays: c.ncWindowDays, revenueField: c.revenueField,
    regionMapping: c.regionMapping, syncEveryMinutes: c.syncEveryMinutes,
    shopify: {
      shopDomain: c.shopify.shopDomain, tokenSet: Boolean(c.shopify.token),
      clientId: c.shopify.clientId, clientSecretSet: Boolean(c.shopify.clientSecret),
      installedAt: c.shopify.installedAt ? c.shopify.installedAt.toISOString() : null,
    },
    meta: { tokenSet: Boolean(c.meta.token), accounts: c.meta.accounts },
    google: {
      developerTokenSet: Boolean(c.google.developerToken), clientId: c.google.clientId,
      clientSecretSet: Boolean(c.google.clientSecret), refreshTokenSet: Boolean(c.google.refreshToken),
      loginCustomerId: c.google.loginCustomerId, accounts: c.google.accounts,
    },
    platformsConfigured: {
      META: Boolean(c.meta.token) && c.meta.accounts.length > 0,
      GOOG: Boolean(c.google.refreshToken) && c.google.accounts.length > 0,
      TT: false,
    } as Record<PlatformKey, boolean>,
    shopifyConfigured: shopifyConnected(c),
  };
}
export type PublicPerformanceConfig = ReturnType<typeof publicConfig>;
