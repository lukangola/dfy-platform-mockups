/**
 * Static Ads Iterations — headline alternates + headline-swap variations for a
 * winning static ad.
 *
 *   POST /api/static-ads-iterations/headlines
 *     Body: { sourceImageUrl, angle, product?, feedback?, existingHeadlines?, count? }
 *     Returns: { headlines: string[], model, promptVersion, durationMs }
 *
 *   POST /api/static-ads-iterations/variation
 *     Body: { sourceImageUrl, headline }
 *     Returns: { url, model, promptVersion, durationMs }
 *
 * Both endpoints persist to `generations` so failures are diagnosable and cost
 * is tracked alongside the other apps.
 */
import { type Request, type Response, Router } from "express";
import { generateText } from "../lib/anthropic.js";
import { db, schema } from "../lib/db.js";
import { generateImage, uploadToFalStorage } from "../lib/fal.js";
import { loadPrompt } from "../lib/prompts.js";

export const staticAdsIterationsRouter: Router = Router();

function sendError(res: Response, status: number, message: string, extra?: Record<string, unknown>) {
  res.status(status).json({ error: message, ...extra });
}

function toHttps(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^http:\/\//, "https://");
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], "base64") };
}

/** Extract the first JSON object/array from a possibly-fenced response. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to greedy match.
  }
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Model response did not contain JSON");
  return JSON.parse(m[0]);
}

// ---------- POST /headlines ----------

type HeadlinesBody = {
  sourceImageUrl?: string;
  angle?: string;
  product?: string;
  feedback?: string;
  existingHeadlines?: string[];
  count?: number;
};

staticAdsIterationsRouter.post("/headlines", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as HeadlinesBody;
  const sourceImageUrl = toHttps(body.sourceImageUrl);
  const angle = (body.angle ?? "").trim();
  const count = Math.max(1, Math.min(20, Number(body.count) || 10));

  if (!sourceImageUrl) return sendError(res, 400, "sourceImageUrl is required");
  if (!angle) return sendError(res, 400, "angle is required");

  try {
    const existing = Array.isArray(body.existingHeadlines) ? body.existingHeadlines.filter(Boolean) : [];
    const existingText = existing.length
      ? existing.map((h, i) => `${i + 1}. ${h}`).join("\n")
      : "(none — this is the first pass)";
    const feedbackText = body.feedback?.trim()
      ? body.feedback.trim()
      : "(no feedback — produce a fresh spread of distinct hooks)";
    const productText = body.product?.trim() || "(no additional product detail provided — infer from the image)";

    const prompt = loadPrompt("static_ad_iterations_headlines", {
      angle,
      product: productText,
      feedback: feedbackText,
      existing_headlines: existingText,
      count: String(count),
    });

    const result = await generateText({
      systemPrompt: prompt.rendered,
      userMessage: `Generate ${count} alternate headlines for the attached ad, speaking to the angle described in the system prompt. Return only the JSON object.`,
      model: prompt.config.model,
      maxTokens: prompt.config.maxTokens,
      imageUrls: [sourceImageUrl],
    });

    let headlines: string[];
    try {
      const parsed = extractJson(result.text) as { headlines?: unknown };
      if (!Array.isArray(parsed.headlines)) throw new Error("missing 'headlines' array");
      headlines = parsed.headlines
        .map((h) => (typeof h === "string" ? h.trim() : ""))
        .filter((h) => h.length > 0);
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      throw new Error(`Headline generator returned unparseable output: ${msg}. Raw: ${result.text.slice(0, 300)}`);
    }
    if (headlines.length === 0) throw new Error("Headline generator returned zero usable headlines");

    await db.insert(schema.generations).values({
      action: "static_ad_iterations_headlines",
      kind: "text",
      inputs: { sourceImageUrl, angle, product: body.product ?? null, feedback: body.feedback ?? null, existingHeadlines: existing, count },
      output: { headlines, raw: result.text },
      model: result.model,
      promptVersion: prompt.version,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: String(result.costUsd),
      durationMs: result.durationMs,
    });

    res.json({
      headlines,
      model: result.model,
      promptVersion: prompt.version,
      durationMs: result.durationMs,
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    console.error("[static-ads-iterations] headlines failed:", err);
    try {
      await db.insert(schema.generations).values({
        action: "static_ad_iterations_headlines",
        kind: "text",
        inputs: { sourceImageUrl, angle, product: body.product ?? null, feedback: body.feedback ?? null, count },
        model: "claude-sonnet-4-6",
        error: rawMsg,
      });
    } catch (logErr) {
      console.error("[static-ads-iterations] failed to persist headlines error row:", logErr);
    }
    sendError(res, 500, `Headline generation failed: ${rawMsg.slice(0, 300)}`);
  }
});

// ---------- POST /upload-source ----------
//
// Lightweight upload for a one-off source ad the user wants to iterate on.
// Uploads to fal.storage and returns the URL. Does NOT touch the brand-assets
// library — the Brand Assets library is for *generated* outputs only.

type UploadBody = { dataUrl?: string; filename?: string };

staticAdsIterationsRouter.post("/upload-source", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as UploadBody;
  if (!body.dataUrl) return sendError(res, 400, "dataUrl is required");
  const decoded = decodeDataUrl(body.dataUrl);
  if (!decoded) return sendError(res, 400, "dataUrl is not a valid base64 data URL");
  try {
    const filename = body.filename?.trim() || `iteration-source-${Date.now()}.png`;
    const url = await uploadToFalStorage(decoded.buffer, decoded.mime, filename);
    res.json({ url, filename });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[static-ads-iterations] upload-source failed:", err);
    sendError(res, 500, `Upload failed: ${msg}`);
  }
});

// ---------- POST /variation ----------

type VariationBody = {
  sourceImageUrl?: string;
  headline?: string;
  feedback?: string;
};

// fal.ai nano-banana-pro/edit caps the prompt at 50K chars. This prompt is
// tiny (the template plus the headline) so the cap is essentially unreachable,
// but we keep the same headroom guard the recreate route uses.
const PROMPT_MAX_CHARS = 49_000;

staticAdsIterationsRouter.post("/variation", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as VariationBody;
  const sourceImageUrl = toHttps(body.sourceImageUrl);
  const headline = (body.headline ?? "").trim();
  const feedback = (body.feedback ?? "").trim();

  if (!sourceImageUrl) return sendError(res, 400, "sourceImageUrl is required");
  if (!headline) return sendError(res, 400, "headline is required");

  try {
    const prompt = loadPrompt("static_ad_iterations_variation", {
      headline,
      feedback: feedback || "(no additional feedback — follow the hard rules exactly)",
    });
    const rendered =
      prompt.rendered.length > PROMPT_MAX_CHARS
        ? prompt.rendered.slice(0, PROMPT_MAX_CHARS)
        : prompt.rendered;

    const model = prompt.config.model ?? "fal-ai/nano-banana-pro/edit";
    const result = await generateImage({
      model,
      input: {
        prompt: rendered,
        image_urls: [sourceImageUrl],
        aspect_ratio: "1:1",
        resolution: "2K",
        num_images: 1,
        output_format: "jpeg",
      },
    });

    const url = result.urls[0];
    if (!url) throw new Error(`${model} returned no image URL`);

    await db.insert(schema.generations).values({
      action: "static_ad_iterations_variation",
      kind: "image",
      inputs: { sourceImageUrl, headline, feedback: feedback || null },
      output: { url, raw: result.raw },
      model: result.model,
      promptVersion: prompt.version,
      durationMs: result.durationMs,
    });

    res.json({
      url,
      model: result.model,
      promptVersion: prompt.version,
      durationMs: result.durationMs,
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    console.error("[static-ads-iterations] variation failed:", err);
    try {
      await db.insert(schema.generations).values({
        action: "static_ad_iterations_variation",
        kind: "image",
        inputs: { sourceImageUrl, headline, feedback: feedback || null },
        model: "fal-ai/nano-banana-pro/edit",
        error: rawMsg,
      });
    } catch (logErr) {
      console.error("[static-ads-iterations] failed to persist variation error row:", logErr);
    }
    sendError(res, 500, `Variation generation failed: ${rawMsg.slice(0, 300)}`);
  }
});
