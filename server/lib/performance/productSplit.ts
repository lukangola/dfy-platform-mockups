/**
 * Splits hourly ad spend across product lines using the campaign-day table.
 *
 * For a spend slice (platform, account, hour, country) the matching campaign day gives each product
 * line's attributed spend for that day and country. Spend that no campaign rule claimed (promo,
 * retargeting, …) is never shown on its own: the slice's whole spend is split in the proportions of
 * the attributed spend — the same pro-rata rule as the promo spend in the weekly tracker. Fallbacks,
 * in order: the day's attributed spend across all countries of the account; any campaign day of the
 * same region (other accounts / platforms with campaign data); else "Other / unassigned".
 */
import { OTHER_PRODUCT, type ProductKey, type RegionKey } from "../../../shared/performance/engine.js";

export interface CampaignDay {
  platform: string; accountId: string; dayStartMs: number; dayEndMs: number; country: string; region: RegionKey;
  /** "" = unattributed */
  productLine: string; spend: number;
}

type Shares = Array<[ProductKey, number]>;
interface DayIndex { start: number; end: number; byCountry: Map<string, Map<ProductKey, number>>; all: Map<ProductKey, number> }

function add(m: Map<ProductKey, number>, k: ProductKey, v: number) { m.set(k, (m.get(k) ?? 0) + v); }
function toShares(m: Map<ProductKey, number> | undefined): Shares | null {
  if (!m) return null;
  let total = 0;
  m.forEach((v) => { total += v; });
  if (!(total > 0)) return null;
  const out: Shares = [];
  m.forEach((v, k) => { if (v > 0) out.push([k, v / total]); });
  return out;
}
function find(days: DayIndex[] | undefined, hourMs: number): DayIndex | null {
  if (!days) return null;
  let lo = 0, hi = days.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = days[mid];
    if (hourMs < d.start) hi = mid - 1; else if (hourMs >= d.end) lo = mid + 1; else return d;
  }
  return null;
}

export class ProductSplitter {
  private readonly byAccount = new Map<string, DayIndex[]>();
  private readonly byRegion = new Map<string, DayIndex[]>();
  private readonly productKeys: Set<ProductKey>;

  constructor(days: CampaignDay[], productKeys: ProductKey[]) {
    this.productKeys = new Set(productKeys);
    const acct = new Map<string, Map<number, DayIndex>>();
    const reg = new Map<string, Map<number, DayIndex>>();
    for (const d of days) {
      if (!d.productLine || !this.productKeys.has(d.productLine) || !(d.spend > 0)) continue; // only attributed spend sets the proportions
      const ak = `${d.platform}|${d.accountId}`;
      const am = acct.get(ak) ?? new Map<number, DayIndex>(); acct.set(ak, am);
      const ad = am.get(d.dayStartMs) ?? { start: d.dayStartMs, end: d.dayEndMs, byCountry: new Map(), all: new Map() }; am.set(d.dayStartMs, ad);
      const cm = ad.byCountry.get(d.country) ?? new Map<ProductKey, number>(); ad.byCountry.set(d.country, cm);
      add(cm, d.productLine, d.spend); add(ad.all, d.productLine, d.spend);
      const rm = reg.get(d.region) ?? new Map<number, DayIndex>(); reg.set(d.region, rm);
      const rd = rm.get(d.dayStartMs) ?? { start: d.dayStartMs, end: d.dayEndMs, byCountry: new Map(), all: new Map() }; rm.set(d.dayStartMs, rd);
      add(rd.all, d.productLine, d.spend);
    }
    const sorted = (m: Map<number, DayIndex>) => Array.from(m.values()).sort((a, b) => a.start - b.start);
    acct.forEach((m, k) => this.byAccount.set(k, sorted(m)));
    reg.forEach((m, k) => this.byRegion.set(k, sorted(m)));
  }

  /** Product shares (sum 1) for one spend slice, or null → "Other / unassigned". */
  shares(platform: string, accountId: string, hourMs: number, country: string, region: RegionKey): Shares | null {
    const day = find(this.byAccount.get(`${platform}|${accountId}`), hourMs);
    if (day) {
      const byCountry = country ? toShares(day.byCountry.get(country)) : null;
      if (byCountry) return byCountry;
      const all = toShares(day.all);
      if (all) return all;
    }
    const rd = find(this.byRegion.get(region), hourMs);
    return rd ? toShares(rd.all) : null;
  }

  /** Split `spend` into per-product amounts (the last share takes the rounding remainder); unassigned → OTH. */
  split(spend: number, shares: Shares | null): Array<[ProductKey, number]> {
    if (!shares) return [[OTHER_PRODUCT.key, spend]];
    const out: Array<[ProductKey, number]> = [];
    let sum = 0;
    shares.forEach(([k, sh], i) => {
      const v = i === shares.length - 1 ? Math.round((spend - sum) * 10000) / 10000 : Math.round(spend * sh * 10000) / 10000;
      sum += v; out.push([k, v]);
    });
    return out;
  }
}
