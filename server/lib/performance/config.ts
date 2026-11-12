/**
 * Performance dashboard — per-client ("brand") configuration, DB-backed.
 *
 * Row: performance_client_configs (one per brand; none = defaults, mock data).
 * Secrets (Shopify token, Amazon refresh token, Meta token, Google secrets) are AES-GCM encrypted at
 * rest and only ever leave the server as "set / not set". The UI panel on the
 * Performance page writes this row; nothing lives in .env except defaults and
 * the encryption key. No economics inputs live here: margin is derived from
 * Shopify unit costs (see shopify.ts).
 */
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db.js";
import { DEFAULT_REGIONS, OTHER_REGION, flagFor, regionKeyFor, type PlatformKey, type RegionDef, type RegionKey } from "../../../shared/performance/engine.js";
import { decryptSecret, encryptSecret } from "./secrets.js";
import { forgetShopifyToken } from "./shopify.js";
import { forgetAmazonToken } from "./amazon.js";

export type DataSourceKind = "mock" | "live";
export type NcDefinition = "first_ever" | "window_days";
export type RevenueField = "total" | "subtotal";
/** SP-API regional endpoint the seller account lives on (EU covers Europe, UK, India, Middle East). */
export type AmazonRegion = "EU" | "NA" | "FE";
export const AMAZON_REGIONS: AmazonRegion[] = ["EU", "NA", "FE"];
export interface AccountMap { id: string; region: RegionKey }
/** A named region: the countries (ISO-3166 alpha-2) that roll up into it. Everything else is "Other". */
export interface RegionConfig extends RegionDef { countries: string[] }
/** What the UI sends: label + countries (key and flag are derived). */
export interface RegionInput { label: string; countries: string[] }

export interface PerformanceClientConfig {
  brandId: string;
  name: string;
  dataSource: DataSourceKind;
  ncDefinition: NcDefinition;
  ncWindowDays: number;
  revenueField: RevenueField;
  /** named regions in display order (without "Other") */
  regions: RegionConfig[];
  /** derived: ISO-2 country → region key (countries not listed → OTH) */
  regionMapping: Record<string, RegionKey>;
  syncEveryMinutes: number;
  mockSeed: number;
  /** token = legacy custom app (pre-2026); clientId + clientSecret = Dev Dashboard app (exchanged for 24h tokens server-side) */
  shopify: {
    shopDomain: string | null; token: string | null; clientId: string | null; clientSecret: string | null;
    /** install-flow extras (Partner app): refresh token + expiry of `token`, and when it was installed */
    refreshToken: string | null; tokenExpiresAt: Date | null; installedAt: Date | null;
  };
  /** private (self-authorised) Seller Central app: LWA client id + secret + refresh token; Orders API only */
  amazon: { clientId: string | null; clientSecret: string | null; refreshToken: string | null; region: AmazonRegion; marketplaceIds: string[] };
  meta: { token: string | null; accounts: AccountMap[] };
  google: {
    developerToken: string | null; clientId: string | null; clientSecret: string | null;
    refreshToken: string | null; loginCustomerId: string | null; accounts: AccountMap[];
  };
}

export const DEFAULT_REGION_INPUT: RegionInput[] = [
  { label: "NL/BE", countries: ["NL", "BE"] }, { label: "UK", countries: ["GB"] }, { label: "USA", countries: ["US"] },
];
export const MAX_REGIONS = 8;

/**
 * Validate + normalise regions from the UI or the DB. Keys come from the labels, flags from the
 * first country. Throws on duplicates, an empty label, a label that collides with "Other", or
 * more than MAX_REGIONS — the panel shows the message.
 */
