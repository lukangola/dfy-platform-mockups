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
import {
  parseBrandGuidelines,
  pickBackgroundColor,
  pickBodyTextColor,
  pickCtaColor,
} from "../lib/brandGuidelinesParse.js";
import { db, schema } from "../lib/db.js";
import { generateImage } from "../lib/fal.js";
import { loadPrompt } from "../lib/prompts.js";

export const staticAdsRouter: Router = Router();

type IncomingBrand = {
  name?: string;
  websiteUrl?: string;
  logoUrl?: string | null;
  /**
   * The single source of truth — the brand's full 8-section guidelines
   * markdown (from prompts/brand_guidelines.md). When present, the
   * markdown is injected directly into the static-ad image prompt as
   * the brand context block. The legacy structured fields below are
   * a fallback for brands that haven't been re-extracted yet.
   */
  guidelinesMarkdown?: string | null;
  /** @deprecated legacy fields — used only when guidelinesMarkdown is missing. */
  description?: string;
  /** @deprecated */
  tone?: string;
  /** @deprecated */
  colorPalette?: Array<{ name?: string; hex?: string; usage?: string }>;
  /** @deprecated */
  fonts?: Array<{ name?: string; usage?: string; weight?: string }>;
};

type RecreateBody = {
  productId?: string;
  angleName?: string;
  language?: string;
  referenceId?: string;
  brand?: IncomingBrand | null;
  feedback?: string;
  /**
   * When the user clicks "Regenerate with feedback", the client sends the
   * URL of the previously-generated output here. When both `feedback` and
   * `previousOutputUrl` are set, we switch to feedback-edit mode: the prior
   * output is the input image, and we apply the feedback as an edit rather
   * than re-running the full recreate pipeline from the reference ad.
   */
  previousOutputUrl?: string;
};

function sendError(res: Response, status: number, message: string, extra?: Record<string, unknown>) {
  res.status(status).json({ error: message, ...extra });
}

/**
 * Map the short language code the frontend stores in state (e.g. "de") to a
 * full English-language name ("German"). The image model anchors on whatever
 * literal copy strings are present in the deconstruction JSON — a 2-letter
 * code is too weak a directive to override that. Sending the full word makes
 * the "translate every visible piece of copy into LANGUAGE" instruction
 * unambiguous, especially when the reference is in a different language than
 * the user picked.
 */
