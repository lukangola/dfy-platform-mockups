/**
 * Performance dashboard — per-client configuration.
 *
 * One record per brand (Inana's "client" is a brand): where the sales and
 * spend data comes from and the economics that turn them into CM / NCPA / ROAS.
 *
 * Phase A: in-code defaults + optional per-brand overrides in this map; no
 * admin UI, no DB row yet. Phase B moves this to a `performance_client_configs`
 * table once real credentials exist (tokens then live in the encrypted
 * `connections` store, never here). Mock data works for ANY brand because the
 * default config covers unknown brand ids.
 */
import type { PlatformKey, RegionKey } from "../../../shared/performance/engine.js";

export type DataSourceKind = "mock" | "live";

export interface PerformanceClientConfig {
  brandId: string;
  name: string;
  /** which source produces the hourly buckets for this client */
  dataSource: DataSourceKind;
  /** e.g. example.myshopify.com — Phase B */
  shopDomain: string | null;
  /** ad account ids per platform — Phase B/3/4 */
  adAccounts: Record<PlatformKey, string[]>;
  /** country ISO-2 → dashboard region; countries not listed fall into OTH */
  regionMapping: Record<string, RegionKey>;
  /** economics — drive the derived metrics */
  grossMargin: number;
  remarketingShare: number;
  /** seed for the mock generator so two mock clients show different numbers */
  mockSeed: number;
}

const DEFAULT_REGION_MAPPING: Record<string, RegionKey> = {
  NL: "NLBE", BE: "NLBE", GB: "UK", US: "USA",
};

/** Env-driven default. `PERFORMANCE_DATA_SOURCE=live` flips every client without an override. */
function defaultSource(): DataSourceKind {
  return process.env.PERFORMANCE_DATA_SOURCE === "live" ? "live" : "mock";
}

function numberEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function defaults(brandId: string, name: string): PerformanceClientConfig {
  return {
    brandId,
    name,
    dataSource: defaultSource(),
    shopDomain: null,
    adAccounts: { META: [], GOOG: [], TT: [] },
    regionMapping: { ...DEFAULT_REGION_MAPPING },
    grossMargin: numberEnv("PERFORMANCE_GROSS_MARGIN", 0.52),
    remarketingShare: numberEnv("PERFORMANCE_REMARKETING_SHARE", 0.12),
    mockSeed: seedFromId(brandId),
  };
}

/**
 * Per-brand overrides. Keyed by brand id. Add a client here when its real
 * margin / shop / ad accounts are known; anything not set falls back to defaults.
 * The bootstrap "Default Brand" keeps seed 42 so it matches the reference mock exactly.
 */
const OVERRIDES: Record<string, Partial<PerformanceClientConfig>> = {
  "00000000-0000-0000-0000-000000000001": { mockSeed: 42 },
};

/** Stable small integer from a brand id — different brands, different mock series. */
function seedFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100_000;
}

export function getClientConfig(brandId: string, brandName: string): PerformanceClientConfig {
  return { ...defaults(brandId, brandName), ...(OVERRIDES[brandId] ?? {}) };
}

/** What the client needs; never leaks ids/tokens beyond what the UI shows. */
export function publicConfig(c: PerformanceClientConfig) {
  return {
    brandId: c.brandId,
    name: c.name,
    dataSource: c.dataSource,
    shopDomain: c.shopDomain,
    regionMapping: c.regionMapping,
    grossMargin: c.grossMargin,
    remarketingShare: c.remarketingShare,
    platformsConfigured: {
      META: c.adAccounts.META.length > 0,
      GOOG: c.adAccounts.GOOG.length > 0,
      TT: c.adAccounts.TT.length > 0,
    },
  };
}
export type PublicPerformanceConfig = ReturnType<typeof publicConfig>;