export function parseRegions(v: unknown): RegionConfig[] {
  if (!Array.isArray(v)) throw new Error("regions must be a list");
  if (v.length > MAX_REGIONS) throw new Error(`at most ${MAX_REGIONS} regions (plus Other)`);
  const out: RegionConfig[] = [];
  const seenCountry = new Map<string, string>();
  for (const x of v as Array<Record<string, unknown>>) {
    const label = typeof x?.label === "string" ? x.label.trim().replace(/\s+/g, " ").slice(0, 24) : "";
    const key = regionKeyFor(label);
    if (!label || !key) throw new Error("every region needs a label with letters or digits");
    if (key === OTHER_REGION.key || /^OTHER$/i.test(label)) throw new Error(`"${label}" is reserved for the catch-all region`);
    if (out.some((r) => r.key === key)) throw new Error(`region "${label}" appears twice (same key ${key})`);
    const raw = Array.isArray(x.countries) ? x.countries : typeof x.countries === "string" ? x.countries.split(/[,\s]+/) : [];
    const countries: string[] = [];
    for (const c of raw) {
      const cc = String(c ?? "").trim().toUpperCase();
      if (!cc) continue;
      if (!/^[A-Z]{2}$/.test(cc)) throw new Error(`"${cc}" is not a 2-letter country code (region ${label})`);
      const owner = seenCountry.get(cc);
      if (owner && owner !== key) throw new Error(`${cc} is in both ${owner} and ${key}`);
      if (!countries.includes(cc)) { countries.push(cc); seenCountry.set(cc, key); }
    }
    if (!countries.length) throw new Error(`region "${label}" has no countries`);
    out.push({ key, label, flag: flagFor(countries[0]), countries });
  }
  return out;
}

export function regionMappingOf(regions: RegionConfig[]): Record<string, RegionKey> {
  const m: Record<string, RegionKey> = {};
  for (const r of regions) for (const cc of r.countries) m[cc] = r.key;
  return m;
}

/** Display list for datasets and the UI: the named regions, then "Other". */
export function regionDefs(c: Pick<PerformanceClientConfig, "regions">): RegionDef[] {
  return [...c.regions.map(({ key, label, flag }) => ({ key, label, flag })), OTHER_REGION];
}
const REGION_KEY_SET = (regions: RegionConfig[]) => new Set<string>([...regions.map((r) => r.key), OTHER_REGION.key]);

/** Stable small integer from a brand id — different brands, different mock series. */
function seedFromId(id: string): number {
  if (id === "00000000-0000-0000-0000-000000000001") return 42; // bootstrap brand = reference mock
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 100_000;
}

function defaults(brandId: string, name: string): PerformanceClientConfig {
  const regions = parseRegions(DEFAULT_REGION_INPUT);
  return {
    brandId, name,
    dataSource: process.env.PERFORMANCE_DATA_SOURCE === "live" ? "live" : "mock",
    ncDefinition: "first_ever", ncWindowDays: 365, revenueField: "total",
    regions, regionMapping: regionMappingOf(regions),
    syncEveryMinutes: 10,
    mockSeed: seedFromId(brandId),
    shopify: { shopDomain: null, token: null, clientId: null, clientSecret: null, refreshToken: null, tokenExpiresAt: null, installedAt: null },
    amazon: { clientId: null, clientSecret: null, refreshToken: null, region: "EU", marketplaceIds: [] },
    meta: { token: null, accounts: [] },
    google: { developerToken: null, clientId: null, clientSecret: null, refreshToken: null, loginCustomerId: null, accounts: [] },
  };
}

/** Account → region pairs; a region that is not one of the brand's keys (or OTH) is dropped. */
function parseAccounts(v: unknown, regions: RegionConfig[]): AccountMap[] {
  if (!Array.isArray(v)) return [];
  const keys = REGION_KEY_SET(regions);
  return v.flatMap((x) => {
    const id = typeof x?.id === "string" ? x.id.trim() : "";
    const region = typeof x?.region === "string" ? x.region.toUpperCase() : "";
    return id && keys.has(region) ? [{ id, region }] : [];
  });
}

function parseAmazonRegion(v: unknown): AmazonRegion {
  const r = String(v ?? "").toUpperCase();
  return (AMAZON_REGIONS as string[]).includes(r) ? (r as AmazonRegion) : "EU";
}

