/**
 * Factory-built executors for the media-generation job types: standard B-roll,
 * Character B-roll, Single Scene, and Message Testing. Each executor call
 * processes exactly ONE item: item.input = { shotId, kind, model, falInput }.
 *
 * makeImageExecutor(action) / makeVideoExecutor(action, opts) share one body
 * per kind; `action` is the per-app generations accounting label and MUST
 * match what the app's client page passes to the legacy /api/generate path
 * (e.g. "character_broll_image", "message_ad") so accounting labels stay
 * continuous when an app moves from direct calls to durable jobs.
 *
 * Generations accounting: the legacy path logged model calls via the
 * /api/generate route; jobs call fal directly (generateImage/generateVideo),
 * so each executor writes its own generations row here — cost/accounting
 * stays complete without HTTP self-calls.
 *
 * VIDEO MODEL (all apps, since 2026-08-05): Kling v3 standard. Standard b-roll
 * was the last holdout on Seedance 2.0; it moved because Seedance refuses
 * hand- and face-led reference images on content policy (422 "likenesses of
 * real people" / content-checker), which is most of what a UGC-style ad b-roll
 * IS, while Kling renders them and matches Seedance's multi-reference support
 * through `elements`/@Element1. One model everywhere — no per-brand routing.
 *
 * `opts.klingPrimary` adapts a stored Seedance-shaped payload (image_urls +
 * @ImageN) onto Kling at execution time, so jobs queued before the switch run
 * on Kling too. `opts.seedanceKlingFallback` is the old likeness escape hatch;
 * it is now false everywhere (nothing renders on Seedance, so there is no
 * alternate provider) and is kept only as the rollback path — flipping
 * klingPrimary off restores Seedance-primary + Kling-on-refusal.
 */
import { db, schema } from "../db.js";
import { generateImage, generateVideo } from "../fal.js";
import { formatError } from "../formatError.js";
import {
  classifyJobError,
  registerJobType,
  seedanceToKlingFallback,
  type JobExecutor,
} from "../jobRunner.js";

type MediaItemInput = { model?: string; falInput?: Record<string, unknown> };

/**
 * Foot-gun (accepted v1 trade-off, kept visible on purpose): this insert runs
 * AFTER a successful render. If it throws, the executor throws and the
 * runner classifies the DB error via classifyJobError — most DB failures are
 * classified hard (no retry), and the item fails with the already-rendered
 * fal URL lost with it. Exception: connection-class errors (e.g.
 * ECONNREFUSED, if the DB is briefly unreachable) match the same transient
 * regex used for provider hiccups, so those WILL be retried — meaning a
 * successful render can get silently re-rendered at extra cost before the
 * item finally fails. Swallowing the error would silently break cost
 * accounting, so we choose the loud (if occasionally expensive) failure.
 */
async function logGeneration(args: {
  action: string;
  kind: "image" | "video";
  inputs: Record<string, unknown>;
  output: Record<string, unknown> | null;
  model: string;
  durationMs: number;
  error?: string;
}): Promise<string | null> {
  const [row] = await db
    .insert(schema.generations)
    .values({
      action: args.action,
      kind: args.kind,
      inputs: args.inputs,
      output: args.output,
      model: args.model,
      error: args.error ?? null,
      durationMs: args.durationMs,
    })
    .returning({ id: schema.generations.id });
  return row?.id ?? null;
}

export function makeImageExecutor(action: string): JobExecutor {
  return async ({ item }) => {
    const input = (item.input ?? {}) as MediaItemInput;
    if (!input.falInput) throw new Error("item.input.falInput missing");
    const result = await generateImage({ model: input.model, input: input.falInput });
    const url = result.urls[0];
    const generationId = await logGeneration({
      action,
      kind: "image",
      inputs: { jobItemId: item.id, input: input.falInput },
      output: { urls: result.urls },
      model: result.model,
      durationMs: result.durationMs,
    });
    if (!url) throw new Error("No image URL returned");
    return { url, model: result.model, durationMs: result.durationMs, generationId };
  };
}

