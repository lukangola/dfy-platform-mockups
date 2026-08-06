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
 * surfaced for it — including the structured fields fal added later
 * (`content_policy_violation` / `partner_validation_failed`), so a provider
 * wording change can't silently disable the fallback.
 *
 * Deliberately does NOT match "invalid reference index" / "only 0 images
 * provided": that is an `input_value_error` from KLING rejecting a prompt that
 * still carries Seedance's `@ImageN` markers — a bug in our own mapping, not a
 * content refusal. Classifying it as `likeness` would route a genuine input
 * error into the fallback and hide the very failure we need to see.
 */
const SEEDANCE_LIKENESS_RE =
  /likeness|real people|private information|content checker|flagged by a content|content[_ ]?policy|partner_validation_failed/i;

/**
 * Rewrite Seedance's `@ImageN` reference markers into plain prose.
 *
 * Kling does NOT ignore these markers — it parses them, finds no image list
 * (it takes a single `image_url`, not `image_urls`) and rejects the whole call:
 *
 *   422 input_value_error — "Invalid reference index 1 for image.
 *                            Only 0 images provided."
 *
 * That is the error Puzzle Makeup actually saw on all 12 clips: Seedance
 * refused their hand shots on content policy, the fallback fired correctly, and
 * then KLING died on the un-rewritten prompt in ~2s. Because the fallback's
 * error is what gets stored, the failure masqueraded as a Seedance problem.
 * Every likeness fallback in the b-roll pipeline hit this, since those prompts
 * always carry `@ImageN` markers.
 */
export function stripSeedanceImageMarkers(prompt: string, hasElements = false): string {
  return prompt
    // @Image1 is Seedance's START FRAME. Kling passes that as start_image_url
    // and has no marker for it, so it becomes plain prose.
    .replace(/@Image\s*1\b/gi, "the starting frame")
    // @Image2+ are Seedance's extra reference images (product packshots). Kling
    // carries those in `elements` and addresses them as @Element1 — so when we
    // attach elements, keep the reference; when we don't, degrade to prose
    // (an unresolvable @Element1 would 422 exactly like @Image1 did).
    .replace(/@Image\s*\d+/gi, hasElements ? "@Element1" : "the product")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Map a Seedance reference-to-video input onto Kling v3 image-to-video for the
 * likeness fallback, preserving BOTH kinds of reference Seedance carries:
 *
 *   Seedance                          Kling v3
 *   ─────────────────────────────     ───────────────────────────────────────
 *   image_urls[0]      (@Image1)  →   start_image_url          (the frame)
 *   image_urls[1..]    (@Image2+) →   elements[0].reference_image_urls
 *                                     + frontal_image_url      (@Element1)
 *
 * Kling is NOT a single-image model — `elements` is exactly how Character
 * B-roll and Single Scene already anchor product fidelity in production (see
 * prompts/character_broll_video_prompts.md, which addresses the bundle as
 * `@Element1`). An earlier version of this mapping dropped image_urls[1..]
 * entirely, so fallback clips lost their product anchor and had nothing but the
 * start frame holding the label/proportions steady across the shot.
 *
 * All extra references become ONE element (a multi-angle bundle of the same
 * object) because that matches how the product refs are collected upstream and
 * how the `@Element1` convention is written. Returns null with no start frame.
 */
export function seedanceToKlingFallback(
  falInput: Record<string, unknown>,
): { model: string; input: Record<string, unknown> } | null {
  const urls = Array.isArray(falInput.image_urls) ? (falInput.image_urls as string[]) : [];
  const [start, ...refs] = urls;
  if (!start) return null;
  const hasElements = refs.length > 0;
  const prompt =
    typeof falInput.prompt === "string"
      ? stripSeedanceImageMarkers(falInput.prompt, hasElements)
      : falInput.prompt;

  const input: Record<string, unknown> = {
    prompt,
    start_image_url: start,
    duration: falInput.duration ?? "5",
    aspect_ratio: falInput.aspect_ratio ?? "9:16",
    // We never use Kling's audio track, and disabling it drops the standard
    // tier from $0.126/s to $0.084/s (~33%) — same rationale as the other apps.
    generate_audio: false,
  };
  if (hasElements) {
    input.elements = [{ reference_image_urls: refs, frontal_image_url: refs[0] }];
  }
  return { model: "fal-ai/kling-video/v3/standard/image-to-video", input };
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
