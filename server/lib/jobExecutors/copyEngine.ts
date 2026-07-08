/**
 * Copy Engine text executor — the first TEXT job type ("copy_engine_text").
 * Each call processes exactly ONE item: one long-form Claude copy generation
 * (~60-120s on Opus), so a closed tab or deploy no longer kills the draft.
 *
 * item.input mirrors the legacy /api/generate/text/:action call the Copy
 * Engine page made (same server-side pieces — loadPrompt + generateText —
 * NOT an HTTP self-call):
 *   { action, vars, maxTokens?, userMessage?, pipelineCardId? }
 * userMessage defaults to the route's exact "Inputs (JSON): <vars>" framing;
 * model/tools come from the prompt frontmatter like the route's fallbacks
 * (the page never passes a model override).
 *
 * Action allowlist: only the prompt actions the Copy Engine page dispatches
 * (COPY_ENGINE_TEXT_ACTIONS). A text executor that ran arbitrary prompt
 * actions would be an over-broad capability — POST /api/jobs would become a
 * "run any master prompt with attacker vars" endpoint — so anything else
 * fails hard with a clear error.
 *
 * Generations accounting: the legacy path logged the model call via the
 * /api/generate route; this executor writes its own generations row on
 * success (action + kind "text" + tokens/cost/promptVersion), so accounting
 * stays complete without HTTP self-calls. pipelineCardId is logged TOP-LEVEL
 * in inputs (route parity) so the Ad Pipeline's latestGeneration lookup
 * (adPipeline.ts: inputs->>'pipelineCardId') keeps resolving live drafts.
 * Failures are NOT logged here — the job item row records the error durably,
 * and the runner may retry, which would produce duplicate error rows. Same
 * post-success-insert foot-gun as media.ts applies: a DB failure after a
 * successful (paid) Claude call fails the item loudly rather than silently
 * losing cost accounting.
 *
 * Errors: thrown as-is for the runner to classify. generateText retries
 * Anthropic 429/529 internally (3 attempts, exponential backoff); if those
 * are exhausted it throws a plain "temporarily overloaded" Error WITHOUT a
 * status, which classifyJobError marks hard — acceptable, the call was
 * already retried. Other Anthropic SDK errors surface `.status` (5xx →
 * transient runner retry, 4xx → hard), matching the fal.ts idiom.
 */
import { generateText } from "../anthropic.js";
import { db, schema } from "../db.js";
import { loadPrompt } from "../prompts.js";
import { registerJobType, type JobExecutor } from "../jobRunner.js";

/** The prompt actions CopyEngineAppPage dispatches (COPY_TYPES action/rewriteAction). */
export const COPY_ENGINE_TEXT_ACTIONS = ["listicle_copy", "mini_vsl_copy", "copy_rewrite"] as const;

type CopyEngineItemInput = {
  action?: string;
  vars?: Record<string, string>;
  maxTokens?: number;
  userMessage?: string;
  pipelineCardId?: string;
};

export const runCopyEngineTextItem: JobExecutor = async ({ item }) => {
  const input = (item.input ?? {}) as CopyEngineItemInput;
  const action = input.action ?? "";
  if (!(COPY_ENGINE_TEXT_ACTIONS as readonly string[]).includes(action)) {
    throw new Error(
      `"${action}" is not an allowed Copy Engine action (allowed: ${COPY_ENGINE_TEXT_ACTIONS.join(", ")})`,
    );
  }
  const vars = input.vars ?? {};

  // Same pieces, same precedence as POST /api/generate/text/:action.
  const prompt = loadPrompt(action, vars);
  const result = await generateText({
    systemPrompt: prompt.rendered,
    userMessage: input.userMessage ?? `Inputs (JSON):\n${JSON.stringify(vars, null, 2)}`,
    model: prompt.config.model,
    maxTokens: input.maxTokens ?? prompt.config.maxTokens,
    tools: prompt.config.tools,
  });

  const [row] = await db
    .insert(schema.generations)
    .values({
      action,
      kind: "text",
      // vars top-level like the route's loggedInputs; jobItemId for tracing
      // (media.ts idiom); pipelineCardId top-level for the Ad Pipeline query.
      inputs: {
        ...vars,
        jobItemId: item.id,
        ...(input.pipelineCardId ? { pipelineCardId: input.pipelineCardId } : {}),
      },
      output: { text: result.text },
      model: result.model,
      promptVersion: prompt.version,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: String(result.costUsd),
      durationMs: result.durationMs,
    })
    .returning({ id: schema.generations.id });
  const generationId = row?.id ?? null;

  console.log(
    `[jobs/copy_engine_text/${action}] ${result.model} ${result.durationMs}ms in=${result.tokensIn} out=${result.tokensOut} $${result.costUsd.toFixed(4)}`,
  );

  return {
    text: result.text,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
    durationMs: result.durationMs,
    generationId,
  };
};

registerJobType("copy_engine_text", runCopyEngineTextItem);
