/**
 * "Connect data sources" panel for the Performance dashboard.
 *
 * Managers paste the Shopify / Meta / Google Ads credentials once; the server
 * stores them encrypted and only ever reports "set". Each source has a Test
 * button (credential check, no data written) and the panel shows sync
 * freshness per source. Switching "Data source" to Live swaps the dashboard
 * from the mock generator to the synced tables.
 *
 * Every connection is read-only: Shopify read_* scopes (the Test button lists
 * the scopes the token really has and flags write_* ones), Meta ads_read only,
 * Google Ads read queries only. No economics inputs — margin comes from Shopify
 * unit costs.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Loader2, Plug, RefreshCw, Save, ShieldCheck } from "lucide-react";
import {
  savePerformanceConfig, startPerformanceSync, testPerformanceSource,
  type PerformanceAccountMap, type PerformanceConfig, type PerformanceConfigPatch, type PerformanceSyncState, type PerformanceTestResult,
} from "@/lib/api";

const REGIONS: Array<{ key: PerformanceAccountMap["region"]; label: string }> = [
  { key: "NLBE", label: "NL/BE" }, { key: "UK", label: "UK" }, { key: "USA", label: "USA" }, { key: "OTH", label: "Other" },
];

const input = "w-full bg-[#0A0C0F] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-[12px] text-white/85 placeholder:text-white/25 focus:outline-none focus:border-cyan-400/40 font-mono";
const label = "block text-[10px] font-mono uppercase tracking-wider text-white/35 mb-1";
const btn = "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-mono transition-colors disabled:opacity-50";
const btnGhost = `${btn} border-white/[0.08] bg-[#0D0F12] text-white/70 hover:text-white hover:border-white/[0.16]`;
const btnPrimary = `${btn} border-cyan-400/30 bg-cyan-400/15 text-cyan-200 hover:bg-cyan-400/25`;

export function relTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** "act_123:NLBE, act_456:UK" ⇄ [{id, region}] */
function parseAccounts(text: string): PerformanceAccountMap[] {
  return text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).flatMap((pair) => {
    const [id, region] = pair.split(/[:=\s]+/);
    const r = REGIONS.find((x) => x.key === (region ?? "").toUpperCase())?.key;
    return id && r ? [{ id: id.trim(), region: r }] : [];
  });
}
function accountsText(list: PerformanceAccountMap[]): string {
  return list.map((a) => `${a.id}:${a.region}`).join(", ");
}

function SecretField({ id, name, set, value, onChange, placeholder }: { id: string; name: string; set: boolean; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label htmlFor={id} className={label}>{name} {set && <span className="text-emerald-400/80 normal-case tracking-normal">· set</span>}</label>
      <input id={id} type="password" autoComplete="off" className={input} value={value} onChange={(e) => onChange(e.target.value)} placeholder={set ? "•••••••• (leave empty to keep)" : (placeholder ?? "paste here")} />
    </div>
  );
}

function StatusPill({ st }: { st: PerformanceSyncState | undefined }) {
  if (!st || st.status === "idle") return <span className="text-[10px] font-mono text-white/30">not connected</span>;
  if (st.status === "running") return <span className="inline-flex items-center gap-1 text-[10px] font-mono text-cyan-300"><Loader2 size={10} className="animate-spin" /> syncing…</span>;
  if (st.status === "error") return <span className="inline-flex items-center gap-1 text-[10px] font-mono text-rose-400" title={st.error ?? ""}><AlertTriangle size={10} /> error · {relTime(st.lastStartedAt)}</span>;
  return <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400"><CheckCircle2 size={10} /> synced {relTime(st.lastSyncedAt)} · {st.rowsTotal.toLocaleString("en-US")} rows</span>;
}

