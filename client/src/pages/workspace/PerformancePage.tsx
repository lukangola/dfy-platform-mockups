/**
 * DESIGN: Studio Control Room — Performance
 *
 * Ecom performance dashboard for the ACTIVE brand: 14 KPI cards with
 * hourly/daily sparklines, date range (Today / Yesterday / MTD / YTD), compare
 * to the previous period of equal length, country filter, by-region table and
 * by-ad-platform table. Layout and behaviour ported from the reference
 * dashboard (performance-dashboard repo, index.html); metrics come from the
 * shared engine (`@shared/performance/engine`), data from
 * GET /api/performance/hours (mock today, live per client later).
 *
 * Reconciliation invariants (the dashboard is wrong if any breaks):
 *   - every KPI card == the Total row's matching column (same agg → same numbers)
 *   - region rows sum to the Total row for additive columns
 *   - platform-table spend == the Meta / Google / TikTok columns of the Total row
 *
 * Deltas: green = good direction, red = bad; cost metrics invert (lower NCPA is
 * green); spend is neutral (grey). Spec: INANA_DASHBOARD_SPEC.md.
 *
 * Access: managers + admins, any brand, behind PERFORMANCE_ENABLED. The page
 * re-checks both so a hand-typed URL can't bypass the hidden nav.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Calendar, Loader2, RefreshCw, ShieldAlert, Lock, AlertTriangle, Plug, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBrand } from "@/contexts/BrandContext";
import { PERFORMANCE_ENABLED } from "@/lib/featureFlags";
import { getPerformanceConfig, getPerformanceHours, getPerformanceStatus, type PerformanceConfig, type PerformanceSyncState } from "@/lib/api";
import PerformanceSourcesPanel, { relTime } from "@/components/PerformanceSourcesPanel";
import {
  REGIONS, PLATFORMS, RANGE_LABELS, HOUR, DAY,
  agg, metrics, range, series, platSeries, platformStats,
  eur, num, ratio, pct, delta, fmtDelta,
  type Dataset, type Grain, type Metrics, type MetricKey, type RangeKey, type RegionKey,
} from "@shared/performance/engine";

// ─────────────────────────────────────────────────────────────────────────────
// Column / card definitions (mirror the reference exactly — no extra KPIs)
// ─────────────────────────────────────────────────────────────────────────────

type Fmt = (v: number | null | undefined) => string;
/** up: true = higher is good, false = lower is good (costs), null = neutral (spend). */
interface MetricDef { k: MetricKey | "pMETA" | "pGOOG" | "pTT"; label: string; fmt: Fmt; up: boolean | null }

const eur0: Fmt = (v) => eur(v);
const eur2: Fmt = (v) => eur(v, 2);

const CARDS: MetricDef[] = [
  { k: "revenue", label: "Total revenue", fmt: eur0, up: true },
  { k: "cm", label: "Total CM", fmt: eur0, up: true },
  { k: "ncRoas", label: "NC ROAS", fmt: ratio, up: true },
  { k: "ncpa", label: "NCPA", fmt: eur2, up: false },
  { k: "ncCm", label: "NC CM", fmt: eur0, up: true },
  { k: "rcCm", label: "RC CM", fmt: eur0, up: true },
  { k: "spend", label: "Ad spend", fmt: eur0, up: null },
  { k: "cmPct", label: "CM%", fmt: pct, up: true },
  { k: "ncCmPct", label: "NC CM%", fmt: pct, up: true },
  { k: "ncOrders", label: "NC orders", fmt: num, up: true },
  { k: "rcOrders", label: "RC orders", fmt: num, up: true },
  { k: "ncAov", label: "NC AOV", fmt: eur2, up: true },
  { k: "rcAov", label: "RC AOV", fmt: eur2, up: true },
  { k: "grossMargin", label: "Gross margin %", fmt: pct, up: true },
];

