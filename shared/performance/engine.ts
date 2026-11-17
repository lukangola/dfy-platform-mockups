/**
 * Performance dashboard — metric engine.
 *
 * Port of the reference `core.js` (performance-dashboard repo). Pure functions,
 * zero DOM / React / Node dependencies, shared by the server (data sources
 * produce this shape) and the client (cards, tables, sparklines consume it).
 *
 * THE CONTRACT: every data source — mock today, Shopify + Meta/Google/TikTok
 * later — produces hourly buckets of exactly this shape:
 *
 *   { t, c: { REGION: [ncOrders, ncRev, rcOrders, rcRev, cogs] }, s: { PLATFORM: [spendPerRegion] } }
 *
 * Regions are per brand (`Dataset.regions`, named ones followed by "Other"); the
 * default set is DEFAULT_REGIONS. Spend arrays are indexed like `Dataset.regions`.
 *
 * Everything downstream (agg → metrics → range/series → UI) keeps working once
 * real data fills it. Do not fork agg/metrics per source.
 *
 * There are no manual economics inputs: cost of goods (cogs) comes from the data
 * source (Shopify unit costs for live, a calibrated share for mock), so gross
 * margin is derived, never typed in. All ad spend counts as acquisition spend.
 */

/** Region key: derived from the label (A–Z, 0–9), e.g. "NL/BE" → "NLBE". "OTH" is the catch-all. */
export type RegionKey = string;
export type PlatformKey = "META" | "GOOG" | "TT";

export interface RegionDef { key: RegionKey; label: string; flag: string }
export interface PlatformDef { key: PlatformKey; label: string; sym: string }

export const OTHER_REGION: RegionDef = { key: "OTH", label: "Other", flag: "🌍" };

/** The reference set (and the mock's): NL/BE, UK, USA + Other. */
export const DEFAULT_REGIONS: readonly RegionDef[] = [
  { key: "NLBE", label: "NL/BE", flag: "🇳🇱" },
  { key: "UK", label: "UK", flag: "🇬🇧" },
  { key: "USA", label: "USA", flag: "🇺🇸" },
  OTHER_REGION,
];

