/**
 * Jobs overview for the ACTIVE brand — running batches first with live
 * progress, then recent finished/failed. Clicking a job deep-links into the
 * source app with ?job=<id>, which restores the full working session there.
 * Spec: docs/superpowers/specs/2026-07-08-generation-jobs-design.md
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, Clapperboard, Clock, Film, ListOrdered, Loader2, MessageSquare, PenLine } from "lucide-react";
import { listJobs, type Job } from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";

const APP_META: Record<string, { label: string; icon: React.ElementType; path: string }> = {
  broll: { label: "B-Roll", icon: Film, path: "/workspace/apps/broll" },
  character_broll: { label: "Character B-Roll", icon: Clapperboard, path: "/workspace/apps/character-broll" },
  single_scene: { label: "Single Scene", icon: Film, path: "/workspace/apps/single-scene" },
  message_testing: { label: "Message Testing", icon: MessageSquare, path: "/workspace/apps/message-testing" },
  listicle: { label: "Listicle Builder", icon: ListOrdered, path: "/workspace/apps/listicle-builder" },
  copy_engine: { label: "Copy Engine", icon: PenLine, path: "/workspace/apps/copy-engine" },
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

  const running = (jobs ?? []).filter((j) => j.status === "queued" || j.status === "running");
  const finished = (jobs ?? []).filter((j) => j.status !== "queued" && j.status !== "running");

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-lg font-semibold text-white/90 mb-1">Dashboard</h1>
      <p className="text-xs text-white/40 font-mono mb-6">Generation jobs for this brand — running batches keep going even if you close the tab.</p>
      {error && <div className="text-xs text-rose-400 font-mono mb-4">{error}</div>}
      {jobs === null ? (
        <div className="flex items-center gap-2 text-white/40 text-sm"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : jobs.length === 0 ? (
        <div className="text-sm text-white/35">No jobs yet — start a generation in any app and it will show up here.</div>
      ) : (
        <div className="space-y-6">
          {[{ title: "Running", rows: running }, { title: "Recent", rows: finished }].map(({ title, rows }) =>
            rows.length === 0 ? null : (
              <section key={title}>
                <h2 className="text-[11px] font-mono uppercase tracking-wide text-white/35 mb-2">{title}</h2>
                <div className="space-y-2">
                  {rows.map((job) => {
                    const meta = APP_META[job.app] ?? APP_META.broll;
                    const Icon = meta.icon;
                    const pct = job.totalCount > 0 ? Math.round(((job.doneCount + job.errorCount) / job.totalCount) * 100) : 0;
                    return (
                      <Link key={job.id} href={`${meta.path}?job=${job.id}`}>
                        <div className="block rounded-lg border border-white/[0.07] bg-[#0D0F12] hover:border-white/20 transition-colors p-3 cursor-pointer">
                          <div className="flex items-center gap-3">
                            <Icon size={16} className="text-white/40 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm text-white/85">{job.title}</div>
                              <div className="text-[11px] font-mono text-white/35">{meta.label} · {job.doneCount + job.errorCount}/{job.totalCount} · <Clock size={9} className="inline -mt-0.5" /> {relTime(job.createdAt)}</div>
                            </div>
                            <StatusChip job={job} />
                          </div>
                          {(job.status === "queued" || job.status === "running") && (
                            <div className="mt-2 h-1 rounded bg-white/[0.06] overflow-hidden">
                              <div className="h-full bg-cyan-400/70 transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ),
          )}
        </div>
      )}
    </div>
  );
}
