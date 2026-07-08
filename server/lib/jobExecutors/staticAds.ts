/**
 * Executor for the Static Ads app's durable job type. Each call processes
 * exactly ONE item: item.input = the same args the HTTP route accepts —
 * { referenceId, productId, angleName, language?, brand?, feedback?,
 *   previousOutputUrl?, pipelineCardId? }.
 *
 * Unlike the b-roll executors this one doesn't call fal directly:
 * runStaticAdRecreate IS the full route pipeline (prompt composition,
 * feedback-edit mode, model selection) and already writes its own
 * generations row on success AND failure — no extra accounting here.
 *
 * Errors just propagate. runStaticAdRecreate throws StaticAdRecreateError
 * carrying the route's classified user message plus the ORIGINAL provider
 * HTTP status on `.status`, so the runner's classifyJobError sees the same
 * signal the route saw: fal 429/5xx → transient retry; the deterministic
 * content-safety block (fal 422, friendly "content-safety filter blocked"
 * message that matches neither the transient nor the likeness regex) →
 * hard fail, which is right — retrying a moderation block wastes money.
 * No Kling fallback here: that likeness fallback is a b-roll VIDEO
 * concern and lives inside that executor only.
 */
import { registerJobType, type JobExecutor } from "../jobRunner.js";
import { runStaticAdRecreate, type StaticAdRecreateArgs } from "../staticAdRecreate.js";

const runRecreateItem: JobExecutor = async ({ item }) => {
  // Passed verbatim — runStaticAdRecreate re-validates the required fields
  // (jsonb input is untyped) and throws a hard 400-class error when absent.
  const args = (item.input ?? {}) as StaticAdRecreateArgs;
  const result = await runStaticAdRecreate(args);
  // { url, referenceId, durationMs, model, promptVersion } → item.output
  return { ...result };
};

registerJobType("static_ads_recreate", runRecreateItem);

// Exported for unit tests (registration above stays the side-effect entrypoint).
export { runRecreateItem };