/** "NL/BE" → "NLBE", "DACH" → "DACH". Empty when nothing alphanumeric is left. */
export function regionKeyFor(label: string): RegionKey {
  return label.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

/** Flag emoji for an ISO-3166 alpha-2 code ("DE" → 🇩🇪); 🌍 for anything else. */
export function flagFor(countryCode: string | null | undefined): string {
  const cc = (countryCode ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return OTHER_REGION.flag;
  return String.fromCodePoint(0x1f1e6 + cc.charCodeAt(0) - 65, 0x1f1e6 + cc.charCodeAt(1) - 65);
}

export const PLATFORMS: readonly PlatformDef[] = [
  { key: "META", label: "Meta", sym: "∞" },
  { key: "GOOG", label: "Google", sym: "G" },
  { key: "TT", label: "TikTok", sym: "♪" },
];

/** [ncOrders, ncRevenue, rcOrders, rcRevenue, cogs] — cogs = cost of goods sold for all orders in the bucket */
export type RegionCell = [number, number, number, number, number];
/** spend per region, indexed like `Dataset.regions` */
export type PlatformSpend = number[];

/**
 * Product line (front-end offer, e.g. "GGK" vs "Laundry"): key derived from the label like regions.
 * "OTH" is the catch-all: line items no product line claims, and spend that could not be split.
 */
export type ProductKey = string;
export interface ProductLineDef { key: ProductKey; label: string }
export const OTHER_PRODUCT: ProductLineDef = { key: "OTH", label: "Other / unassigned" };

/** [ncOrders, ncRevenue, rcOrders, rcRevenue] of a product line within a region. An order counts in
 *  every product line it contains (like a line-item report); its revenue is split across them. */
export type ProductCell = [number, number, number, number];

export interface HourBucket {
  /** bucket start, epoch ms, aligned to the hour */
  t: number;
  c: Record<RegionKey, RegionCell>;
  s: Record<PlatformKey, PlatformSpend>;
  /** per product line: sales per region (keys of `Dataset.products`); absent when the brand has no product lines */
  pc?: Record<ProductKey, Record<RegionKey, ProductCell>>;
  /** per product line: ad spend per region (all platforms), indexed like `Dataset.regions` — campaign spend
   *  by product plus the pro-rata share of spend no campaign rule claimed */
  ps?: Record<ProductKey, number[]>;
}

/** A contiguous hourly dataset. `hours[i].t === startMs + i * HOUR`. */
export interface Dataset {
  /** the brand's regions in display order, "Other" last — keys of `c`, index of `s` */
  regions: RegionDef[];
  /** the brand's product lines in display order, "Other / unassigned" last; empty = none configured */
  products?: ProductLineDef[];
  hours: HourBucket[];
  startMs: number;
  /** "as of" — the moment the data was produced */
  now: number;
  /** start of the hour that contains `now` (the last, partial bucket) */
  nowHourMs: number;
  /**
   * Live only: share of revenue in the window whose orders had a unit cost for every
   * line item in Shopify (1 = complete). Below ~0.95 the margin numbers understate COGS.
   */
  costCoverage?: number | null;
}

export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/* ---------- aggregation ---------- */

export interface Sums {
  ncO: number; rcO: number; ncR: number; rcR: number; cogs: number; spend: number;
  plat: Record<PlatformKey, number>;
  salesRows: number; adRows: number;
}

function zeroSums(): Sums {
  return { ncO: 0, rcO: 0, ncR: 0, rcR: 0, cogs: 0, spend: 0, plat: { META: 0, GOOG: 0, TT: 0 }, salesRows: 0, adRows: 0 };
}

function idxOf(D: Dataset, t: number): number {
  return Math.floor((t - D.startMs) / HOUR);
}

/** Aggregate buckets in [t0, t1), optionally filtered to one region. */
export function agg(D: Dataset, t0: number, t1: number, region: RegionKey | null): Sums {
  const out = zeroSums();
  if (D.hours.length === 0) return out;
  const i0 = Math.max(0, idxOf(D, t0));
  const i1 = Math.min(D.hours.length - 1, idxOf(D, t1 - 1));
  for (let i = i0; i <= i1; i++) {
    const h = D.hours[i];
    for (let r = 0; r < D.regions.length; r++) {
      const k = D.regions[r].key;
      if (region && k !== region) continue;
      const o = h.c[k];
      if (o) {
        out.ncO += o[0]; out.ncR += o[1]; out.rcO += o[2]; out.rcR += o[3]; out.cogs += o[4] ?? 0;
        if (o[0] + o[2] > 0) out.salesRows += o[0] + o[2];
      }
      for (const p of PLATFORMS) {
        const sp = h.s[p.key]?.[r] ?? 0;
        out.spend += sp; out.plat[p.key] += sp;
        if (sp > 0) out.adRows++;
      }
    }
  }
  return out;
}

/** Sales + spend of one product line in [t0, t1) (one region or all). Margin is not tracked per product (cogs 0). */
export function aggProduct(D: Dataset, t0: number, t1: number, region: RegionKey | null, product: ProductKey): Sums {
  const out = zeroSums();
  if (D.hours.length === 0) return out;
  const i0 = Math.max(0, idxOf(D, t0));
  const i1 = Math.min(D.hours.length - 1, idxOf(D, t1 - 1));
  for (let i = i0; i <= i1; i++) {
    const h = D.hours[i];
    const cells = h.pc?.[product];
    const spend = h.ps?.[product];
    for (let r = 0; r < D.regions.length; r++) {
      const k = D.regions[r].key;
      if (region && k !== region) continue;
      const o = cells?.[k];
      if (o) {
        out.ncO += o[0]; out.ncR += o[1]; out.rcO += o[2]; out.rcR += o[3];
        if (o[0] + o[2] > 0) out.salesRows += o[0] + o[2];
      }
      const sp = spend?.[r] ?? 0;
      if (sp) { out.spend += sp; out.adRows++; }
    }
  }
  return out;
}

/* ---------- derived metrics ---------- */

export interface Metrics {
  revenue: number;
  /** revenue from first-order (new) customers, by the brand's NC definition */
  ncRevenue: number;
  /** revenue from returning customers */
  rcRevenue: number;
  cm: number;
  ncRoas: number | null;
  ncpa: number | null;
  ncCm: number;
  rcCm: number;
  spend: number;
  cmPct: number | null;
  ncCmPct: number | null;
  ncOrders: number;
  rcOrders: number;
  ncAov: number | null;
  rcAov: number | null;
  /** (revenue − cogs) ÷ revenue, from the data source */
  grossMargin: number | null;
  cogs: number;
  plat: Record<PlatformKey, number>;
  salesRows: number;
  adRows: number;
}

/** Metric keys that are plain numbers or nullable numbers — used by cards/tables. */
export type MetricKey = Exclude<keyof Metrics, "plat">;

/**
 * Definitions:
 *   gross profit = revenue − cogs;  margin M = gross profit ÷ revenue
 *   CM     = gross profit − ad spend
 *   NC CM  = M × NC revenue − ad spend   (all spend is acquisition spend)
 *   RC CM  = M × RC revenue              (so NC CM + RC CM = CM)
 *   NCPA   = ad spend ÷ NC orders;  NC ROAS = NC revenue ÷ ad spend
 */
export function metrics(s: Sums): Metrics {
  const rev = s.ncR + s.rcR;
  const gp = rev - s.cogs;
  const M = rev > 0 ? gp / rev : null;
  const cm = gp - s.spend;
  const ncCm = (M ?? 0) * s.ncR - s.spend;
  const rcCm = (M ?? 0) * s.rcR;
  return {
    revenue: rev,
    ncRevenue: s.ncR,
    rcRevenue: s.rcR,
    cm,
    ncRoas: s.spend > 0 ? s.ncR / s.spend : null,
    ncpa: s.ncO > 0 ? s.spend / s.ncO : null,
    ncCm, rcCm,
    spend: s.spend,
    cmPct: rev > 0 ? cm / rev : null,
    ncCmPct: s.ncR > 0 ? ncCm / s.ncR : null,
    ncOrders: s.ncO, rcOrders: s.rcO,
    ncAov: s.ncO > 0 ? s.ncR / s.ncO : null,
    rcAov: s.rcO > 0 ? s.rcR / s.rcO : null,
    grossMargin: M,
    cogs: s.cogs,
    plat: s.plat, salesRows: s.salesRows, adRows: s.adRows,
  };
}

/* ---------- date ranges ---------- */

export type RangeKey = "today" | "yesterday" | "last3" | "last7" | "last30" | "mtd" | "ytd";
export type Grain = "hour" | "day";

export interface Range {
  cur: [number, number];
  prev: [number, number];
  grain: Grain;
}

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today", yesterday: "Yesterday", last3: "Last 3 days", last7: "Last 7 days", last30: "Last 30 days",
  mtd: "This month", ytd: "Year to date",
};

/** "Last N days" presets: N full days ending yesterday (today is left out, as in Ads Manager). */
const LAST_N_DAYS: Partial<Record<RangeKey, number>> = { last3: 3, last7: 7, last30: 30 };
/** Ranges up to this many days get hourly sparklines, longer ones daily. */
const HOURLY_MAX_DAYS = 3;

/* ---------- time zone helpers (the shop's day, not the browser's) ---------- */

const tzFormats = new Map<string, Intl.DateTimeFormat>();
function tzFormat(tz: string): Intl.DateTimeFormat {
  let f = tzFormats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    tzFormats.set(tz, f);
  }
  return f;
}

