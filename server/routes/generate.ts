import { type Request, type Response, Router } from "express";
import { generateText } from "../lib/anthropic.js";
import { db, schema } from "../lib/db.js";
import { FalContentSafetyError, generateImage, generateVideo } from "../lib/fal.js";
import { formatError } from "../lib/formatError.js";
import { loadPrompt, PromptNotConfiguredError } from "../lib/prompts.js";

export const generateRouter: Router = Router();

type Kind = "text" | "image" | "video";

async function persist(args: {
  action: string;
  kind: Kind;
  inputs: unknown;
  output: unknown;
  model: string;
  promptVersion?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  durationMs?: number;
  error?: string;
}) {
  try {
    const [row] = await db
      .insert(schema.generations)
      .values({
        action: args.action,
        kind: args.kind,
        inputs: args.inputs as object,
        output: args.output as object,
        model: args.model,
        promptVersion: args.promptVersion ?? null,
        tokensIn: args.tokensIn ?? null,
        tokensOut: args.tokensOut ?? null,
        costUsd: args.costUsd != null ? String(args.costUsd) : null,
        durationMs: args.durationMs ?? null,
        error: args.error ?? null,
      })
      .returning({ id: schema.generations.id });
    return row.id;
  } catch (err) {
    console.error("[db] failed to persist generation:", err);
    return null;
  }
}

function sendError(res: Response, status: number, message: string, extras: Record<string, unknown> = {}) {
  res.status(status).json({ error: message, ...extras });
}

/**
 * POST /api/generate/text/:action
 * Body: { vars?: object, model?: string, maxTokens?: number }
 */
generateRouter.post("/text/:action", async (req: Request, res: Response) => {
  const { action } = req.params;
  const body = (req.body ?? {}) as { vars?: Record<string, unknown>; model?: string; maxTokens?: number };
  const vars = body.vars ?? {};

  try {
    const prompt = loadPrompt(action, vars);
    const result = await generateText({
      systemPrompt: prompt.rendered,
      userMessage: `Inputs (JSON):\n${JSON.stringify(vars, null, 2)}`,
      model: body.model ?? prompt.config.model,
      maxTokens: body.maxTokens ?? prompt.config.maxTokens,
      tools: prompt.config.tools,
    });

    const id = await persist({
      action,
      kind: "text",
      inputs: vars,
      output: { text: result.text },
      model: result.model,
      promptVersion: prompt.version,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
    });

    // Per-call duration logging — useful for diagnosing why parallel prompt
    // writing takes longer than expected. Each parallel call logs its own
    // duration so you can see whether one straggler is dragging the batch.
    console.log(`[generate/text/${action}] ${result.model} ${result.durationMs}ms in=${result.tokensIn} out=${result.tokensOut} $${result.costUsd.toFixed(4)}`);

    res.json({
      id,
      action,
      promptVersion: prompt.version,
      model: result.model,
      text: result.text,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
    });
  } catch (err) {
    if (err instanceof PromptNotConfiguredError) {
      return sendError(res, 424, err.message, { action, kind: "text" });
    }
    console.error(`[generate/text/${action}]`, err);
    const msg = formatError(err);
    await persist({ action, kind: "text", inputs: vars, output: null, model: "unknown", error: msg });
    const status = (err as { status?: number })?.status;
    const code = status && status >= 400 && status < 600 ? status : 500;
    sendError(res, code, msg, { action });
  }
});

/**
 * POST /api/generate/image/:action
 * Body: { vars?: object, model?: string, input?: object }
 * If `input` is provided, it is used verbatim as the fal.ai payload.
 * Otherwise we load prompts/<action>.md, render with vars, and pass as { prompt }.
 */
generateRouter.post("/image/:action", async (req: Request, res: Response) => {
  const { action } = req.params;
  const body = (req.body ?? {}) as {
    vars?: Record<string, unknown>;
    model?: string;
    input?: Record<string, unknown>;
  };
  const vars = body.vars ?? {};

  try {
    let falInput: Record<string, unknown>;
    let promptVersion: string | undefined;
    if (body.input && !Object.keys(vars).length) {
      falInput = body.input;
    } else {
      const prompt = loadPrompt(action, vars);
      falInput = { ...(body.input ?? {}), prompt: prompt.rendered };
      promptVersion = prompt.version;
    }

    const result = await generateImage({ model: body.model, input: falInput });

    const id = await persist({
      action,
      kind: "image",
      inputs: { vars, input: falInput },
      output: { urls: result.urls, raw: result.raw },
      model: result.model,
      promptVersion,
      durationMs: result.durationMs,
    });

    res.json({ id, action, model: result.model, urls: result.urls, durationMs: result.durationMs });
  } catch (err) {
    if (err instanceof PromptNotConfiguredError) {
      return sendError(res, 424, err.message, { action, kind: "image" });
    }
    // Content-safety rejection from Gemini-backed fal models. Surface as 422
    // (not 500) so the client's auto-soften-and-retry flow triggers, and tag
    // the error code so the UI can show a friendlier message if the retry
    // also fails.
    if (err instanceof FalContentSafetyError) {
      console.warn(`[generate/image/${action}] content-safety rejection:`, err.message);
      const msg = err.message;
      await persist({ action, kind: "image", inputs: { vars }, output: null, model: body.model ?? "unknown", error: msg });
      return sendError(res, 422, msg, { action, errorCode: "content_safety_rejected" });
    }
    console.error(`[generate/image/${action}]`, err);
    const msg = formatError(err);
    await persist({ action, kind: "image", inputs: { vars }, output: null, model: body.model ?? "unknown", error: msg });
    // Honour an upstream status if the wrapped fal error carries one
    // (e.g. fal returned 429 / 503) so the client can decide whether
    // to auto-retry. Default to 500 for unknown failures.
    const status = (err as { status?: number })?.status;
    const code = status && status >= 400 && status < 600 ? status : 500;
    sendError(res, code, msg, { action });
  }
});

/**
 * POST /api/generate/video/:action
 * Body: { vars?: object, model?: string, input?: object }
 */
generateRouter.post("/video/:action", async (req: Request, res: Response) => {
  const { action } = req.params;
  const body = (req.body ?? {}) as {
    vars?: Record<string, unknown>;
    model?: string;
    input?: Record<string, unknown>;
  };
  const vars = body.vars ?? {};

  try {
    let falInput: Record<string, unknown>;
    let promptVersion: string | undefined;
    if (body.input && !Object.keys(vars).length) {
      falInput = body.input;
    } else {
      const prompt = loadPrompt(action, vars);
      falInput = { ...(body.input ?? {}), prompt: prompt.rendered };
      promptVersion = prompt.version;
    }

    const result = await generateVideo({ model: body.model, input: falInput });

    const id = await persist({
      action,
      kind: "video",
      inputs: { vars, input: falInput },
      output: { urls: result.urls, raw: result.raw },
      model: result.model,
      promptVersion,
      durationMs: result.durationMs,
    });

    res.json({ id, action, model: result.model, urls: result.urls, durationMs: result.durationMs });
  } catch (err) {
    if (err instanceof PromptNotConfiguredError) {
      return sendError(res, 424, err.message, { action, kind: "video" });
    }
    console.error(`[generate/video/${action}]`, err);
    const msg = formatError(err);
    await persist({ action, kind: "video", inputs: { vars }, output: null, model: body.model ?? "unknown", error: msg });
    const status = (err as { status?: number })?.status;
    const code = status && status >= 400 && status < 600 ? status : 500;
    sendError(res, code, msg, { action });
  }
});
