/**
 * Executors for the standard B-roll app's two durable job types. Each call
 * processes exactly ONE item: item.input = { shotId, kind, model, falInput }.
 *
 * Generations accounting: the legacy path logged model calls via the
 * /api/generate route; jobs call fal directly (generateImage/generateVideo),
 * so each executor writes its own generations row here — cost/accounting
 * stays complete without HTTP self-calls.
 *
 * Likeness policy (spec): Seedance 2.0 refuses reference images containing
 * realistic human faces (422 "likenesses of real people" / content-checker
 * flags). For video items that is not a user error — the executor retries
 * ONCE on Kling v3 with the same starting frame; output.model records what
 * actually rendered. The runner's classifyJobError never retries likeness
 * errors itself, so this fallback is the only second chance.
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
  action: "broll_image" | "broll_video";
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

const runImageItem: JobExecutor = async ({ item }) => {
  const input = (item.input ?? {}) as MediaItemInput;
  if (!input.falInput) throw new Error("item.input.falInput missing");
  const result = await generateImage({ model: input.model, input: input.falInput });
  const url = result.urls[0];
  const generationId = await logGeneration({
    action: "broll_image",
    kind: "image",
    inputs: { jobItemId: item.id, input: input.falInput },
    output: { urls: result.urls },
    model: result.model,
    durationMs: result.durationMs,
  });
  if (!url) throw new Error("No image URL returned");
  return { url, model: result.model, durationMs: result.durationMs, generationId };
};

const runVideoItem: JobExecutor = async ({ item }) => {
  const input = (item.input ?? {}) as MediaItemInput;
  if (!input.falInput) throw new Error("item.input.falInput missing");
  const primaryModel = input.model ?? "bytedance/seedance-2.0/fast/reference-to-video";
  try {
    const result = await generateVideo({ model: primaryModel, input: input.falInput });
    const url = result.urls[0];
    const generationId = await logGeneration({
      action: "broll_video",
      kind: "video",
      inputs: { jobItemId: item.id, input: input.falInput },
      output: { urls: result.urls },
      model: result.model,
      durationMs: result.durationMs,
    });
    if (!url) throw new Error("No video URL returned");
    return { url, model: result.model, durationMs: result.durationMs, generationId };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const msg = formatError(err);
    if (classifyJobError(status, msg) !== "likeness") throw err;
    const fallback = seedanceToKlingFallback(input.falInput);
    if (!fallback) throw err;
    console.warn(`[jobs] item ${item.id}: seedance likeness refusal — falling back to kling`);
    const result = await generateVideo({ model: fallback.model, input: fallback.input });
    const url = result.urls[0];
    const generationId = await logGeneration({
      action: "broll_video",
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

registerJobType("broll_images", runImageItem);
registerJobType("broll_videos", runVideoItem);

// Exported for unit tests (registration above stays the side-effect entrypoint).
export { runImageItem, runVideoItem };