/** The IANA zone if the runtime knows it, else undefined (→ browser-local). */
export function validTimeZone(tz: string | null | undefined): string | undefined {
  if (!tz) return undefined;
  try { tzFormat(tz); return tz; } catch { return undefined; }
}

/** Calendar fields of an instant in `tz`. */
function zonedParts(ms: number, tz: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const p: Record<string, number> = {};
  for (const x of tzFormat(tz).formatToParts(ms)) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}

/** Instant of local midnight on calendar day (y, m[1-12], d) in `tz`; m may over/underflow like Date.UTC. */
function zonedMidnight(y: number, m: number, d: number, tz: string): number {
  const naive = Date.UTC(y, m - 1, d);
  const offsetAt = (t: number) => { const p = zonedParts(t, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - t; };
  let t = naive - offsetAt(naive);
  t = naive - offsetAt(t); // second pass settles DST transitions
  return t;
}

/** Start of the day containing `ms` — in `tz`, or the browser's zone when none. */
export function dayStart(ms: number, tz?: string): number {
  if (!tz) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  const p = zonedParts(ms, tz);
  return zonedMidnight(p.y, p.m, p.d, tz);
}
/** Midnight of the calendar day `days` days away from the day containing `ms` (calendar days, so DST-safe). */
export function shiftDays(ms: number, tz: string | undefined, days: number): number {
  if (!tz) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime(); }
  const p = zonedParts(ms, tz);
  return zonedMidnight(p.y, p.m, p.d + days, tz);
}
/** "YYYY-MM-DD" of the day containing `ms` — in `tz`, or the browser's zone when none. */
export function ymdOf(ms: number, tz?: string): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  if (!tz) { const d = new Date(ms); return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  const p = zonedParts(ms, tz);
  return `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`;
}
/** Midnight of the calendar day "YYYY-MM-DD" (+ `plusDays`) — in `tz`, or the browser's zone; null when not a real date. */
export function ymdStart(ymd: string, tz?: string, plusDays = 0): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return tz ? zonedMidnight(y, mo, d + plusDays, tz) : new Date(y, mo - 1, d + plusDays).getTime();
}
function monthStart(ms: number, tz: string | undefined, monthsBack: number): number {
  if (!tz) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth() - monthsBack, 1).getTime(); }
  const p = zonedParts(ms, tz);
  return zonedMidnight(p.y, p.m - monthsBack, 1, tz);
}
function yearStart(ms: number, tz: string | undefined, yearsBack: number): number {
  if (!tz) { const d = new Date(ms); return new Date(d.getFullYear() - yearsBack, 0, 1).getTime(); }
  const p = zonedParts(ms, tz);
  return zonedMidnight(p.y - yearsBack, 1, 1, tz);
}

