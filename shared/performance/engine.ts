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
 *   { t, c: { REGION: [ncOrders, ncRev, rcOrders, rcRev] }, s: { PLATFORM: [spendPerRegion x4] } }
 *
 * Everything downstream (agg → metrics → range/series → UI) keeps working once
 * real data fills it. Do not fork agg/metrics per source.
 *
 * Economics (gross margin %, remarketing share of spend) are PARAMETERS, not
 * constants — they come from the per-client config (see server/lib/performance/config.ts).
 */

export type RegionKey = "NLBE" | "UK" | "USA" | "OTH";
export type PlatformKey = "META" | "GOOG" | "TT";

export interface RegionDef { key: RegionKey; label: string; flag: string }
export interface PlatformDef { key: PlatformKey; label: string; sym: string }

export const REGIONS: readonly RegionDef[] = [
  { key: "NLBE", label: "NL/BE", flag: "🇳🇱" },
  { key: "UK", label: "UK", flag: "🇬🇧" },
  { key: "USA", label: "USA", flag: "🇺🇸" },
  { key: "OTH", label: "Other", flag: "🌍" },
];

export const PLATFORMS: readonly PlatformDef[] = [
  { key: "META", label: "Meta", sym: "∞" },
  { key: "GOOG", label: "Google", sym: "G" },
  { key: "TT", label: "TikTok", sym: "♪" },
];

/** [ncOrders, ncRevenue, rcOrders, rcRevenue] */
export type RegionCell = [number, number, number, number];
/** spend per region, indexed like REGIONS */
export type PlatformSpend = [number, number, number, number];

export interface HourBucket {
  /** bucket start, epoch ms, aligned to the hour */
  t: number;
  c: Record<RegionKey, RegionCell>;
  s: Record<PlatformKey, PlatformSpend>;
}

/** A contiguous hourly dataset. `hours[i].t === startMs + i * HOUR`. */
export interface Dataset {
  hours: HourBucket[];
  startMs: number;
  /** "as of" — the moment the data was produced */
  now: number;
  /** start of the hour that contains `now` (the last, partial bucket) */
  nowHourMs: number;
}

/** Per-client economics that drive the derived metrics. */
export interface Economics {
  /** contribution margin rate before ad spend, e.g. 0.52 */
  grossMargin: number;
  /** share of total spend counted as remarketing (RC side), e.g. 0.12 */
  remarketingShare: number;
}

export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/* ---------- aggregation ---------- */

export interface Sums {
  ncO: number; rcO: number; ncR: number; rcR: number; spend: number;
  plat: Record<PlatformKey, number>;
  salesRows: number; adRows: number;
}

function zeroSums(): Sums {
  return { ncO: 0, rcO: 0, ncR: 0, rcR: 0, spend: 0, plat: { META: 0, GOOG: 0, TT: 0 }, salesRows: 0, adRows: 0 };
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
    for (let r = 0; r < REGIONS.length; r++) {
      const k = REGIONS[r].key;
      if (region && k !== region) continue;
      const o = h.c[k];
      out.ncO += o[0]; out.ncR += o[1]; out.rcO += o[2]; out.rcR += o[3];
      if (o[0] + o[2] > 0) out.salesRows += o[0] + o[2];
      for (const p of PLATFORMS) {
        const sp = h.s[p.key][r];
        out.spend += sp; out.plat[p.key] += sp;
        if (sp > 0) out.adRows++;
      }
    }
  }
  return out;
}

/* ---------- derived metrics ---------- */

export interface Metrics {
  revenue: number;
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
  rcpa: number | null;
  plat: Record<PlatformKey, number>;
  salesRows: number;
  adRows: number;
}

/** Metric keys that are plain numbers or nullable numbers — used by cards/tables. */
export type MetricKey = Exclude<keyof Metrics, "plat">;

/**
 * Definitions (mock-era, to be confirmed per client):
 *   CM     = margin × revenue − spend
 *   NC CM  = margin × NC revenue − prospecting spend  (prospecting = 1 − remarketingShare)
 *   RC CM  = margin × RC revenue − remarketing spend
 *   NCPA   = total spend ÷ NC orders;  RCPA = remarketing spend ÷ RC orders
 *   NC ROAS = NC revenue ÷ total spend
 */
export function metrics(s: Sums, econ: Economics): Metrics {
  const { grossMargin: M, remarketingShare: R } = econ;
  const rev = s.ncR + s.rcR;
  const cm = M * rev - s.spend;
  const ncCm = M * s.ncR - (1 - R) * s.spend;
  const rcCm = M * s.rcR - R * s.spend;
  return {
    revenue: rev,
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
    rcpa: s.rcO > 0 ? (R * s.spend) / s.rcO : null,
    plat: s.plat, salesRows: s.salesRows, adRows: s.adRows,
  };
}

/* ---------- date ranges ---------- */

export type RangeKey = "today" | "yesterday" | "mtd" | "ytd";
export type Grain = "hour" | "day";

export interface Range {
  cur: [number, number];
  prev: [number, number];
  grain: Grain;
}

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today", yesterday: "Yesterday", mtd: "Month to date", ytd: "Year to date",
};

function dayStart(ms: number): number {
  const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime();
}

/**
 * Current window + the previous window of equal length (compare basis).
 * Uses the dataset's `now` so client and server agree on "as of".
 */
export function range(now: number, key: RangeKey): Range {
  const ds = dayStart(now);
  const nd = new Date(now);
  if (key === "today") {
    const elapsed = now - ds;
    return { cur: [ds, now], prev: [ds - DAY, ds - DAY + elapsed], grain: "hour" };
  }
  if (key === "yesterday") {
    return { cur: [ds - DAY, ds], prev: [ds - 2 * DAY, ds - DAY], grain: "hour" };
  }
  if (key === "mtd") {
    const m0 = new Date(nd.getFullYear(), nd.getMonth(), 1).getTime();
    const p0 = new Date(nd.getFullYear(), nd.getMonth() - 1, 1).getTime();
    return { cur: [m0, now], prev: [p0, p0 + (now - m0)], grain: "day" };
  }
  const y0 = new Date(nd.getFullYear(), 0, 1).getTime();
  const p0 = new Date(nd.getFullYear() - 1, 0, 1).getTime();
  return { cur: [y0, now], prev: [p0, p0 + (now - y0)], grain: "day" };
}

/* ---------- series for sparklines ---------- */

const MAX_POINTS = 400;

/** One point per bucket (hour or day); the metric is computed per bucket. */
export function series(
  D: Dataset, t0: number, t1: number, grain: Grain, region: RegionKey | null,
  econ: Economics, pick: (m: Metrics) => number | null,
): number[] {
  const step = grain === "hour" ? HOUR : DAY;
  const pts: number[] = [];
  for (let t = t0; t < t1; t += step) {
    const e = Math.min(t + step, t1);
    const v = pick(metrics(agg(D, t, e, region), econ));
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

/* ---------- formatting (EUR, en-GB dates, tabular numbers) ---------- */

const nf0 = { minimumFractionDigits: 0, maximumFractionDigits: 0 };

export function eur(v: number | null | undefined, dec?: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const neg = v < 0; const a = Math.abs(v);
  const opts = dec != null
    ? { minimumFractionDigits: dec, maximumFractionDigits: dec }
    : (a < 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : nf0);
  return (neg ? "−" : "") + "€" + a.toLocaleString("en-US", opts);
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
