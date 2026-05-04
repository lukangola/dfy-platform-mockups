/**
 * Static Ad Recreator — image generation endpoint.
 *
 *   POST /api/static-ads/recreate
 *   Body: { productId, angleName, language?, referenceId, brand? }
 *   Returns: { url, referenceId, durationMs, model, promptVersion }
 *
 * One call per reference. The client fires these in parallel so the UI can
 * stream results in as each one completes.
 *
 * Images passed to nano-banana-pro/edit (in order, limited to what's set):
 *   1. the reference ad image                   — structural template
 *   2. product.productImageUrl                  — hero product shot
 *   3. product.research.referenceSheetUrl       — generated reference sheet
 *                                                 (orthographic views + dimensions +
 *                                                  handling — the authoritative source
 *                                                  of aspect ratio / proportions)
 *   4. product.contentImageUrl                  — supplementary reference with
 *                                                 packaging detail
 */
import { eq } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { db, schema } from "../lib/db.js";
import { generateImage } from "../lib/fal.js";
import { loadPrompt } from "../lib/prompts.js";

export const staticAdsRouter: Router = Router();

type IncomingBrand = {
  name?: string;
  websiteUrl?: string;
  description?: string;
  tone?: string;
  colorPalette?: Array<{ name?: string; hex?: string; usage?: string }>;
  fonts?: Array<{ name?: string; usage?: string; weight?: string }>;
  logoUrl?: string | null;
};

type RecreateBody = {
  productId?: string;
  angleName?: string;
  language?: string;
  referenceId?: string;
  brand?: IncomingBrand | null;
  feedback?: string;
};

function sendError(res: Response, status: number, message: string, extra?: Record<string, unknown>) {
  res.status(status).json({ error: message, ...extra });
}

/**
 * Error codes surfaced to the client so the UI can render a specific
 * explanation + decide whether "Retry" is worth offering. Keep this list in
 * sync with the UI switch statement in StaticAdsAppPage.tsx.
 */
type RecreateErrorCode =
  | "moderation"       // fal.ai content-safety block. Deterministic — retry won't help.
  | "rate_limit"       // 429 / concurrent connections. Backs off internally; if it reaches the UI, retry later.
  | "timeout"          // model took too long.
  | "upstream"         // fal.ai 5xx or transient infra.
  | "bad_input"        // missing / malformed input.
  | "unknown";

function classifyRecreateError(rawMsg: string): {
  code: RecreateErrorCode;
  userMessage: string;
  retryable: boolean;
} {
  if (/\bforbidden\b|content\s*polic|safety|moderation|unsafe/i.test(rawMsg)) {
    return {
      code: "moderation",
      userMessage:
        "The image model's content-safety filter blocked this reference + product combo. This is deterministic — retrying will hit the same block. Pick a different reference ad for this angle.",
      retryable: false,
    };
  }
  if (/\b429\b|rate.?limit|too many requests|concurrent connections/i.test(rawMsg)) {
    return {
      code: "rate_limit",
      userMessage:
        "The image provider is rate-limiting us right now. Wait a minute and try again — this should clear on its own.",
      retryable: true,
    };
  }
  if (/\btimeout\b|timed? out|deadline exceeded/i.test(rawMsg)) {
    return {
      code: "timeout",
      userMessage:
        "The image model took too long and timed out. Retry usually works — the provider is occasionally slow under load.",
      retryable: true,
    };
  }
  if (/\b5\d\d\b|bad gateway|service unavailable|upstream|\b422\b|unprocessable/i.test(rawMsg)) {
    return {
      code: "upstream",
      userMessage:
        "The image provider couldn't process this request — usually a transient hiccup on their end. Wait a moment and retry.",
      retryable: true,
    };
  }
  if (/\b4(0[0-9]|1[0-578])\b|invalid|malformed|missing.*image|not.*url/i.test(rawMsg)) {
    return {
      code: "bad_input",
      userMessage:
        "The model rejected the input (usually a missing or unreadable reference/product image). Check the reference and product images load correctly.",
      retryable: false,
    };
  }
  return {
    code: "unknown",
    userMessage: `Image generation failed: ${rawMsg.slice(0, 200)}`,
    retryable: true,
  };
}