/**
 * Current window + the previous window of equal length (compare basis).
 * Uses the dataset's `now` so client and server agree on "as of". Days, months and years
 * start at midnight in `tz` (the shop's time zone, so "Today" matches the Shopify admin
 * and Ads Manager); without a zone they follow the browser. Daily buckets step 24 h from
 * that midnight, so on a DST-change day the later buckets of a series shift by an hour.
 */
export function range(now: number, key: RangeKey, tz?: string): Range {
  const ds = dayStart(now, tz);
  if (key === "today") {
    const elapsed = now - ds;
    return { cur: [ds, now], prev: [ds - DAY, ds - DAY + elapsed], grain: "hour" };
  }
  if (key === "yesterday") {
    return { cur: [ds - DAY, ds], prev: [ds - 2 * DAY, ds - DAY], grain: "hour" };
  }
  const n = LAST_N_DAYS[key];
  if (n) {
    const c0 = shiftDays(now, tz, -n);
    return { cur: [c0, ds], prev: [shiftDays(now, tz, -2 * n), c0], grain: n <= HOURLY_MAX_DAYS ? "hour" : "day" };
  }
  if (key === "mtd") {
    const m0 = monthStart(now, tz, 0), p0 = monthStart(now, tz, 1);
    return { cur: [m0, now], prev: [p0, p0 + (now - m0)], grain: "day" };
  }
  const y0 = yearStart(now, tz, 0), p0 = yearStart(now, tz, 1);
  return { cur: [y0, now], prev: [p0, p0 + (now - y0)], grain: "day" };
}

/**
 * A hand-picked range: the calendar days `from` … `to` ("YYYY-MM-DD", both included, either order)
 * in `tz`, cut at `now` when it reaches into today. Compared with the same number of days right
 * before it (a range still running today is compared up to the same time of day). Null when a
 * date is not a real date.
 */
export function customRange(now: number, from: string, to: string, tz?: string): Range | null {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const start = ymdStart(a, tz), end = ymdStart(b, tz, 1);
  if (start == null || end == null) return null;
  const days = Math.max(1, Math.round((end - start) / DAY));
  const c1 = Math.max(start, Math.min(end, now));
  const p0 = ymdStart(a, tz, -days)!;
  return { cur: [start, c1], prev: [p0, c1 === end ? start : p0 + (c1 - start)], grain: days <= HOURLY_MAX_DAYS ? "hour" : "day" };
}