export function makeVideoExecutor(
  action: string,
  opts: { seedanceKlingFallback: boolean; klingPrimary?: boolean },
): JobExecutor {
  return async ({ item }) => {
    const input = (item.input ?? {}) as MediaItemInput;
    if (!input.falInput) throw new Error("item.input.falInput missing");
    let primaryModel = input.model ?? "bytedance/seedance-2.0/fast/reference-to-video";
    let falInput = input.falInput;

    // KLING-PRIMARY (b-roll, since 2026-08-05). The b-roll payload carries its
    // reference set in Seedance's shape — `image_urls` cited as @ImageN — which
    // is also what every previously-stored job holds. Adapting it here (rather
    // than at the call site) keeps ONE copy of the mapping and means queued and
    // resumed jobs from before the switch run on Kling too, instead of silently
    // taking the old Seedance path.
    //
    // Seedance is not used for video anywhere now: it refuses hand- and
    // face-led shots on content policy, and Kling matches it on multi-reference
    // via `elements`. Rollback = drop klingPrimary from the registration below.
    if (opts.klingPrimary && Array.isArray((falInput as Record<string, unknown>).image_urls)) {
      const mapped = seedanceToKlingFallback(falInput);
      if (mapped) {
        primaryModel = mapped.model;
        falInput = mapped.input;
      }
    }

    try {
      const result = await generateVideo({ model: primaryModel, input: falInput });
      const url = result.urls[0];
      const generationId = await logGeneration({
        action,
        kind: "video",
        inputs: { jobItemId: item.id, input: falInput },
        output: { urls: result.urls },
        model: result.model,
        durationMs: result.durationMs,
      });
      if (!url) throw new Error("No video URL returned");
      return { url, model: result.model, durationMs: result.durationMs, generationId };
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const msg = formatError(err);
      if (!opts.seedanceKlingFallback || classifyJobError(status, msg) !== "likeness") throw err;
      const fallback = seedanceToKlingFallback(input.falInput);
      if (!fallback) throw err;
      console.warn(`[jobs] item ${item.id}: seedance likeness refusal — falling back to kling`);
      const result = await generateVideo({ model: fallback.model, input: fallback.input });
      const url = result.urls[0];
      const generationId = await logGeneration({
        action,
        kind: "video",
        inputs: { jobItemId: item.id, input: fallback.input, fallbackFrom: primaryModel },
        output: { urls: result.urls },
        model: result.model,
        durationMs: result.durationMs,
      });
      if (!url) throw new Error("No video URL returned (kling fallback)");
      return {
        url,
        model: result.model,
        durationMs: result.durationMs,
        generationId,
        fallbackFrom: primaryModel,
      };
    }
  };
}

// Exported for unit tests (registrations below stay the side-effect entrypoint).
export const runImageItem = makeImageExecutor("broll_image");
// b-roll renders on Kling directly now, so there is no alternate provider left
// to fall back to — a Kling content refusal would otherwise re-issue the very
// same call and pay for a second refusal. Same reasoning the other two video
// apps already use. Re-enable together with klingPrimary:false to roll back.
export const runVideoItem = makeVideoExecutor("broll_video", { seedanceKlingFallback: false, klingPrimary: true });

// Accounting actions match what each app's client page passes to
// /api/generate today (grep generateImage(/generateVideo( in the page files).
registerJobType("broll_images", runImageItem);
registerJobType("broll_videos", runVideoItem);
registerJobType("character_broll_images", makeImageExecutor("character_broll_image"));
registerJobType(
  "character_broll_videos",
  makeVideoExecutor("character_broll_video", { seedanceKlingFallback: false }),
);
registerJobType("single_scene_images", makeImageExecutor("single_scene_image"));
registerJobType(
  "single_scene_videos",
  makeVideoExecutor("single_scene_video", { seedanceKlingFallback: false }),
);
registerJobType("message_testing_images", makeImageExecutor("message_ad"));