function resolveLanguageName(code: string | undefined): string {
  const map: Record<string, string> = {
    en: "English",
    de: "German",
    fr: "French",
    es: "Spanish",
    it: "Italian",
    pt: "Portuguese",
    nl: "Dutch",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    ar: "Arabic",
    tr: "Turkish",
  };
  const k = (code ?? "en").trim().toLowerCase();
  return map[k] ?? code ?? "English";
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
  // Preferred path: the brand has its full guidelines markdown. The
  // model gets the entire 8-section style guide as context — color
  // palette + typography + voice + do's & don'ts in one block. This is
  // strictly more information than the old hand-formatted snippet.
  if (typeof brand.guidelinesMarkdown === "string" && brand.guidelinesMarkdown.trim().length > 0) {
    return [
      `Name: ${brand.name}`,
      brand.websiteUrl ? `Website: ${brand.websiteUrl}` : null,
      "",
      "Brand Guidelines (single source of truth — match the color palette, typography, and voice exactly):",
      "",
      brand.guidelinesMarkdown.trim(),
    ].filter((l) => l !== null).join("\n");
  }
  // Fallback for legacy brands that haven't been re-extracted yet.
  // Identical to the original hand-formatted shape — keeps existing
  // workspaces functional during the migration window.
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

/**
 * Resolved brand design tokens that get injected as named template
 * variables in the recreate prompt. The values come from the brand's
 * guidelines markdown via `parseBrandGuidelines` + the smart pickers —
 * the same path the listicle lander render uses. Surfacing them as
 * explicit variables (rather than letting the model dig through the
 * 8-section markdown blob) is what forces the model to actually USE
 * brand colors + fonts instead of copying the reference ad's identity.
 *
 * Every field can be null when the brand hasn't been re-extracted yet
 * or the markdown lacks that section. The prompt handles nulls by
 * falling back to the brand markdown blob for context.
 */
type BrandTokens = {
  primaryHex: string | null;     // CTA / primary action color
  backgroundHex: string | null;  // Page background
  bodyTextHex: string | null;    // Body / paragraph color
  fontHeading: string | null;    // Display / heading font family
  fontBody: string | null;       // Body / paragraph font family
};

function resolveBrandTokens(brand: IncomingBrand | null | undefined): BrandTokens {
  const empty: BrandTokens = {
    primaryHex: null,
    backgroundHex: null,
    bodyTextHex: null,
    fontHeading: null,
    fontBody: null,
  };
  if (!brand) return empty;

  // Preferred path — full guidelines markdown is the source of truth.
  if (typeof brand.guidelinesMarkdown === "string" && brand.guidelinesMarkdown.trim().length > 0) {
    const parsed = parseBrandGuidelines(brand.guidelinesMarkdown);
    const primary = pickCtaColor(parsed.designSystem, parsed.colors);
    const background = pickBackgroundColor(parsed.designSystem, parsed.colors);
    const bodyText = pickBodyTextColor(parsed.colors);
    // Fonts: Primary role drives headings, Secondary role drives body
    // copy. When only one font is defined we use it for both — that's
    // common for minimalist DTC brands.
    const fonts = parsed.fonts;
    const heading = fonts.find((f) => f.role === "Primary")?.name ?? fonts[0]?.name ?? null;
    const body = fonts.find((f) => f.role === "Secondary")?.name ?? heading;
    return {
      primaryHex: primary ?? null,
      backgroundHex: background ?? null,
      bodyTextHex: bodyText ?? null,
      fontHeading: heading,
      fontBody: body,
    };
  }

  // Legacy path — derive from the deprecated structured fields if a
  // brand hasn't been re-extracted to markdown yet.
  const palette = brand.colorPalette ?? [];
  const fonts = brand.fonts ?? [];
  const primaryFromPalette = palette.find((c) => /\b(cta|primary|button)\b/i.test(c.usage ?? ""))?.hex;
  const bgFromPalette = palette.find((c) => /\b(background|page bg)\b/i.test(c.usage ?? ""))?.hex;
  const bodyFromPalette = palette.find((c) => /\b(body|paragraph|text)\b/i.test(c.usage ?? ""))?.hex;
  return {
    primaryHex: primaryFromPalette ?? null,
    backgroundHex: bgFromPalette ?? null,
    bodyTextHex: bodyFromPalette ?? null,
    fontHeading: fonts.find((f) => /heading|display|primary/i.test(f.usage ?? ""))?.name ?? fonts[0]?.name ?? null,
    fontBody: fonts.find((f) => /body|paragraph|secondary/i.test(f.usage ?? ""))?.name ?? null,
  };
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
  // Structured brand tokens — concrete hex codes + font family names
  // that the prompt references by name (`{{PRIMARY_HEX}}`, etc.) so the
  // model gets unambiguous brand identity instead of having to derive
  // it from the markdown blob. Empty strings render as "(not specified)"
  // in the prompt so the rule about not copying the reference still
  // applies cleanly when a brand hasn't been re-extracted yet.
  PRIMARY_HEX: string;
  BG_HEX: string;
  BODY_TEXT_HEX: string;
  FONT_HEADING: string;
  FONT_BODY: string;
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
    const languageName = resolveLanguageName(body.language);
    const feedbackText = body.feedback?.trim() ?? "";
    // Feedback-edit mode kicks in only when BOTH a previous output URL and
    // feedback text are present. The frontend gates this at the click site —
    // bare "Regenerate" (no typed feedback) sends neither, so we still fall
    // through to the full recreate pipeline. This lets users iterate from
    // an already-good direction instead of re-rolling the whole composition.
    const isFeedbackEdit = Boolean(body.previousOutputUrl && feedbackText);

    // Resolve concrete brand design tokens (hex codes + font names) from
    // the brand guidelines markdown. Surfacing these as named variables
    // in the prompt is what stops the model from copying the reference
    // ad's exact colors and fonts — the markdown blob alone wasn't a
    // strong enough signal to override the image-conditioned anchor.
    const tokens = resolveBrandTokens(body.brand ?? null);
    const TOKEN_UNSET = "(not specified — use a brand-appropriate value derived from the brand guidelines block above)";

    // Feedback-edit prompt is intentionally minimal — no brand / product /
    // angle context blocks. The model is editing an existing image, so it
    // already has every visual cue it needs; the only inputs that matter
    // are the user's change request and the language directive. Mirrors
    // the shape of the static_ad_iterations_variation prompt, which is
    // the surface we already know fal.ai accepts reliably.
    const prompt = isFeedbackEdit
      ? loadPrompt("static_ad_feedback_edit", {
          language: languageName,
          feedback: feedbackText,
        })
      : renderRecreateBounded({
          brand: brandText,
          product: productText,
          angle: angleText,
          language: languageName,
          deconstruction: deconstructionText,
          feedback: feedbackText
            ? `USER FEEDBACK ON THE PREVIOUS ATTEMPT — address this directly in the regeneration:\n\n${feedbackText}`
            : "",
          PRIMARY_HEX: tokens.primaryHex ?? TOKEN_UNSET,
          BG_HEX: tokens.backgroundHex ?? TOKEN_UNSET,
          BODY_TEXT_HEX: tokens.bodyTextHex ?? TOKEN_UNSET,
          FONT_HEADING: tokens.fontHeading ?? TOKEN_UNSET,
          FONT_BODY: tokens.fontBody ?? TOKEN_UNSET,
        });

    if (!isFeedbackEdit) {
      console.log(
        `[static-ads] recreate brand tokens — primary=${tokens.primaryHex ?? "—"} bg=${tokens.backgroundHex ?? "—"} body=${tokens.bodyTextHex ?? "—"} heading=${tokens.fontHeading ?? "—"} body-font=${tokens.fontBody ?? "—"}`,
      );
    }

    // Safety cap — fal.ai nano-banana-pro/edit rejects prompts > 50K chars
    // with a 422 that maps to our generic "PROVIDER ERROR" in the UI. The
    // recreate path is guarded by renderRecreateBounded; do the same for
    // the edit path. The minimal edit prompt is normally well under, but
    // a long feedback paragraph from the user could push it over.
    const renderedPrompt =
      prompt.rendered.length > PROMPT_MAX_CHARS
        ? prompt.rendered.slice(0, PROMPT_MAX_CHARS)
        : prompt.rendered;

    const model =
      (prompt.config.model as string | undefined) ?? "fal-ai/nano-banana-pro/edit";

    const referenceImageUrl = toHttps(reference.imageUrl);
    const productImageUrl = toHttps(product.productImageUrl);
    const referenceSheetUrl = toHttps(research.referenceSheetUrl ?? null);
    const contentImageUrl = toHttps(product.contentImageUrl);

    // Image set depends on mode:
    //   • Feedback-edit: [previous output, hero product] — minimal so the
    //     edit model anchors hard on the existing composition and treats
    //     the product image purely as a fidelity check.
    //   • Full recreate (default):
    //     1. reference ad (structural template)
    //     2. hero product shot (authoritative product identity)
    //     3. product reference sheet (authoritative aspect ratio +
    //        proportions + dimensions)
    //     4. content image (optional supplementary packaging detail)
    const imageUrls = isFeedbackEdit
      ? [toHttps(body.previousOutputUrl ?? null), productImageUrl].filter(
          (u): u is string => Boolean(u),
        )
      : [
          referenceImageUrl,
          productImageUrl,
          referenceSheetUrl,
          contentImageUrl,
        ].filter((u): u is string => Boolean(u));
    if (imageUrls.length === 0) {
      return sendError(res, 400, "No input images available (reference and product both missing URLs)");
    }

    if (isFeedbackEdit) {
      console.log(
        `[static-ads] feedback-edit: prompt=${renderedPrompt.length} chars, images=${imageUrls.length}, prev=${body.previousOutputUrl?.slice(0, 80)}…`,
      );
    }

    const result = await generateImage({
      model,
      input: {
        prompt: renderedPrompt,
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
      action: isFeedbackEdit ? "static_ad_feedback_edit" : "static_ad_recreate",
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
        previousOutputUrl: body.previousOutputUrl ?? null,
        mode: isFeedbackEdit ? "feedback_edit" : "recreate",
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
    // Recompute the mode flag in catch scope — the `isFeedbackEdit`
    // local lives in try scope. Keeping logs tagged so we can see at a
    // glance whether the regenerate-with-feedback path is the culprit
    // or the original recreate path is failing.
    const failedMode =
      body.previousOutputUrl && body.feedback?.trim() ? "feedback_edit" : "recreate";
    console.error(
      `[static-ads] ${failedMode} failed for ref ${referenceId}:`,
      err,
    );

    const { code, userMessage, retryable } = classifyRecreateError(rawMsg);

    // Persist the failure (with both the classified code and the raw error)
    // so we can diagnose patterns later. Best-effort — don't block the HTTP
    // response on it.
    try {
      await db.insert(schema.generations).values({
        action: failedMode === "feedback_edit" ? "static_ad_feedback_edit" : "static_ad_recreate",
        kind: "image",
        inputs: {
          productId,
          referenceId,
          angleName,
          language: body.language ?? "en",
          brand: body.brand ?? null,
          feedback: body.feedback ?? null,
          previousOutputUrl: body.previousOutputUrl ?? null,
          mode: failedMode,
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