function formatBrand(brand: IncomingBrand | null | undefined): string {
  if (!brand || !brand.name) {
    return "(No brand identity provided — fall back to the tone/style implied by the reference ad.)";
  }
  const parts: string[] = [];
  parts.push(`Name: ${brand.name}`);
  if (brand.websiteUrl) parts.push(`Website: ${brand.websiteUrl}`);
  if (brand.description) parts.push(`Description:\n${brand.description}`);
  if (brand.tone) parts.push(`Tone of Voice:\n${brand.tone}`);
  if (brand.colorPalette && brand.colorPalette.length > 0) {
    const palette = brand.colorPalette
      .filter((c) => c && (c.hex || c.name))
      .map((c) => `- ${c.name ?? "unnamed"} (${c.hex ?? "?"}) — ${c.usage ?? ""}`.trimEnd())
      .join("\n");
    if (palette) parts.push(`Color Palette:\n${palette}`);
  }
  if (brand.fonts && brand.fonts.length > 0) {
    const fonts = brand.fonts
      .filter((f) => f && f.name)
      .map((f) => `- ${f.name} — ${f.usage ?? ""} (weight: ${f.weight ?? "?"})`.trimEnd())
      .join("\n");
    if (fonts) parts.push(`Fonts:\n${fonts}`);
  }
  return parts.join("\n\n");
}

function toHttps(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^http:\/\//, "https://");
}

// fal.ai nano-banana-pro/edit caps the prompt at 50,000 chars. Leave headroom
// so we never skate the edge (e.g. after the model swaps the template or a
// variable boundary).
const PROMPT_MAX_CHARS = 49_000;
const TRUNC_NOTE = "\n\n[...truncated to fit the image model's prompt-length limit]";

/**
 * Render the recreate prompt and, if it exceeds fal.ai's 50K cap, trim the two
 * typically-long variables (product research + reference deconstruction)
 * proportionally and re-render. Falls back to a hard slice if still too long.
 */
function renderRecreateBounded(vars: {
  brand: string;
  product: string;
  angle: string;
  language: string;
  deconstruction: string;
  feedback: string;
}) {
  let prompt = loadPrompt("static_ad_recreate", vars);
  if (prompt.rendered.length <= PROMPT_MAX_CHARS) return prompt;

  const overflow = prompt.rendered.length - PROMPT_MAX_CHARS + 200;
  const pLen = vars.product.length;
  const dLen = vars.deconstruction.length;
  const budget = pLen + dLen;

  if (budget > 0) {
    const pTrim = Math.ceil((overflow * pLen) / budget);
    const dTrim = Math.ceil((overflow * dLen) / budget);
    const trimmedProduct =
      pLen > pTrim + TRUNC_NOTE.length
        ? vars.product.slice(0, pLen - pTrim - TRUNC_NOTE.length) + TRUNC_NOTE
        : vars.product;
    const trimmedDeconstruction =
      dLen > dTrim + TRUNC_NOTE.length
        ? vars.deconstruction.slice(0, dLen - dTrim - TRUNC_NOTE.length) + TRUNC_NOTE
        : vars.deconstruction;
    console.warn(
      `[static-ads] prompt ${prompt.rendered.length} > ${PROMPT_MAX_CHARS} chars; trimming product (-${pTrim}) + deconstruction (-${dTrim})`,
    );
    prompt = loadPrompt("static_ad_recreate", {
      ...vars,
      product: trimmedProduct,
      deconstruction: trimmedDeconstruction,
    });
  }

  if (prompt.rendered.length > PROMPT_MAX_CHARS) {
    console.warn(
      `[static-ads] prompt still ${prompt.rendered.length} chars after trim; hard-clipping`,
    );
    prompt = { ...prompt, rendered: prompt.rendered.slice(0, PROMPT_MAX_CHARS) };
  }
  return prompt;
}

