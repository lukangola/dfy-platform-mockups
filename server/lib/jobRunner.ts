/**
 * Durable generation job runner.
 * Spec: docs/superpowers/specs/2026-07-08-generation-jobs-design.md
 *
 * Jobs are DB rows (schema.jobs / schema.jobItems). Apps create a job via
 * POST /api/jobs; kickJob() claims it and processes items in-process with a
 * small pool, persisting EVERY transition so a deploy/crash can resume from
 * the DB (sweepOrphanedJobs at boot). Executors are registered per job type
 * and perform exactly ONE item.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db.js";
import { formatError } from "./formatError.js";

export type JobErrorClass = "transient" | "likeness" | "hard";

/**
 * transient → provider hiccup (retry with backoff)
 * likeness  → Seedance content policy refusing real-person likenesses /
 *             content-checker flags (fallback to Kling for video items)
 * hard      → real validation/permanent error (fail the item)
 */
export function classifyJobError(status: number | undefined, message: string): JobErrorClass {
  // Broader than fal.ts's isTransientGenerationRefusal on purpose: that one
  // targets ONLY the 422 "model flaked on valid input" case; this classifier
  // covers the whole transient-provider surface (5xx/429/network) for job
  // items, where a bounded re-run is always safe.
  if (status !== undefined && (status >= 500 || status === 429)) return "transient";
  if (/gateway|timeout|unavailable|econnreset|econnrefused|fetch failed|socket hang up/i.test(message)) {
    return "transient";
  }
  if (status === 422 && SEEDANCE_LIKENESS_RE.test(message)) {
    return "likeness";
  }
  return "hard";
}

/**
 * Signatures of a Seedance content-checker refusal, in every phrasing fal has
 * surfaced for it.
 *
 * The last two matter because of a real incident (Puzzle Makeup, 10–16 July
 * 2026): 12 b-roll videos failed and the Kling fallback never fired. The
 * reference images were hand/fingertip shots, which ByteDance's validator
 * rejects as "likenesses of real people" — exactly the case this fallback
 * exists for. But fal reported it only by its DOWNSTREAM SYMPTOM:
 *
 *   "Invalid reference index 1 for image. Only 0 images provided."
 *
 * i.e. the rejected images were dropped from the payload, so the prompt's
 * `@Image1` marker then pointed at an empty list. That message matches none of
 * the likeness words, so the items were classified `hard` and simply died.
 * fal has since improved the message to name the real reason
 * ("...may contain likenesses of real people...", type
 * `content_policy_violation`, reason `partner_validation_failed`), but we match
 * BOTH phrasings so a provider-side wording change can never silently disable
 * the fallback again.
 *
 * Safe on false positives: if a prompt ever genuinely over-references (e.g.
 * `@Image3` with two images), routing to Kling yields a usable clip from the
 * first frame instead of a dead item — and the fallback is logged either way.
 */
const SEEDANCE_LIKENESS_RE =
  /likeness|real people|private information|content checker|flagged by a content|content[_ ]?policy|partner_validation_failed|invalid reference index|only 0 images provided/i;

/**
 * Map a Seedance reference-to-video input to Kling v3 image-to-video for the
 * likeness fallback. Kling takes ONE image_url (the starting frame — always
 * the first Seedance reference) and has no generate_audio/resolution knobs.
 * The @ImageN references in the prompt are Seedance syntax; Kling ignores
 * them harmlessly. Returns null when no starting frame exists.
 */
export function seedanceToKlingFallback(
  falInput: Record<string, unknown>,
): { model: string; input: Record<string, unknown> } | null {
  const urls = Array.isArray(falInput.image_urls) ? (falInput.image_urls as string[]) : [];
  const first = urls[0];
  if (!first) return null;
  return {
    model: "fal-ai/kling-video/v3/standard/image-to-video",
    input: {
      prompt: falInput.prompt,
      image_url: first,
      duration: falInput.duration ?? "5",
      aspect_ratio: falInput.aspect_ratio ?? "9:16",
    },
  };
}

// ── Registry ────────────────────────────────────────────────────────────────

export type JobExecutor = (args: {
  item: typeof schema.jobItems.$inferSelect;
  payload: Record<string, unknown>;
}) => Promise<Record<string, unknown>>; // resolved output jsonb (e.g. { url, model, durationMs })

const registry = new Map<string, JobExecutor>();

export function registerJobType(type: string, executor: JobExecutor): void {
  registry.set(type, executor);
}

export function isRegisteredJobType(type: string): boolean {
  return registry.has(type);
}

// ── Runner ──────────────────────────────────────────────────────────────────

const ITEM_CONCURRENCY = 3;
const MAX_TRANSIENT_ATTEMPTS = 3; // first try + 2 retries
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** In-process guard so the same node doesn't run one job twice concurrently. */
const inFlight = new Set<string>();

/** Fire-and-forget: claim the job and process it in the background. */
export function kickJob(jobId: string): void {
  if (inFlight.has(jobId)) return;
  inFlight.add(jobId);
  void runJob(jobId)
    .catch((err) => console.error(`[jobs] runJob ${jobId} crashed:`, err))
    .finally(() => {
      inFlight.delete(jobId);
      // Self-heal the retry race: if someone re-queued this job while we were
      // finishing (their kick was swallowed by the inFlight guard above),
      // pick it up now. The boot sweep remains the real backstop — this only
      // shortens the latency when the process stays up.
      void (async () => {
        const rows = await db
          .select({ status: schema.jobs.status })
          .from(schema.jobs)
          .where(eq(schema.jobs.id, jobId))
          .limit(1);
        if (rows[0]?.status === "queued") kickJob(jobId);
      })().catch(() => {});
    });
}