/** Marketplace ids: list or comma/space-separated text; Amazon ids are 10–14 upper-case alphanumerics. */
export function parseMarketplaceIds(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\s]+/) : [];
  const out: string[] = [];
  for (const x of raw) {
    const id = String(x ?? "").trim().toUpperCase();
    if (!id) continue;
    if (!/^[A-Z0-9]{10,14}$/.test(id)) throw new Error(`"${id}" is not an Amazon marketplace id (e.g. A1PA6795UKMFR9 for amazon.de)`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Stored regions, or the defaults when the row has none / holds something unreadable. */
function storedRegions(v: unknown): RegionConfig[] {
  if (!Array.isArray(v) || !v.length) return parseRegions(DEFAULT_REGION_INPUT);
  try { return parseRegions(v); } catch { return parseRegions(DEFAULT_REGION_INPUT); }
}

export async function getClientConfig(brandId: string, brandName: string): Promise<PerformanceClientConfig> {
  const base = defaults(brandId, brandName);
  const [row] = await db.select().from(schema.performanceClientConfigs).where(eq(schema.performanceClientConfigs.brandId, brandId)).limit(1);
  if (!row) return base;
  const regions = storedRegions(row.regions);
  return {
    ...base,
    dataSource: row.dataSource === "live" ? "live" : "mock",
    ncDefinition: row.ncDefinition === "window_days" ? "window_days" : "first_ever",
    ncWindowDays: row.ncWindowDays, revenueField: row.revenueField === "subtotal" ? "subtotal" : "total",
    regions, regionMapping: regionMappingOf(regions),
    syncEveryMinutes: row.syncEveryMinutes,
    shopify: {
      shopDomain: row.shopifyShopDomain, token: decryptSecret(row.shopifyTokenEnc),
      clientId: row.shopifyClientId, clientSecret: decryptSecret(row.shopifyClientSecretEnc),
      refreshToken: decryptSecret(row.shopifyRefreshTokenEnc), tokenExpiresAt: row.shopifyTokenExpiresAt, installedAt: row.shopifyInstalledAt,
    },
    amazon: {
      clientId: row.amazonClientId, clientSecret: decryptSecret(row.amazonClientSecretEnc), refreshToken: decryptSecret(row.amazonRefreshTokenEnc),
      region: parseAmazonRegion(row.amazonRegion), marketplaceIds: (() => { try { return parseMarketplaceIds(row.amazonMarketplaceIds); } catch { return []; } })(),
    },
    meta: { token: decryptSecret(row.metaTokenEnc), accounts: parseAccounts(row.metaAccounts, regions) },
    google: {
      developerToken: decryptSecret(row.googleDeveloperTokenEnc), clientId: row.googleClientId,
      clientSecret: decryptSecret(row.googleClientSecretEnc), refreshToken: decryptSecret(row.googleRefreshTokenEnc),
      loginCustomerId: row.googleLoginCustomerId, accounts: parseAccounts(row.googleAccounts, regions),
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
  /** named regions (label + countries); null = back to the defaults */
  regions?: RegionInput[] | null;
  syncEveryMinutes?: number;
  shopifyShopDomain?: string | null; shopifyToken?: string | null;
  shopifyClientId?: string | null; shopifyClientSecret?: string | null;
  amazonClientId?: string | null; amazonClientSecret?: string | null; amazonRefreshToken?: string | null;
  amazonRegion?: AmazonRegion; amazonMarketplaceIds?: string[] | string;
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
  let regions: RegionConfig[] | null = null;
  if (patch.regions !== undefined) {
    regions = parseRegions(patch.regions ?? DEFAULT_REGION_INPUT);
    set.regions = patch.regions ? regions.map(({ label, countries }) => ({ label, countries })) : null;
  }
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
  if (patch.amazonClientId !== undefined) set.amazonClientId = patch.amazonClientId?.trim() || null;
  const acs = secretSet(patch.amazonClientSecret); if (acs.set) set.amazonClientSecretEnc = acs.value;
  const art = secretSet(patch.amazonRefreshToken); if (art.set) set.amazonRefreshTokenEnc = art.value;
  if (patch.amazonRegion !== undefined) set.amazonRegion = parseAmazonRegion(patch.amazonRegion);
  if (patch.amazonMarketplaceIds !== undefined) set.amazonMarketplaceIds = parseMarketplaceIds(patch.amazonMarketplaceIds);
  // Account → region pairs are validated against the regions being saved (or the stored ones).
  const regionsForAccounts = regions ?? (patch.metaAccounts || patch.googleAccounts ? (await getClientConfig(brandId, "")).regions : []);
  const mt = secretSet(patch.metaToken); if (mt.set) set.metaTokenEnc = mt.value;
  if (patch.metaAccounts) set.metaAccounts = parseAccounts(patch.metaAccounts, regionsForAccounts);
  const gd = secretSet(patch.googleDeveloperToken); if (gd.set) set.googleDeveloperTokenEnc = gd.value;
  if (patch.googleClientId !== undefined) set.googleClientId = patch.googleClientId?.trim() || null;
  const gs = secretSet(patch.googleClientSecret); if (gs.set) set.googleClientSecretEnc = gs.value;
  const gr = secretSet(patch.googleRefreshToken); if (gr.set) set.googleRefreshTokenEnc = gr.value;
  if (patch.googleLoginCustomerId !== undefined) set.googleLoginCustomerId = patch.googleLoginCustomerId?.replace(/\D/g, "") || null;
  if (patch.googleAccounts) set.googleAccounts = parseAccounts(patch.googleAccounts, regionsForAccounts);

  await db.insert(schema.performanceClientConfigs).values({ brandId, ...set }).onConflictDoUpdate({
    target: schema.performanceClientConfigs.brandId,
    set: { ...set, updatedAt: sql`now()` },
  });
  if (regions || patch.metaAccounts || patch.googleAccounts) {
    const saved = await getClientConfig(brandId, "");
    if (regions) await reassignOrderRegions(brandId, saved.regionMapping);
    await reassignSpendRegions(brandId, saved.regionMapping, [...saved.meta.accounts, ...saved.google.accounts]);
  }
  forgetShopifyToken(brandId); // credentials may have changed — next call exchanges them again
  forgetAmazonToken(brandId);
}

/**
 * Regions or account mappings changed: spend slices with a country follow the country mapping
 * (like orders); slices without one ("" = Meta gave no country that day, or Google) follow the
 * account's configured region.
 */
export async function reassignSpendRegions(brandId: string, mapping: Record<string, RegionKey>, accounts: AccountMap[]): Promise<void> {
  const entries = Object.entries(mapping);
  const byCountry = entries.length ? sql.join(entries.map(([cc, key]) => sql`WHEN ${cc} THEN ${key}`), sql` `) : sql`WHEN NULL THEN NULL`;
  const byAccount = accounts.length ? sql.join(accounts.map((a) => sql`WHEN ${a.id} THEN ${a.region}`), sql` `) : sql`WHEN NULL THEN NULL`;
  const target = sql`CASE WHEN country <> '' THEN (CASE country ${byCountry} ELSE ${OTHER_REGION.key} END)
    ELSE COALESCE((CASE account_id ${byAccount} ELSE NULL END), (CASE 'act_' || account_id ${byAccount} ELSE NULL END), region) END`;
  await db.execute(sql`UPDATE performance_spend_hours SET region = ${target} WHERE brand_id = ${brandId} AND region IS DISTINCT FROM (${target})`);
}

/** Regions changed: re-derive the stored region of every synced order from its country. */
export async function reassignOrderRegions(brandId: string, mapping: Record<string, RegionKey>): Promise<void> {
  const entries = Object.entries(mapping);
  const cases = entries.length
    ? sql.join(entries.map(([cc, key]) => sql`WHEN ${cc} THEN ${key}`), sql` `)
    : sql`WHEN NULL THEN NULL`;
  await db.execute(sql`
    UPDATE performance_orders SET region = CASE country ${cases} ELSE ${OTHER_REGION.key} END
    WHERE brand_id = ${brandId} AND region IS DISTINCT FROM (CASE country ${cases} ELSE ${OTHER_REGION.key} END)
  `);
}

/** Shopify is usable: shop domain + either a legacy token or Dev Dashboard client credentials. */
export function shopifyConnected(c: PerformanceClientConfig): boolean {
  return Boolean(c.shopify.shopDomain && (c.shopify.token || (c.shopify.clientId && c.shopify.clientSecret)));
}

/** Amazon is usable: LWA client id + secret + refresh token of the self-authorised app. */
export function amazonConnected(c: PerformanceClientConfig): boolean {
  return Boolean(c.amazon.clientId && c.amazon.clientSecret && c.amazon.refreshToken);
}

/** What the client sees — never a secret, only whether one is set. */
export function publicConfig(c: PerformanceClientConfig) {
  return {
    brandId: c.brandId, name: c.name, dataSource: c.dataSource,
    ncDefinition: c.ncDefinition, ncWindowDays: c.ncWindowDays, revenueField: c.revenueField,
    regions: c.regions, syncEveryMinutes: c.syncEveryMinutes,
    shopify: {
      shopDomain: c.shopify.shopDomain, tokenSet: Boolean(c.shopify.token),
      clientId: c.shopify.clientId, clientSecretSet: Boolean(c.shopify.clientSecret),
      installedAt: c.shopify.installedAt ? c.shopify.installedAt.toISOString() : null,
    },
    amazon: {
      clientId: c.amazon.clientId, clientSecretSet: Boolean(c.amazon.clientSecret), refreshTokenSet: Boolean(c.amazon.refreshToken),
      region: c.amazon.region, marketplaceIds: c.amazon.marketplaceIds,
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
    amazonConfigured: amazonConnected(c),
  };
}
export type PublicPerformanceConfig = ReturnType<typeof publicConfig>;
