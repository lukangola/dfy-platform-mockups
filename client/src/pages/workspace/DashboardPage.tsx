/**
 * Jobs overview for the ACTIVE brand — a "Jump back in" hero for the first
 * running job (or the most recent one), then the remaining recent jobs as
 * divider-separated rows. Clicking a job deep-links into the source app with
 * ?job=<id>, which restores the full working session there.
 * Spec: docs/superpowers/specs/2026-07-08-generation-jobs-design.md
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, CheckCircle2, Clapperboard, Film, Image, ListOrdered, Loader2, MessageSquare, PenLine } from "lucide-react";
import { listJobs, type Job } from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";

const APP_META: Record<string, { label: string; icon: React.ElementType; path: string }> = {
  broll: { label: "B-Roll", icon: Film, path: "/workspace/apps/broll" },
  character_broll: { label: "Character B-Roll", icon: Clapperboard, path: "/workspace/apps/character-broll" },
  single_scene: { label: "Single Scene", icon: Film, path: "/workspace/apps/single-scene" },
  message_testing: { label: "Message Testing", icon: MessageSquare, path: "/workspace/apps/message-testing" },
  listicle: { label: "Listicle Builder", icon: ListOrdered, path: "/workspace/apps/listicle-builder" },
  copy_engine: { label: "Copy Engine", icon: PenLine, path: "/workspace/apps/copy-engine" },
  static_ads: { label: "Static Ads", icon: Image, path: "/workspace/apps/static-ads" },
};

function StatusChip({ job }: { job: Job }) {
  if (job.status === "queued" || job.status === "running") {
    return <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-cyan-300"><Loader2 size={11} className="animate-spin" /> RUNNING</span>;
  }
  if (job.status === "complete") {
    return <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-400"><CheckCircle2 size={11} /> DONE</span>;
  }
  if (job.status === "complete_with_errors") {
    return <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-amber-400"><AlertTriangle size={11} /> DONE · {job.errorCount} FAILED</span>;
  }
  return <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-rose-400"><AlertTriangle size={11} /> FAILED</span>;
}

/** "3m ago" style relative time for job rows. */
function relTime(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Product name snapshotted into the job payload, when the app provided one. */
function productName(job: Job): string | null {
  return (job.payload as { productName?: string | null })?.productName ?? null;
}

function isActive(job: Job): boolean {
  return job.status === "queued" || job.status === "running";
}

function progressPct(job: Job): number {
  return job.totalCount > 0 ? Math.round(((job.doneCount + job.errorCount) / job.totalCount) * 100) : 0;
}

function ProgressBar({ job }: { job: Job }) {
  return (
    <div className="mt-2 h-1 rounded bg-white/[0.06] overflow-hidden">
      <div className="h-full bg-cyan-400/70 transition-all" style={{ width: `${progressPct(job)}%` }} />
    </div>
  );
}

function HeroCard({ job }: { job: Job }) {
  const meta = APP_META[job.app] ?? APP_META.broll;
  const Icon = meta.icon;
  const product = productName(job);
  const active = isActive(job);
  return (
    <section>
      <h2 className="text-[11px] font-mono uppercase tracking-wide text-cyan-300/70 mb-2">Jump back in</h2>
      <div className="rounded-xl border border-cyan-400/20 bg-[#0D0F12] p-5 flex items-center gap-4">
        <div className="w-11 h-11 rounded-full bg-cyan-400/10 border border-cyan-400/20 flex items-center justify-center shrink-0">
          <Icon size={20} className="text-cyan-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-mono text-white/35">{meta.label}</div>
          <div className="text-base font-medium text-white/90 truncate">{job.title}</div>
          <div className="truncate text-[11px] font-mono text-white/40">
            {product && <>{product} · </>}
            {job.doneCount + job.errorCount}/{job.totalCount} items · {relTime(job.createdAt)} · <StatusChip job={job} />
          </div>
          {active && <ProgressBar job={job} />}
        </div>
        <Link href={`${meta.path}?job=${job.id}`}>
          <div className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/15 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-400/25 transition-colors cursor-pointer shrink-0">
            {active ? (<>Continue <ArrowRight size={14} /></>) : "Review"}
          </div>
        </Link>
      </div>
    </section>
  );
}

function JobRow({ job }: { job: Job }) {
  const meta = APP_META[job.app] ?? APP_META.broll;
  const Icon = meta.icon;
  const product = productName(job);
  return (
    <Link href={`${meta.path}?job=${job.id}`}>
      <div className="p-4 flex items-center gap-4 hover:bg-white/[0.02] cursor-pointer">
        <div className="w-9 h-9 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
          <Icon size={16} className="text-white/40" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-mono text-white/35">{meta.label}</div>
          <div className="text-sm font-medium text-white/85 truncate">{job.title}</div>
          <div className="truncate text-[11px] font-mono text-white/40">
            {product && <>{product} · </>}
            {job.doneCount + job.errorCount}/{job.totalCount} items
            {job.status === "failed" && job.error && <> · <span className="text-rose-400/80">{job.error}</span></>}
          </div>
          {isActive(job) && <ProgressBar job={job} />}
        </div>
        <div className="text-right shrink-0">
          <StatusChip job={job} />
          <div className="text-[11px] font-mono text-white/30 mt-1">{relTime(job.createdAt)}</div>
        </div>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const { activeBrandId } = useBrand();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll the brand's jobs every 5s — cheap (single indexed query, no items)
  // and keeps running rows' progress bars live without websockets.
  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { jobs: rows } = await listJobs(activeBrandId);
        if (!cancelled) { setJobs(rows); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    const t = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [activeBrandId]);

  if (!activeBrandId) {
    return <div className="p-8 text-sm text-white/35">Select a brand to see its jobs.</div>;
  }

  // Server orders running/queued first, then newest — so the first active job
  // (or failing that, the newest job overall) is the "jump back in" hero.
  const hero = jobs?.find(isActive) ?? jobs?.[0] ?? null;
  const rest = hero ? (jobs ?? []).filter((j) => j.id !== hero.id) : [];

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold text-white/90 mb-1">Dashboard</h1>
      <p className="text-xs text-white/40 font-mono mb-6">Generation jobs for this brand — running batches keep going even if you close the tab.</p>
      {error && <div className="text-xs text-rose-400 font-mono mb-4">{error}</div>}
      {jobs === null ? (
        <div className="flex items-center gap-2 text-white/40 text-sm"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : jobs.length === 0 || !hero ? (
        <div className="py-16 text-center text-sm text-white/35">No jobs yet — start a generation in any app and it will show up here.</div>
      ) : (
        <div className="space-y-8">
          <HeroCard job={hero} />
          {rest.length > 0 && (
            <section>
              <h2 className="text-[11px] font-mono uppercase tracking-wide text-cyan-300/70 mb-2">Recent</h2>
              <div className="rounded-xl border border-white/[0.07] bg-[#0D0F12] divide-y divide-white/[0.06] overflow-hidden">
                {rest.map((job) => <JobRow key={job.id} job={job} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
