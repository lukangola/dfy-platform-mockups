/**
 * Jobs overview for the ACTIVE brand — a "Jump back in" hero for the first
 * running job (or the most recent one), then the remaining recent jobs as
 * divider-separated rows. Clicking a job deep-links into the source app with
 * ?job=<id>, which restores the full working session there.
 * Spec: docs/superpowers/specs/2026-07-08-generation-jobs-design.md
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Clapperboard, Film, Image, ListOrdered, Loader2, MessageSquare, PenLine } from "lucide-react";
import { listJobs, type Job } from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";

/**
 * Per-app metadata. `stages` names the APP PROCESS steps (not job statuses);
 * `stageIndexForType` maps a job's `type` to the stage that job executes.
 * A job's status only describes its own batch — a DONE image batch does not
 * mean the process is done (videos haven't started) — so the dashboard shows
 * the process stage separately; see processStage().
 */
const APP_META: Record<string, { label: string; icon: React.ElementType; path: string; stages: string[]; stageIndexForType: Record<string, number> }> = {
  broll: { label: "B-Roll", icon: Film, path: "/workspace/apps/broll", stages: ["Shots", "Images", "Videos"], stageIndexForType: { broll_images: 1, broll_videos: 2 } },
  character_broll: { label: "Character B-Roll", icon: Clapperboard, path: "/workspace/apps/character-broll", stages: ["Shots", "Images", "Videos"], stageIndexForType: { character_broll_images: 1, character_broll_videos: 2 } },
  single_scene: { label: "Single Scene", icon: Film, path: "/workspace/apps/single-scene", stages: ["Scenes", "Images", "Videos"], stageIndexForType: { single_scene_images: 1, single_scene_videos: 2 } },
  message_testing: { label: "Message Testing", icon: MessageSquare, path: "/workspace/apps/message-testing", stages: ["Messages", "Template", "Ads"], stageIndexForType: { message_testing_images: 2 } },
  listicle: { label: "Listicle Builder", icon: ListOrdered, path: "/workspace/apps/listicle-builder", stages: ["Copy", "Images", "Render", "Deploy"], stageIndexForType: {} },
  copy_engine: { label: "Copy Engine", icon: PenLine, path: "/workspace/apps/copy-engine", stages: ["Setup", "Copy"], stageIndexForType: { copy_engine_text: 1 } },
  static_ads: { label: "Static Ads", icon: Image, path: "/workspace/apps/static-ads", stages: ["Select", "Recreate", "Review"], stageIndexForType: { static_ads_recreate: 1 } },
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

/** Pipeline stage for listicle projections (payload.stage, e.g. "images"). */
function jobStage(job: Job): string | null {
  const stage = (job.payload as { stage?: string })?.stage;
  return typeof stage === "string" && stage ? stage : null;
}

/**
 * "product · 7/11 items" meta line. The item counts are hidden when a
 * listicle has no image rows yet (totalCount 0 would render a meaningless
 * "0/0 items"). The listicle pipeline stage now renders as the StageStrip
 * instead of inline text here.
 */
function metaLine(job: Job): string {
  const showCounts = job.totalCount > 0 || !jobStage(job);
  return [
    productName(job),
    showCounts ? `${job.doneCount + job.errorCount}/${job.totalCount} items` : null,
  ].filter(Boolean).join(" · ");
}

/** listicles.status (mirrored into payload.stage) → index into the listicle
 *  stages ["Copy", "Images", "Render", "Deploy"]. "failed" carries no
 *  positional info (the row loses its stage), so it is deliberately absent —
 *  processStage() returns null and no strip renders for failed listicles. */
const LISTICLE_STAGE_INDEX: Record<string, number> = {
  drafting: 0,
  analyzing: 0,
  images: 1,
  rendering: 2,
  ready: 3,
  deployed: 3,
};

/**
 * Where the APP PROCESS stands, derived from this job. Rules:
 * - listicle: payload.stage is authoritative (the projection's own status
 *   machine already tracks the whole pipeline) — no terminal-advance.
 * - other apps: the job's type pins the stage it executes; while
 *   queued/running (or failed — stuck) the process sits at that stage, and
 *   when the job finishes (complete/complete_with_errors) the process
 *   ADVANCES to the next stage if one exists ("images done → you're at
 *   Videos" — the job being DONE must not read as the process being done).
 * - processComplete: the finished job WAS the last stage (or listicle
 *   reached ready/deployed) — every stage renders checked.
 * Returns null for unknown apps/types (render nothing — graceful).
 */
function processStage(job: Job): { stages: string[]; current: number; processComplete: boolean } | null {
  const meta = APP_META[job.app];
  if (!meta) return null;
  if (job.app === "listicle") {
    const stage = jobStage(job);
    const idx = stage ? LISTICLE_STAGE_INDEX[stage] : undefined;
    if (idx === undefined) return null;
    // "ready" sits AT the Deploy stage but hasn't shipped — the process only
    // completes on "deployed", so a ready listicle offers "Review & Continue".
    return { stages: meta.stages, current: idx, processComplete: stage === "deployed" };
  }
  const typeIndex = meta.stageIndexForType[job.type];
  if (typeIndex === undefined) return null;
  const terminal = job.status === "complete" || job.status === "complete_with_errors";
  const current = terminal ? Math.min(typeIndex + 1, meta.stages.length - 1) : typeIndex;
  return { stages: meta.stages, current, processComplete: terminal && typeIndex === meta.stages.length - 1 };
}

/**
 * Compact one-line process visualization: checked past stages, a cyan pill
 * for the current one (dot pulses only while the job is actually running),
 * dimmed future stages. When the process is complete every stage is checked.
 */
function StageStrip({ stages, current, processComplete, running }: { stages: string[]; current: number; processComplete: boolean; running: boolean }) {
  return (
    <div className="mt-1 flex items-center gap-1 text-[10px] font-mono whitespace-nowrap overflow-hidden">
      {stages.map((name, i) => {
        const done = processComplete || i < current;
        return (
          <span key={name} className="inline-flex items-center gap-1">
            {i > 0 && <span className="text-white/20">›</span>}
            {done ? (
              <span className="inline-flex items-center gap-0.5 text-white/45"><Check size={9} /> {name}</span>
            ) : i === current ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/15 px-1.5 text-cyan-300">
                <span className={running ? "animate-pulse" : undefined}>●</span> {name}
              </span>
            ) : (
              <span className="text-white/25">○ {name}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Deep-link target. Listicle builds are read-only projections (id
 * "listicle-<uuid>", no jobs row) — they reopen in the Listicle Builder via
 * ?listicle=<id>. Real jobs restore their session via ?job=<id>.
 */
function jobHref(job: Job): string {
  const meta = APP_META[job.app] ?? APP_META.broll;
  const listicleId = (job.payload as { listicleId?: string })?.listicleId;
  // Abandoned mid-pipeline listicles project as RUNNING until 20 newer ones
  // push them out — accepted v1 semantics.
  if (job.app === "listicle" && listicleId) return `${meta.path}?listicle=${listicleId}`;
  return `${meta.path}?job=${job.id}`;
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
  const active = isActive(job);
  const stage = processStage(job);
  const terminal = job.status === "complete" || job.status === "complete_with_errors";
  // "Review & Continue" only when the job finished but the process didn't —
  // there is a next stage to move into. Failed jobs and finished last stages
  // stay plain "Review".
  const reviewAndContinue = terminal && stage !== null && !stage.processComplete;
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
            {[metaLine(job), relTime(job.createdAt)].filter(Boolean).join(" · ")} · <StatusChip job={job} />
          </div>
          {stage && <StageStrip {...stage} running={active} />}
          {active && <ProgressBar job={job} />}
        </div>
        <Link href={jobHref(job)}>
          <div className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/15 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-400/25 transition-colors cursor-pointer shrink-0">
            {active ? (<>Continue <ArrowRight size={14} /></>)
              : reviewAndContinue ? (<>Review &amp; Continue <ArrowRight size={14} /></>)
              : "Review"}
          </div>
        </Link>
      </div>
    </section>
  );
}

function JobRow({ job }: { job: Job }) {
  const meta = APP_META[job.app] ?? APP_META.broll;
  const Icon = meta.icon;
  const active = isActive(job);
  const stage = processStage(job);
  return (
    <Link href={jobHref(job)}>
      <div className="p-4 flex items-center gap-4 hover:bg-white/[0.02] cursor-pointer">
        <div className="w-9 h-9 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
          <Icon size={16} className="text-white/40" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-mono text-white/35">{meta.label}</div>
          <div className="text-sm font-medium text-white/85 truncate">{job.title}</div>
          <div className="truncate text-[11px] font-mono text-white/40">
            {metaLine(job)}
            {job.status === "failed" && job.error && <>{metaLine(job) && " · "}<span className="text-rose-400/80">{job.error}</span></>}
          </div>
          {stage && <StageStrip {...stage} running={active} />}
          {active && <ProgressBar job={job} />}
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