/* ---------- series for sparklines ---------- */

const MAX_POINTS = 400;

/** One point per bucket (hour or day); the metric is computed per bucket. */
export function series(
  D: Dataset, t0: number, t1: number, grain: Grain, region: RegionKey | null,
  pick: (m: Metrics) => number | null,
): number[] {
  const step = grain === "hour" ? HOUR : DAY;
  const pts: number[] = [];
  for (let t = t0; t < t1; t += step) {
    const e = Math.min(t + step, t1);
    const v = pick(metrics(agg(D, t, e, region)));
    pts.push(v == null || !Number.isFinite(v) ? 0 : v);
    if (pts.length > MAX_POINTS) break;
  }
  return pts;
}

/** Per-platform spend per bucket. */
export function platSeries(D: Dataset, t0: number, t1: number, grain: Grain, platKey: PlatformKey): number[] {
  const step = grain === "hour" ? HOUR : DAY;
  const pts: number[] = [];
  for (let t = t0; t < t1; t += step) {
    pts.push(agg(D, t, Math.min(t + step, t1), null).plat[platKey]);
    if (pts.length > MAX_POINTS) break;
  }
  return pts;
}

/* ---------- platform attribution (MOCK — replaced by platform-reported conversions in Phase 4) ---------- */

const PLAT_ROAS_EFF: Record<PlatformKey, number> = { META: 2.05, GOOG: 6.2, TT: 2.4 };

export interface PlatformStat {
  key: PlatformKey; label: string; sym: string;
  spend: number; roas: number | null; cpa: number | null;
}

export function platformStats(m: Metrics): PlatformStat[] {
  return PLATFORMS.map((p) => {
    const spend = m.plat[p.key];
    const roas = PLAT_ROAS_EFF[p.key];
    const attRev = spend * roas;
    const aov = m.ncAov || 70;
    const attOrders = attRev / aov;
    return {
      key: p.key, label: p.label, sym: p.sym, spend,
      roas: spend > 0 ? roas : null,
      cpa: attOrders > 0 ? spend / attOrders : null,
    };
  });
}

/* ---------- formatting (shop currency, en-GB dates, tabular numbers) ---------- */

const moneyFormats = new Map<string, Intl.NumberFormat>();
function moneyFormat(currency: string, dec: number): Intl.NumberFormat {
  const k = `${currency}:${dec}`;
  let f = moneyFormats.get(k);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "symbol", minimumFractionDigits: dec, maximumFractionDigits: dec });
    } catch {
      // unknown code (bad data from a source): plain number with the code in front
      const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
      f = { format: (n: number) => `${currency} ${nf.format(n)}` } as Intl.NumberFormat;
    }
    moneyFormats.set(k, f);
  }
  return f;
}

/**
 * Money in the shop's currency: "€12,345", "CA$36.51", "£1,055". Whole units from 100 up,
 * two decimals below (or `dec` decimals when given); negatives get a true minus sign.
 */
export function money(v: number | null | undefined, dec: number | undefined, currency: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const neg = v < 0; const a = Math.abs(v);
  const d = dec != null ? dec : (a < 100 ? 2 : 0);
  return (neg ? "−" : "") + moneyFormat(currency || "EUR", d).format(a);
}
/** EUR shorthand (mock data, places without a shop currency). */
export function eur(v: number | null | undefined, dec?: number): string {
  return money(v, dec, "EUR");
}
export function num(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("en-US");
}
export function ratio(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : v.toFixed(2);
}
export function pct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : Math.round(v * 100) + "%";
}
/** Relative change cur vs prev; null when undefined (no prev, zero prev). */
export function delta(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (prev == null || cur == null || !Number.isFinite(prev) || !Number.isFinite(cur) || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}
export function fmtDelta(d: number | null): string {
  if (d == null) return "—";
  const a = Math.abs(d) * 100;
  return (d >= 0 ? "▲" : "▼") + " " + (a > 999 ? ">999%" : Math.round(a) + "%");
}