staticAdsRouter.post("/recreate", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as RecreateBody;
  const { productId, angleName, referenceId } = body;
  if (!productId || !angleName || !referenceId) {
    return sendError(res, 400, "productId, angleName, and referenceId are required");
  }

  try {
    const [product] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1);
    if (!product) return sendError(res, 404, "Product not found");

    const [reference] = await db
      .select()
      .from(schema.staticAdReferences)
      .where(eq(schema.staticAdReferences.id, referenceId))
      .limit(1);
    if (!reference) return sendError(res, 404, "Reference not found");

    const research = (product.research ?? {}) as {
      markdown?: string;
      angles?: Array<{ name: string; block: string }>;
      referenceSheetUrl?: string;
    };
    // Predefined angles are stored on the product by the research pipeline.
    // The UI also lets users type a free-form custom angle — in that case the
    // name won't match any stored angle, and we fall back to using the raw
    // text as both the angle's title and its detail block.
    const angle = research.angles?.find((a) => a.name === angleName);
    const isCustomAngle = !angle;
    if (isCustomAngle && !angleName.trim()) {
      return sendError(res, 400, "angleName is empty");
    }

    const deconstruction = reference.deconstruction as
      | { raw?: string; json?: unknown }
      | null;
    const deconstructionText =
      deconstruction?.raw?.trim() ||
      (deconstruction?.json ? JSON.stringify(deconstruction.json, null, 2) : "") ||
      "(No deconstruction available — work from the reference image alone, preserving its exact layout and composition.)";

    const productText = [
      `Name: ${product.name}`,
      `Category: ${product.category}`,
      product.productUrl ? `URL: ${product.productUrl}` : "",
      research.markdown ? `Research:\n${research.markdown}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const angleText = angle
      ? `${angle.name}\n\n${angle.block}`
      : `Custom user-specified angle:\n\n${angleName.trim()}`;
    const brandText = formatBrand(body.brand ?? null);
    const feedbackText = body.feedback?.trim()
      ? `USER FEEDBACK ON THE PREVIOUS ATTEMPT — address this directly in the regeneration:\n\n${body.feedback.trim()}`
      : "";

    const prompt = renderRecreateBounded({
      brand: brandText,
      product: productText,
      angle: angleText,
      language: body.language ?? "en",
      deconstruction: deconstructionText,
      feedback: feedbackText,
    });

    const model =
      (prompt.config.model as string | undefined) ?? "fal-ai/nano-banana-pro/edit";

    const referenceImageUrl = toHttps(reference.imageUrl);
    const productImageUrl = toHttps(product.productImageUrl);
    const referenceSheetUrl = toHttps(research.referenceSheetUrl ?? null);
    const contentImageUrl = toHttps(product.contentImageUrl);

    // Order matters — the prompt references these by position.
    // 1. reference ad (structural template)
    // 2. hero product shot (authoritative product identity)
    // 3. product reference sheet (authoritative aspect ratio + proportions +
    //    dimensions — the asset that prevents the model from squashing/stretching
    //    the packaging to fit the reference's product slot)
    // 4. content image (optional supplementary packaging detail)
    const imageUrls = [
      referenceImageUrl,
      productImageUrl,
      referenceSheetUrl,
      contentImageUrl,
    ].filter((u): u is string => Boolean(u));
    if (imageUrls.length === 0) {
      return sendError(res, 400, "No input images available (reference and product both missing URLs)");
    }

    const result = await generateImage({
      model,
      input: {
        prompt: prompt.rendered,
        image_urls: imageUrls,
        aspect_ratio: "1:1",
        resolution: "2K",
        num_images: 1,
        output_format: "jpeg",
      },
    });

    const url = result.urls[0];
    if (!url) throw new Error(`${model} returned no image URL`);

    await db.insert(schema.generations).values({
      action: "static_ad_recreate",
      kind: "image",
      inputs: {
        productId,
        referenceId,
        angleName,
        isCustomAngle,
        language: body.language ?? "en",
        imageUrls,
        brand: body.brand ?? null,
        feedback: body.feedback ?? null,
      },
      output: { url, raw: result.raw },
      model: result.model,
      promptVersion: prompt.version,
      durationMs: result.durationMs,
    });

    res.json({
      url,
      referenceId,
      durationMs: result.durationMs,
      model: result.model,
      promptVersion: prompt.version,
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    console.error(`[static-ads] recreate failed for ref ${referenceId}:`, err);

    const { code, userMessage, retryable } = classifyRecreateError(rawMsg);

    // Persist the failure (with both the classified code and the raw error)
    // so we can diagnose patterns later. Best-effort — don't block the HTTP
    // response on it.
    try {
      await db.insert(schema.generations).values({
        action: "static_ad_recreate",
        kind: "image",
        inputs: {
          productId,
          referenceId,
          angleName,
          language: body.language ?? "en",
          brand: body.brand ?? null,
          feedback: body.feedback ?? null,
          errorCode: code,
        },
        model: "fal-ai/nano-banana-pro/edit",
        error: rawMsg,
      });
    } catch (logErr) {
      console.error(`[static-ads] failed to persist error row:`, logErr);
    }

    sendError(res, 500, userMessage, { errorCode: code, retryable, rawError: rawMsg });
  }
});