const REGION_COLS: MetricDef[] = [
  { k: "revenue", label: "Revenue", fmt: eur0, up: true },
  { k: "cm", label: "CM", fmt: eur0, up: true },
  { k: "ncCmPct", label: "NC CM%", fmt: pct, up: true },
  { k: "ncpa", label: "NCPA", fmt: eur2, up: false },
  { k: "ncRoas", label: "NC ROAS", fmt: ratio, up: true },
  { k: "ncCm", label: "NC CM", fmt: eur0, up: true },
  { k: "ncOrders", label: "NC orders", fmt: num, up: true },
  { k: "rcOrders", label: "RC orders", fmt: num, up: true },
  { k: "ncAov", label: "NC AOV", fmt: eur2, up: true },
  { k: "rcAov", label: "RC AOV", fmt: eur2, up: true },
  { k: "cmPct", label: "CM%", fmt: pct, up: true },
  { k: "pMETA", label: "∞ Meta", fmt: eur0, up: null },
  { k: "pGOOG", label: "G Google", fmt: eur0, up: null },
  { k: "pTT", label: "♪ TikTok", fmt: eur0, up: null },
  { k: "spend", label: "Ad spend", fmt: eur0, up: null },
];

const RANGE_KEYS: RangeKey[] = ["today", "yesterday", "mtd", "ytd"];
type CompareMode = "prev" | "off";
type RowMetrics = Metrics & { pMETA: number; pGOOG: number; pTT: number };

function withPlatformCols(m: Metrics): RowMetrics {
  return { ...m, pMETA: m.plat.META, pGOOG: m.plat.GOOG, pTT: m.plat.TT };
}

/** The data window the current range needs: from the earlier of prev/cur start to now. */
function windowFor(now: number, key: RangeKey): [number, number] {
  const r = range(now, key);
  return [Math.min(r.prev[0], r.cur[0]), now];
}

// ─────────────────────────────────────────────────────────────────────────────
// Small presentational pieces
// ─────────────────────────────────────────────────────────────────────────────

function DeltaChip({ cur, prev, up, compare }: { cur: number | null | undefined; prev: number | null | undefined; up: boolean | null; compare: CompareMode }) {
  if (compare === "off") return null;
  const d = delta(cur, prev);
  if (d == null) return <span className="text-[10px] font-mono text-white/25 tabular-nums">—</span>;
  let tone = "text-white/40";
  if (up === true) tone = d >= 0 ? "text-emerald-400" : "text-rose-400";
  if (up === false) tone = d >= 0 ? "text-rose-400" : "text-emerald-400";
  return <span className={`text-[10px] font-mono tabular-nums whitespace-nowrap ${tone}`}>{fmtDelta(d)}</span>;
}

