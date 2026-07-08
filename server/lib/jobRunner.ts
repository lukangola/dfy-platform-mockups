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

export type JobErrorClass = "transient" | "likeness" | "hard";

/**
 * transient → provider hiccup (retry with backoff)
 * likeness  → Seedance content policy refusing real-person likenesses /
 *             content-checker flags (fallback to Kling for video items)
 * hard      → real validation/permanent error (fail the item)
 */
export function classifyJobError(status: number | undefined, message: string): JobErrorClass {
  if (status !== undefined && (status >= 500 || status === 429)) return "transient";
  if (/gateway|timeout|unavailable|econnreset|econnrefused|fetch failed|socket hang up/i.test(message)) {
    return "transient";
  }
  if (
    status === 422 &&
    /likeness|real people|private information|content checker|flagged by a content/i.test(message)
  ) {
    return "likeness";
  }
  return "hard";
}

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