export default function PerformanceSourcesPanel({ brandId, config, sync, running, secretsKeySet, onSaved, onSyncStarted }: {
  brandId: string; config: PerformanceConfig; sync: PerformanceSyncState[]; running: boolean; secretsKeySet: boolean;
  onSaved: (c: PerformanceConfig) => void; onSyncStarted: () => void;
}) {
  const [form, setForm] = useState(() => ({
    dataSource: config.dataSource,
    ncDefinition: config.ncDefinition, ncWindowDays: String(config.ncWindowDays), revenueField: config.revenueField,
    syncEveryMinutes: String(config.syncEveryMinutes),
    shopifyShopDomain: config.shopify.shopDomain ?? "", shopifyClientId: config.shopify.clientId ?? "", shopifyClientSecret: "", shopifyToken: "",
    metaToken: "", metaAccounts: accountsText(config.meta.accounts),
    googleDeveloperToken: "", googleClientId: config.google.clientId ?? "", googleClientSecret: "", googleRefreshToken: "",
    googleLoginCustomerId: config.google.loginCustomerId ?? "", googleAccounts: accountsText(config.google.accounts),
  }));
  useEffect(() => {
    setForm((f) => ({ ...f, dataSource: config.dataSource, shopifyShopDomain: config.shopify.shopDomain ?? "", shopifyClientId: config.shopify.clientId ?? "", metaAccounts: accountsText(config.meta.accounts), googleClientId: config.google.clientId ?? "", googleLoginCustomerId: config.google.loginCustomerId ?? "", googleAccounts: accountsText(config.google.accounts) }));
  }, [config]);

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, PerformanceTestResult>>({});
  const [advanced, setAdvanced] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const by = (s: PerformanceSyncState["source"]) => sync.find((x) => x.source === s);

  const patch = (): PerformanceConfigPatch => ({
    dataSource: form.dataSource,
    ncDefinition: form.ncDefinition, ncWindowDays: Number(form.ncWindowDays), revenueField: form.revenueField,
    syncEveryMinutes: Number(form.syncEveryMinutes),
    shopifyShopDomain: form.shopifyShopDomain, shopifyClientId: form.shopifyClientId, shopifyClientSecret: form.shopifyClientSecret, shopifyToken: form.shopifyToken,
    metaToken: form.metaToken, metaAccounts: parseAccounts(form.metaAccounts),
    googleDeveloperToken: form.googleDeveloperToken, googleClientId: form.googleClientId, googleClientSecret: form.googleClientSecret,
    googleRefreshToken: form.googleRefreshToken, googleLoginCustomerId: form.googleLoginCustomerId, googleAccounts: parseAccounts(form.googleAccounts),
  });

  const save = async (): Promise<boolean> => {
    setSaving(true); setNotice(null);
    try {
      const { config: next } = await savePerformanceConfig(brandId, patch());
      onSaved(next);
      setForm((f) => ({ ...f, shopifyClientSecret: "", shopifyToken: "", metaToken: "", googleDeveloperToken: "", googleClientSecret: "", googleRefreshToken: "" }));
      setNotice({ kind: "ok", text: "Saved. Credentials are stored encrypted." });
      return true;
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      return false;
    } finally { setSaving(false); }
  };

  const test = async (source: "shopify" | "meta" | "google") => {
    setTesting(source);
    try {
      if (!(await save())) return; // test what's stored
      const { result } = await testPerformanceSource(brandId, source);
      setTests((t) => ({ ...t, [source]: result }));
    } catch (err) {
      setTests((t) => ({ ...t, [source]: { ok: false, error: err instanceof Error ? err.message : String(err) } }));
    } finally { setTesting(null); }
  };

  const syncNow = async (full: boolean) => {
    if (!(await save())) return;
    await startPerformanceSync(brandId, full);
    onSyncStarted();
  };

  const TestLine = ({ source }: { source: "shopify" | "meta" | "google" }) => {
    const r = tests[source];
    if (!r) return null;
    if (!r.ok) return <div className="mt-1.5 text-[10px] font-mono text-rose-400 break-words">{r.error}</div>;
    return (
      <div className="mt-1.5 text-[10px] font-mono text-emerald-400">
        ✓ connected{r.shop ? ` · ${r.shop}${r.currency ? ` (${r.currency})` : ""}` : ""}
        {r.accounts?.map((a) => <div key={a.id} className="text-white/50">{a.name} · {a.id} · {a.timezone}{a.currency ? ` · ${a.currency}` : ""}</div>)}
        {r.scopes && r.scopes.length > 0 && <div className="text-white/50 break-words">scopes: {r.scopes.join(", ")}</div>}
        {r.missingScopes && r.missingScopes.length > 0 && (
          <div className="text-amber-300">missing {r.missingScopes.join(", ")} — {r.missingScopes.some((x) => x === "read_products" || x === "read_inventory") ? "cost of goods can't be loaded, margin would show 100%" : "orders / customers can't be read"}. Add the scope on the app, release a new version, approve it on the store, test again.</div>
        )}
        {r.writeScopes && r.writeScopes.length > 0 && (
          <div className="text-amber-300">this app can also write ({r.writeScopes.join(", ")}). The dashboard never writes, but read-only is safer — remove the write_* scopes on the app.</div>
        )}
        {r.history && (r.history.olderCount === 0
          ? <div className="text-white/50">history: no orders older than 60 days on this store yet</div>
          : r.history.olderReachable
            ? <div className="text-white/50">history: full — {r.history.olderCount.toLocaleString()} orders older than 60 days are reachable</div>
            : <div className="text-amber-300">history: only the last 60 days of orders are reachable ({r.history.olderCount.toLocaleString()} older orders are hidden). Shopify limits apps created under a Partner account to 60 days. Create the app from the store's own organization instead, or request "Read all orders" in the Partner Dashboard and add read_all_orders to the app.</div>)}
        {r.history === null && <div className="text-white/50">history: could not check how far back orders are readable</div>}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-cyan-400/20 bg-[#0D0F12] p-5 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wide text-cyan-300/70 inline-flex items-center gap-2"><Plug size={12} /> Connect data sources</div>
          <p className="text-[11px] text-white/40 font-mono mt-1">Paste the credentials once. They are encrypted at rest and never shown again. All three connections are read-only — the dashboard only pulls numbers, it can't change anything in the shop or the ad accounts. Then switch Data source to Live and press Save &amp; sync now.</p>
          {!secretsKeySet && <p className="text-[11px] text-amber-300 font-mono mt-1">CONNECTIONS_KEY is missing in .env.local — credentials can't be saved until it is set (see docs/performance-dashboard.md).</p>}
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-white/35">Data source
            <select className={`${input} w-auto`} value={form.dataSource} onChange={set("dataSource")}>
              <option value="mock">Mock (generated)</option>
              <option value="live">Live (Shopify + ads)</option>
            </select>
          </label>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={saving}>{saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save</button>
        </div>
      </div>

      {notice && <div className={`text-[11px] font-mono ${notice.kind === "ok" ? "text-emerald-400" : "text-rose-400"}`}>{notice.text}</div>}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Shopify */}
        <section className="rounded-lg border border-white/[0.07] p-4 space-y-3">
          <div className="flex items-center justify-between"><div className="text-[11px] font-semibold text-white/85">Shopify · sales</div><StatusPill st={by("shopify")} /></div>
          <div><label htmlFor="shopDomain" className={label}>Shop domain</label><input id="shopDomain" className={input} value={form.shopifyShopDomain} onChange={set("shopifyShopDomain")} placeholder="brand.myshopify.com" /></div>
          <div><label htmlFor="shopClientId" className={label}>Client ID (Dev Dashboard app)</label><input id="shopClientId" className={input} value={form.shopifyClientId} onChange={set("shopifyClientId")} placeholder="from the app's Settings in dev.shopify.com" autoComplete="off" /></div>
          <SecretField id="shopClientSecret" name="Client secret (read-only scopes)" set={config.shopify.clientSecretSet} value={form.shopifyClientSecret} onChange={(v) => setForm((f) => ({ ...f, shopifyClientSecret: v }))} placeholder="shpss_…" />
          <p className="text-[10px] text-white/30 font-mono">dev.shopify.com → Create app → name it, leave the URLs as they are → Scopes: <span className="text-white/50">read_orders, read_customers, read_products, read_inventory</span> (nothing else, no write_*) → release the version → install it on the store (app and store in the same Shopify organization) → copy Client ID + Client secret from the app's Settings. Shopify shows no token any more: Inana swaps these for a 24-hour token itself and renews it once a day. Orders give revenue + new/returning customers; products + inventory give the unit costs for margin. Backfills from 1 Jan last year once, then polls only orders that changed.</p>
          <SecretField id="shopToken" name="Legacy access token (only for apps made in the admin before 2026)" set={config.shopify.tokenSet} value={form.shopifyToken} onChange={(v) => setForm((f) => ({ ...f, shopifyToken: v }))} placeholder="shpat_… — leave empty for a Dev Dashboard app" />
          <button type="button" className={btnGhost} onClick={() => void test("shopify")} disabled={testing !== null}>{testing === "shopify" ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Test connection</button>
          <TestLine source="shopify" />
        </section>

        {/* Meta */}
        <section className="rounded-lg border border-white/[0.07] p-4 space-y-3">
          <div className="flex items-center justify-between"><div className="text-[11px] font-semibold text-white/85">Meta · ad spend</div><StatusPill st={by("meta")} /></div>
          <SecretField id="metaToken" name="System-user token (ads_read only)" set={config.meta.tokenSet} value={form.metaToken} onChange={(v) => setForm((f) => ({ ...f, metaToken: v }))} placeholder="EAAB…" />
          <div><label htmlFor="metaAccounts" className={label}>Ad accounts → region</label><input id="metaAccounts" className={input} value={form.metaAccounts} onChange={set("metaAccounts")} placeholder="act_123:NLBE, act_456:UK" /></div>
          <p className="text-[10px] text-white/30 font-mono">Meta Business settings → Users → System users → Generate token: tick only <span className="text-white/50">ads_read</span>, assign the ad accounts, no expiry. Read-only — spend per hour per account, nothing else. Regions: NLBE, UK, USA, OTH. Incremental runs re-pull only the last 3 days.</p>
          <button type="button" className={btnGhost} onClick={() => void test("meta")} disabled={testing !== null}>{testing === "meta" ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Test connection</button>
          <TestLine source="meta" />
        </section>

        {/* Google */}
        <section className="rounded-lg border border-white/[0.07] p-4 space-y-3">
          <div className="flex items-center justify-between"><div className="text-[11px] font-semibold text-white/85">Google Ads · ad spend</div><StatusPill st={by("google")} /></div>
          <SecretField id="gDev" name="Developer token" set={config.google.developerTokenSet} value={form.googleDeveloperToken} onChange={(v) => setForm((f) => ({ ...f, googleDeveloperToken: v }))} />
          <div><label htmlFor="gClientId" className={label}>OAuth client id</label><input id="gClientId" className={input} value={form.googleClientId} onChange={set("googleClientId")} placeholder="….apps.googleusercontent.com" /></div>
          <SecretField id="gSecret" name="OAuth client secret" set={config.google.clientSecretSet} value={form.googleClientSecret} onChange={(v) => setForm((f) => ({ ...f, googleClientSecret: v }))} />
          <SecretField id="gRefresh" name="Refresh token" set={config.google.refreshTokenSet} value={form.googleRefreshToken} onChange={(v) => setForm((f) => ({ ...f, googleRefreshToken: v }))} />
          <div><label htmlFor="gMcc" className={label}>Login customer id (MCC, optional)</label><input id="gMcc" className={input} value={form.googleLoginCustomerId} onChange={set("googleLoginCustomerId")} placeholder="1234567890" /></div>
          <div><label htmlFor="gAccounts" className={label}>Customer ids → region</label><input id="gAccounts" className={input} value={form.googleAccounts} onChange={set("googleAccounts")} placeholder="1234567890:NLBE, 2345678901:UK" /></div>
          <p className="text-[10px] text-white/30 font-mono">Google Ads has one API scope for everything; the dashboard only runs read reports (cost per hour). Incremental runs re-pull only the last 3 days.</p>
          <button type="button" className={btnGhost} onClick={() => void test("google")} disabled={testing !== null}>{testing === "google" ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Test connection</button>
          <TestLine source="google" />
        </section>
      </div>

      {/* Definitions — defaults are right for almost every shop; margin is not an input (it comes from Shopify unit costs) */}
      <section className="rounded-lg border border-white/[0.07] p-4">
        <button type="button" className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/70 hover:text-white" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
          {advanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Advanced settings
          <span className="text-[10px] font-mono font-normal text-white/30 ml-2">new customer = {form.ncDefinition === "window_days" ? `first order in ${form.ncWindowDays} days` : "first-ever order"} · revenue = {form.revenueField === "subtotal" ? "subtotal" : "order total"} · sync every {form.syncEveryMinutes || "10"} min</span>
        </button>
        {advanced && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-3">
            <div><label htmlFor="ncd" className={label}>New customer =</label>
              <select id="ncd" className={input} value={form.ncDefinition} onChange={set("ncDefinition")}>
                <option value="first_ever">first-ever order (Shopify)</option>
                <option value="window_days">first order in N days</option>
              </select></div>
            <div><label htmlFor="ncw" className={label}>N days</label><input id="ncw" className={input} value={form.ncWindowDays} onChange={set("ncWindowDays")} disabled={form.ncDefinition !== "window_days"} /></div>
            <div><label htmlFor="rf" className={label}>Revenue =</label>
              <select id="rf" className={input} value={form.revenueField} onChange={set("revenueField")}>
                <option value="total">order total (incl. tax, shipping)</option>
                <option value="subtotal">subtotal (products after discounts)</option>
              </select></div>
            <div><label htmlFor="sem" className={label}>Sync every (min)</label><input id="sem" className={input} value={form.syncEveryMinutes} onChange={set("syncEveryMinutes")} /></div>
          </div>
        )}
      </section>

      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className={btnPrimary} onClick={() => void syncNow(false)} disabled={running || saving}>{running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {running ? "Syncing…" : "Save & sync now"}</button>
        <button type="button" className={btnGhost} onClick={() => { if (confirm("Delete all synced rows for this brand and backfill again from 1 Jan last year?")) void syncNow(true); }} disabled={running || saving}>Full re-sync</button>
        <span className="text-[10px] font-mono text-white/30">Sync runs in the background every {form.syncEveryMinutes || "10"} min while the source is Live — only changed orders and the last 3 days of spend, never the whole history. Refresh on the dashboard just re-reads the database.</span>
      </div>
    </div>
  );
}