async function runJob(jobId: string): Promise<void> {
  // Guarded claim — safe if a second instance ever runs this code.
  const claimed = await db
    .update(schema.jobs)
    .set({ status: "running", updatedAt: new Date() })
    .where(and(eq(schema.jobs.id, jobId), inArray(schema.jobs.status, ["queued", "running"])))
    .returning({ id: schema.jobs.id, type: schema.jobs.type, payload: schema.jobs.payload });
  const job = claimed[0];
  if (!job) return; // already terminal or gone
  const executor = registry.get(job.type);
  if (!executor) {
    console.error(`[jobs] ${jobId} has no registered executor for type "${job.type}" — check the boot-time jobExecutors import`);
    await db
      .update(schema.jobs)
      .set({ status: "failed", error: `No executor registered for job type "${job.type}"`, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.jobs.id, jobId));
    return;
  }
  const payload = (job.payload ?? {}) as Record<string, unknown>;

  const pending = await db
    .select()
    .from(schema.jobItems)
    .where(and(eq(schema.jobItems.jobId, jobId), inArray(schema.jobItems.status, ["pending", "running"])))
    .orderBy(asc(schema.jobItems.idx));

  // Small pool — chunked like the codebase's mapPool idiom (adConsoleOrganic.ts).
  for (let i = 0; i < pending.length; i += ITEM_CONCURRENCY) {
    await Promise.all(pending.slice(i, i + ITEM_CONCURRENCY).map((item) => runItem(item, payload, executor)));
  }

  // Finalize from authoritative item states.
  const items = await db.select().from(schema.jobItems).where(eq(schema.jobItems.jobId, jobId));
  const done = items.filter((it) => it.status === "complete").length;
  const errs = items.filter((it) => it.status === "failed").length;
  await db
    .update(schema.jobs)
    .set({
      status: errs === 0 ? "complete" : done > 0 ? "complete_with_errors" : "failed",
      doneCount: done,
      errorCount: errs,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, "running")));
  console.log(`[jobs] ${jobId} finished: ${done} ok, ${errs} failed of ${items.length}`);
}

async function runItem(
  item: typeof schema.jobItems.$inferSelect,
  payload: Record<string, unknown>,
  executor: JobExecutor,
): Promise<void> {
  let attempts = item.attempts;
  const startedAt = item.startedAt ?? new Date();
  // The only exit paths are the returns below — the attempts guard in the catch is what bounds this loop.
  for (;;) {
    attempts++;
    await db
      .update(schema.jobItems)
      .set({ status: "running", attempts, startedAt, error: null })
      .where(eq(schema.jobItems.id, item.id));
    try {
      const output = await executor({ item: { ...item, attempts }, payload });
      await db
        .update(schema.jobItems)
        .set({ status: "complete", output, finishedAt: new Date() })
        .where(eq(schema.jobItems.id, item.id));
      await bumpJobCounters(item.jobId);
      return;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const msg = formatError(err);
      const cls = classifyJobError(status, msg);
      if (cls === "transient" && attempts < MAX_TRANSIENT_ATTEMPTS) {
        console.warn(`[jobs] item ${item.id} transient error (attempt ${attempts}/${MAX_TRANSIENT_ATTEMPTS}), retrying: ${msg.slice(0, 120)}`);
        await sleep(2000 * attempts);
        continue;
      }
      // "likeness" is handled INSIDE the video executor (model fallback);
      // if it still reaches here the fallback also failed → fail the item.
      await db
        .update(schema.jobItems)
        .set({ status: "failed", error: msg, finishedAt: new Date() })
        .where(eq(schema.jobItems.id, item.id));
      await bumpJobCounters(item.jobId);
      return;
    }
  }
}

/** Denormalized progress so the dashboard/badge query never joins items. */
async function bumpJobCounters(jobId: string): Promise<void> {
  const items = await db
    .select({ status: schema.jobItems.status })
    .from(schema.jobItems)
    .where(eq(schema.jobItems.jobId, jobId));
  await db
    .update(schema.jobs)
    .set({
      doneCount: items.filter((it) => it.status === "complete").length,
      errorCount: items.filter((it) => it.status === "failed").length,
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, jobId));
}

// ── Boot sweep ──────────────────────────────────────────────────────────────

/**
 * Resume jobs orphaned by a restart. Production resumes (items already
 * complete are skipped — idempotent); dev marks them failed (tsx watch
 * restarts on every save — same precedent as the research sweep).
 */
export async function sweepOrphanedJobs(opts: { resume: boolean }): Promise<{ resumed: number; failed: number }> {
  const orphans = await db
    .select({ id: schema.jobs.id, title: schema.jobs.title })
    .from(schema.jobs)
    .where(inArray(schema.jobs.status, ["queued", "running"]));
  if (orphans.length === 0) return { resumed: 0, failed: 0 };
  if (!opts.resume) {
    for (const j of orphans) {
      await db
        .update(schema.jobs)
        .set({ status: "failed", error: "Interrupted by a dev server restart.", finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.jobs.id, j.id));
    }
    return { resumed: 0, failed: orphans.length };
  }
  for (const j of orphans) {
    console.log(`[jobs] boot sweep: resuming "${j.title}" (${j.id})`);
    kickJob(j.id);
  }
  return { resumed: orphans.length, failed: 0 };
}