function bucketLabel(t0: number, grain: Grain, i: number): string {
  const d = new Date(t0 + i * (grain === "hour" ? HOUR : DAY));
  return grain === "hour"
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

/**
 * Hand-rolled SVG sparkline (no chart lib — keeps the dashboard dependency-free
 * and pixel-identical to the reference). Hover shows bucket label + value.
 */
function Sparkline({ pts, t0, grain, fmt, height = 34 }: { pts: number[]; t0: number; grain: Grain; fmt: Fmt; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const w = 120, h = height, pad = 2;
  const n = pts.length;
  const geom = useMemo(() => {
    if (n < 2) return null;
    let mn = Math.min(...pts), mx = Math.max(...pts);
    if (mx === mn) mx = mn + 1;
    const xy = pts.map((v, i) => {
      const x = pad + ((w - 2 * pad) * i) / (n - 1);
      const y = h - pad - ((h - 2 * pad) * (v - mn)) / (mx - mn);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = xy.join(" ");
    const area = `${line} ${w - pad},${h - pad} ${pad},${h - pad}`;
    return { line, area, xy };
  }, [pts, n, h]);

  if (!geom) return <div style={{ height: h }} className="w-full" />;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const i = Math.round(((e.clientX - rect.left) / rect.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const hx = hover != null ? Number(geom.xy[hover].split(",")[0]) : null;

  return (
    <div className="relative w-full" style={{ height: h }}>
      <svg
        ref={ref}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="w-full h-full block"
        role="img"
        aria-label="trend"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <polygon points={geom.area} fill="rgba(0,212,255,0.10)" />
        <polyline points={geom.line} fill="none" stroke="#00D4FF" strokeWidth={1.2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hx != null && <line x1={hx} x2={hx} y1={0} y2={h} stroke="rgba(255,255,255,0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute -top-7 z-20 rounded border border-white/[0.08] bg-[#1A1D23] px-2 py-1 text-[10px] font-mono text-white/80 whitespace-nowrap tabular-nums"
          style={{ left: `${(hover / (n - 1)) * 100}%`, transform: "translateX(-50%)" }}
        >
          {bucketLabel(t0, grain, hover)} · {fmt(pts[hover])}
        </div>
      )}
    </div>
  );
}

function KpiCard({ def, cur, prev, pts, t0, grain, compare, caption }: {
  def: MetricDef; cur: RowMetrics; prev: RowMetrics; pts: number[]; t0: number; grain: Grain; compare: CompareMode; caption: string;
}) {
  const v = cur[def.k] as number | null;
  const p = prev[def.k] as number | null;
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#0D0F12] p-4 hover:border-white/[0.12] transition-colors">
      <div className="text-[10px] font-mono uppercase tracking-widest text-white/35">{def.label}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-xl font-semibold text-white/90 tabular-nums">{def.fmt(v)}</span>
        <DeltaChip cur={v} prev={p} up={def.up} compare={compare} />
      </div>
      <div className="mt-3">
        <Sparkline pts={pts} t0={t0} grain={grain} fmt={def.fmt} />
      </div>
      <div className="mt-2 text-[9px] font-mono text-white/25 uppercase tracking-wider">{caption}</div>
    </div>
  );
}

function SegButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-[11px] font-mono tracking-wide transition-colors ${
        active ? "bg-cyan-500/15 text-cyan-300 border border-cyan-400/30" : "text-white/45 hover:text-white/75 hover:bg-white/[0.04] border border-transparent"
      }`}
    >
      {children}
    </button>
  );
}

const selectCls = "bg-[#0D0F12] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-[11px] font-mono text-white/80 focus:outline-none focus:border-cyan-400/40";

function EmptyState({ icon: Icon, title, body }: { icon: React.ElementType; title: string; body: string }) {
  return (
    <div className="p-8">
      <div className="rounded-xl border border-white/[0.07] bg-[#0D0F12] p-10 text-center">
        <Icon size={22} className="mx-auto text-white/30" />
        <div className="mt-3 text-sm font-medium text-white/80">{title}</div>
        <div className="mt-1 text-xs text-white/40 font-mono">{body}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function PerformancePage() {
  const { role } = useAuth();
  const { activeBrandId, activeBrand } = useBrand();
  const canUse = role === "admin" || role === "manager";

  const [rangeKey, setRangeKey] = useState<RangeKey>("today");
  const [country, setCountry] = useState<RegionKey | "">("");
  const [compare, setCompare] = useState<CompareMode>("prev");

  const [config, setConfig] = useState<PerformanceConfig | null>(null);
  const [sync, setSync] = useState<PerformanceSyncState[]>([]);
  const [running, setRunning] = useState(false);
  const [secretsKeySet, setSecretsKeySet] = useState(true);
  const [showSources, setShowSources] = useState(false);
  const [data, setData] = useState<Dataset | null>(null);
  const [source, setSource] = useState<"mock" | "live" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeBrandId || !canUse || !PERFORMANCE_ENABLED) return;
    setLoading(true);
    setError(null);
    try {
      const now = Date.now();
      // YTD needs the widest window (this year + the same stretch of last year);
      // fetching it once covers every range, so switching ranges is instant.
      const [from, to] = windowFor(now, "ytd");
      const [cfg, hours] = await Promise.all([
        getPerformanceConfig(activeBrandId),
        getPerformanceHours(activeBrandId, from, to),
      ]);
      setConfig(cfg.config);
      setSync(cfg.sync);
      setRunning(cfg.running);
      setSecretsKeySet(cfg.secretsKeySet);
      setData(hours.dataset);
      setSource(hours.source);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [activeBrandId, canUse]);

  useEffect(() => { void load(); }, [load]);

  // While a sync runs, poll its status every 3s; when it finishes, reload the numbers.
  useEffect(() => {
    if (!running || !activeBrandId) return;
    let cancelled = false;
    const t = setInterval(async () => {
      try {
        const st = await getPerformanceStatus(activeBrandId);
        if (cancelled) return;
        setSync(st.sync);
        if (!st.running) { setRunning(false); void load(); }
      } catch { /* keep polling */ }
    }, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [running, activeBrandId, load]);

  const view = useMemo(() => {
    if (!data) return null;
    const r = range(data.now, rangeKey);
    const reg: RegionKey | null = country || null;
    const cur = withPlatformCols(metrics(agg(data, r.cur[0], r.cur[1], reg)));
    const prev = withPlatformCols(metrics(agg(data, r.prev[0], r.prev[1], reg)));
    const cardSeries = CARDS.map((c) => series(data, r.cur[0], r.cur[1], r.grain, reg, (m) => m[c.k as MetricKey] as number | null));
    const rows = [...REGIONS.map((rg) => ({ key: rg.key as RegionKey | null, label: rg.label, flag: rg.flag })), { key: null, label: "Total", flag: "" }]
      .map((row) => {
        const cs = agg(data, r.cur[0], r.cur[1], row.key);
        const ps = agg(data, r.prev[0], r.prev[1], row.key);
        return { ...row, cur: withPlatformCols(metrics(cs)), prev: withPlatformCols(metrics(ps)) };
      });
    const pStats = platformStats(cur);
    const pPrev = platformStats(prev);
    const pSeries = PLATFORMS.map((p) => platSeries(data, r.cur[0], r.cur[1], r.grain, p.key));
    return { r, cur, prev, cardSeries, rows, pStats, pPrev, pSeries };
  }, [data, rangeKey, country]);

  // ── gates ──────────────────────────────────────────────────────────────────
  if (!PERFORMANCE_ENABLED) {
    return <EmptyState icon={Lock} title="Performance is not enabled" body="This section is behind a feature flag (VITE_FEATURE_PERFORMANCE)." />;
  }
  if (!canUse) {
    return <EmptyState icon={ShieldAlert} title="Managers and admins only" body="Ask an admin to upgrade your role to see client performance." />;
  }
  if (!activeBrandId) {
    return <EmptyState icon={BarChart3} title="Select a brand" body="Performance is scoped to the active brand. Pick one in the switcher above." />;
  }

  const nowD = data ? new Date(data.now) : new Date();
  const dateChip = nowD.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const regLabel = country ? REGIONS.find((x) => x.key === country)!.label : null;
  const caption = view?.r.grain === "hour"
    ? `Hourly · ${nowD.toLocaleDateString("en-GB", { month: "short", day: "numeric" })} · ${source === "live" ? "live" : "mock"}`
    : `Daily · ${source === "live" ? "live" : "mock"}`;

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Performance / Market overview</div>
          <h1 className="text-lg font-semibold text-white/90 mt-1">{activeBrand?.name ?? "Brand"}</h1>
          <p className="text-xs text-white/40 font-mono mt-1">
            {regLabel ? `Market: ${regLabel}` : "Blended (all markets)"}
            {view && <> · {num(view.cur.salesRows)} sales rows · {num(view.cur.adRows)} ad rows · as of {nowD.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</>}
          </p>
          {source === "live" && (
            <p className="text-[10px] text-white/30 font-mono mt-1">
              {(["shopify", "meta", "google"] as const).map((k, i) => {
                const st = sync.find((x) => x.source === k);
                const name = k === "shopify" ? "Shopify" : k === "meta" ? "Meta" : "Google";
                const txt = !st || st.status === "idle" ? "not connected" : st.status === "running" ? "syncing…" : st.status === "error" ? "error" : `synced ${relTime(st.lastSyncedAt)}`;
                const tone = st?.status === "error" ? "text-rose-400" : st?.status === "ok" ? "text-emerald-400/80" : "text-white/30";
                return <span key={k}>{i > 0 && " · "}{name} <span className={tone}>{txt}</span></span>;
              })}
            </p>
          )}
          {source === "live" && data?.costCoverage != null && data.costCoverage < 0.95 && (
            <p className="text-[10px] text-amber-300 font-mono mt-1 inline-flex items-center gap-1">
              <AlertTriangle size={10} /> Shopify has no "Cost per item" for {Math.round((1 - data.costCoverage) * 100)}% of this window's revenue — margin and CM are overstated until those products get a cost.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSources((v) => !v)}
            title="Connect data sources"
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors ${
              source === "live" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20" : "border-amber-400/30 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20"
            }`}
          >
            {running ? <Loader2 size={10} className="animate-spin" /> : <Plug size={10} />}
            {source === "live" ? "Live data" : "Mock data"}
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#0D0F12] px-2.5 py-1.5 text-[11px] font-mono text-white/70">
            <Calendar size={12} className="text-white/40" /> {dateChip}
          </span>
        </div>
      </div>

      {/* Control bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#0D0F12] px-2.5 py-1.5 text-[11px] font-mono text-white/70 hover:text-white hover:border-white/[0.16] disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
        </button>
        <button
          type="button"
          onClick={() => setShowSources((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-mono transition-colors ${showSources ? "border-cyan-400/30 bg-cyan-400/15 text-cyan-200" : "border-white/[0.08] bg-[#0D0F12] text-white/70 hover:text-white hover:border-white/[0.16]"}`}
        >
          <Plug size={12} /> Data sources {showSources ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        <div className="inline-flex items-center gap-1 rounded-lg border border-white/[0.07] bg-[#0D0F12] p-1">
          {RANGE_KEYS.map((k) => (
            <SegButton key={k} active={rangeKey === k} onClick={() => setRangeKey(k)}>{RANGE_LABELS[k]}</SegButton>
          ))}
        </div>
        <div className="flex-1" />
        <label className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-white/35">
          Country
          <select className={selectCls} value={country} onChange={(e) => setCountry(e.target.value as RegionKey | "")}>
            <option value="">Total</option>
            {REGIONS.map((rg) => <option key={rg.key} value={rg.key}>{rg.label}</option>)}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-white/35">
          Compare
          <select className={selectCls} value={compare} onChange={(e) => setCompare(e.target.value as CompareMode)}>
            <option value="prev">Previous period</option>
            <option value="off">Off</option>
          </select>
        </label>
      </div>

      {showSources && config && activeBrandId && (
        <PerformanceSourcesPanel
          brandId={activeBrandId}
          config={config}
          sync={sync}
          running={running}
          secretsKeySet={secretsKeySet}
          onSaved={(c) => { setConfig(c); void load(); }}
          onSyncStarted={() => setRunning(true)}
        />
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs font-mono text-rose-300">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {!view ? (
        <div className="flex items-center gap-2 text-white/40 text-sm"><Loader2 size={14} className="animate-spin" /> Loading performance data…</div>
      ) : (
        <>
          {/* KPI cards */}
          <section>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
              {CARDS.map((c, i) => (
                <KpiCard key={c.k} def={c} cur={view.cur} prev={view.prev} pts={view.cardSeries[i]} t0={view.r.cur[0]} grain={view.r.grain} compare={compare} caption={caption} />
              ))}
            </div>
          </section>

          {/* By region */}
          <section>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-[11px] font-mono uppercase tracking-wide text-cyan-300/70">By region</h2>
              <span className="text-[10px] font-mono text-white/25">Shopify (sales by country) + platform APIs (ad spend) — {source === "live" ? "live" : "mock"}</span>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-[#0D0F12] overflow-x-auto scrollbar-thin">
              <table className="w-full text-[12px] tabular-nums">
                <thead>
                  <tr className="text-[10px] font-mono uppercase tracking-wider text-white/35">
                    <th className="text-left font-normal px-4 py-3 sticky left-0 bg-[#0D0F12]">Region</th>
                    {REGION_COLS.map((c) => <th key={c.k} className="text-right font-normal px-3 py-3 whitespace-nowrap">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {view.rows.map((row) => {
                    const isTotal = row.key === null;
                    const hot = row.key !== null && row.key === country;
                    return (
                      <tr key={row.label} className={`${isTotal ? "bg-white/[0.02] font-semibold" : ""} ${hot ? "bg-cyan-500/[0.06]" : ""}`}>
                        <td className={`px-4 py-3 whitespace-nowrap sticky left-0 ${hot ? "bg-[#0F1A1F]" : "bg-[#0D0F12]"} ${isTotal ? "text-white/90" : "text-white/80"}`}>
                          {row.flag && <span className="mr-2">{row.flag}</span>}{row.label}
                        </td>
                        {REGION_COLS.map((c) => {
                          const v = row.cur[c.k] as number | null;
                          const p = row.prev[c.k] as number | null;
                          const noTT = c.k === "pTT" && v === 0;
                          return (
                            <td key={c.k} className="px-3 py-3 text-right whitespace-nowrap">
                              <div className={isTotal ? "text-white/90" : "text-white/80"}>{noTT ? "—" : c.fmt(v)}</div>
                              {!noTT && <div className="mt-0.5"><DeltaChip cur={v} prev={p} up={c.up} compare={compare} /></div>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* By ad platform */}
          <section>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-[11px] font-mono uppercase tracking-wide text-cyan-300/70">By ad platform</h2>
              <span className="text-[10px] font-mono text-white/25">ROAS / CPA use platform-reported attribution — mock factors until Phase 4</span>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-[#0D0F12] overflow-x-auto scrollbar-thin">
              <table className="w-full text-[12px] tabular-nums">
                <thead>
                  <tr className="text-[10px] font-mono uppercase tracking-wider text-white/35">
                    <th className="text-left font-normal px-4 py-3">Platform</th>
                    <th className="text-right font-normal px-3 py-3">Spend</th>
                    <th className="text-right font-normal px-3 py-3">ROAS</th>
                    <th className="text-right font-normal px-3 py-3">CPA</th>
                    <th className="text-left font-normal px-3 py-3 w-[260px]">{view.r.grain === "hour" ? "Hourly" : "Daily"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {view.pStats.map((p, i) => {
                    const q = view.pPrev[i];
                    return (
                      <tr key={p.key}>
                        <td className="px-4 py-3 whitespace-nowrap text-white/80">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-white/[0.05] text-[10px] font-mono text-white/60 mr-2">{p.sym}</span>{p.label}
                        </td>
                        <td className="px-3 py-3 text-right"><div className="text-white/80">{eur(p.spend)}</div><div className="mt-0.5"><DeltaChip cur={p.spend} prev={q.spend} up={null} compare={compare} /></div></td>
                        <td className="px-3 py-3 text-right"><div className="text-white/80">{ratio(p.roas)}</div><div className="mt-0.5"><DeltaChip cur={p.roas} prev={q.roas} up={true} compare={compare} /></div></td>
                        <td className="px-3 py-3 text-right"><div className="text-white/80">{p.cpa == null ? "—" : eur(p.cpa, 2)}</div><div className="mt-0.5"><DeltaChip cur={p.cpa} prev={q.cpa} up={false} compare={compare} /></div></td>
                        <td className="px-3 py-2 w-[260px]"><Sparkline pts={view.pSeries[i]} t0={view.r.cur[0]} grain={view.r.grain} fmt={eur0} height={28} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-[10px] font-mono text-white/25">
            Gross margin = (revenue − cost of goods from Shopify) ÷ revenue{view?.cur.grossMargin != null ? ` = ${pct(view.cur.grossMargin)}` : ""} · CM = gross profit − ad spend · NC CM = margin × NC revenue − ad spend · RC CM = margin × RC revenue · currency EUR · dates en-GB
          </p>
        </>
      )}
    </div>
  );
}
