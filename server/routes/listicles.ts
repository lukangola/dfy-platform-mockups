/**
 * Listicle Builder routes. Orchestrates the 6-step workflow:
 *   1. Create draft (paste mode) or generate copy (generate mode)
 *   2. Extract offer from destinationUrl
 *   3. Generate per-section image prompts (one per numbered section)
 *   4. Generate images (per-image: approve / regen / regen-with-feedback)
 *   5. Render full HTML via the listicle_lander_html master prompt
 *   6. Deploy to LanderLab (createLander → saveVariantHtml → publish)
 *
 * Endpoints:
 *   POST   /api/listicles                                — create draft
 *   GET    /api/listicles/:id                            — read full state
 *   PATCH  /api/listicles/:id                            — update fields
 *   POST   /api/listicles/:id/extract-offer              — fetch + parse destinationUrl
 *   POST   /api/listicles/:id/generate-copy              — run listicle_copy prompt
 *   POST   /api/listicles/:id/generate-image-prompts     — run listicle_image_prompts
 *   POST   /api/listicles/:id/images/:imageId/generate   — generate one image
 *   PATCH  /api/listicles/:id/images/:imageId            — update approval/feedback
 *   POST   /api/listicles/:id/render-html                — render the full HTML
 *   POST   /api/listicles/:id/deploy                     — push to LanderLab
 */
import https from "node:https";
import { and, asc, eq } from "drizzle-orm";
import { type NextFunction, type Request, type Response, Router } from "express";
import { generateText } from "../lib/anthropic.js";
import { requireAuth } from "../lib/auth.js";
import { canSeeBrand, canSeeListicle } from "../lib/brandAccess.js";
import { db, schema } from "../lib/db.js";
import { generateImage, transcribeAudio, uploadToFalStorage } from "../lib/fal.js";
import { extractJsonObject } from "../lib/jsonExtract.js";
import { buildEditorUrl, buildSlug, createLander, pickPrimaryDomain, publishLander, saveVariantHtml } from "../lib/landerlab.js";
import { loadPrompt } from "../lib/prompts.js";

export const listiclesRouter: Router = Router();

// Every listicle route requires a signed-in user — there is no public
// consumer (the only client callers live in the authed Listicle Builder
// workspace page; the PUBLIC /api/share router never touches listicles).
listiclesRouter.use(requireAuth);

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

/**
 * Gate every /:id route on whether the caller can see the listicle's
 * brand. Same idiom as products.ts's gateByProductAccess: mounted once
 * via `listiclesRouter.use("/:id", ...)` it mechanically covers
 * GET/PATCH /:id plus every nested POST/PATCH (analyze-ad, extract-offer,
 * generate-copy, generate-image-prompts, images/:imageId/*, render-html,
 * deploy) without per-route boilerplate. Denied access AND missing rows
 * both return 404 "Listicle not found" — not 403 — so the existence of a
 * listicle never leaks across brands. Auth is attached upstream by the
 * router-wide requireAuth above.
 */
async function gateByListicleAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.auth) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const { user, role } = req.auth;
  const listicleId = req.params.id;
  if (!listicleId) return next();
  if (!(await canSeeListicle(user.id, role, listicleId))) {
    res.status(404).json({ error: "Listicle not found" });
    return;
  }
  next();
}

listiclesRouter.use("/:id", gateByListicleAccess);

/**
 * Conditional product-reference inclusion for the per-section image
 * generation. The image-prompt master tells NBP to "ignore the attached
 * product image if not needed" but NBP isn't reliable about that — when
 * product pixels are in the input pool, they bleed into outputs even
 * when the section isn't about the product (lifestyle shots, problem
 * shots, etc.).
 *
 * Fix: scan the actual per-section image prompt. If it doesn't mention
 * the product (by name token or by generic packaging noun), pass NO
 * product refs. The image-prompt master already produces clean generic
 * descriptions for non-product sections; without the input pixels
 * there's nothing for NBP to leak.
 */
/**
 * Tokens that look like product-name parts but are too common in English /
 * supplement / beauty copy to be a reliable signal. If the brand is "Beauty
 * Kollagen Wildberry", "beauty" and "wildberry" alone aren't enough — we need
 * the more specific "kollagen" token. Filtering these out prevents the gate
 * from firing on every section of a beauty-supplement listicle.
 */
const COMMON_PRODUCT_NAME_STOPWORDS = new Set([
  "beauty", "natural", "pure", "essence", "wellness", "nature", "natures",
  "premium", "organic", "formula", "system", "complex", "elements", "vitality",
  "active", "advanced", "ultra", "max", "plus", "skin", "hair", "body", "boost",
  "support", "daily", "morning", "night", "berry", "wildberry", "vanilla",
  "chocolate", "original", "classic", "powder", "drink",
]);

/**
 * Strip known boilerplate phrases that the listicle image-prompt master
 * appends to product-in-scene prompts. Without this, the gate's substring
 * scan would see "the product", "the packaging", "the brand name" inside
 * the boilerplate and trigger for every prompt — even prompts that legitimately
 * appended it for unrelated reasons or where the master prompt accidentally
 * leaked the phrasing.
 */
function stripBoilerplate(text: string): string {
  return text
    .replace(/If the product appears in the scene[^.]*\./gi, "")
    .replace(/preserve the original logo, brand name, and all label text[^.]*\./gi, "")
    .replace(/do not invent, alter, translate, or remove any text on the packaging\.?/gi, "")
    .replace(/Do not add any ad copy, captions, headlines, or text overlays to the image\.?/gi, "")
    .replace(/If there is no product image needed[^.]*\./gi, "");
}

/** HTML-escape user copy that we inject directly into a server-built section. */
function escapeForHtml(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Deterministic server-side fallback for sections Claude refuses to
 * render. After the validator + retry both fail to recover a missing
 * section, we construct the section's HTML ourselves using the listicle
 * template's standard class names (matches what the prompt produces) and
 * inject it at the right position in the document.
 *
 * Insertion target, in priority order:
 *   1. Right before the buy-box / offer block (so missing sections sit
 *      between the last rendered section and the closing offer).
 *   2. Right before `</main>` or `</footer>`.
 *   3. Right before `</body>` as a last resort.
 *
 * Sections are inserted in their original numerical order so a missing
 * #7 lands between #6 and #8, not at the very end of the list. (We
 * can't truly interleave without parsing the DOM, but inserting at the
 * insertion target preserves numerical reading order well enough — the
 * H2 reads "7. ..." even if it appears at position #10 in the markup.)
 */
function injectMissingSections(
  html: string,
  missing: number[],
  parsedReasons: { headline: string; body: string }[],
  images: { imageUrl: string | null }[],
  destinationUrl: string,
  primaryHex: string,
): string {
  if (missing.length === 0) return html;
  // Locate insertion point. We try several known markers in order of
  // specificity — the listicle template emits comments like
  // `<!-- BUY BOX -->` consistently, but other templates may not.
  const markers = [
    "<!-- BUY BOX -->",
    "<!--BUY BOX-->",
    '<div class="buy-box-wrap"',
    '<section class="buy-box"',
    '<section data-inana-cta-block',
    '<div class="buybox"',
    "<footer",
    "</main>",
    "</body>",
  ];
  let insertAt = -1;
  for (const m of markers) {
    const idx = html.indexOf(m);
    if (idx > 0 && (insertAt === -1 || idx < insertAt)) insertAt = idx;
  }
  if (insertAt === -1) return html; // can't find anywhere safe to inject

  const safeUrl = escapeForHtml(destinationUrl || "#");
  const safePrimary = escapeForHtml(primaryHex || "#1A1A1A");

  // Build the injected section HTML. Mirrors the listicle template's
  // standard class names (`reason-section`, `h2-section`, `reason-img`,
  // `body-p`). Headlines that contain double-line breaks get split into
  // multiple paragraphs so the layout stays consistent with the
  // Claude-rendered sections.
  const sectionsHtml = missing
    .map((n) => {
      const r = parsedReasons[n - 1];
      if (!r) return "";
      const img = images[n - 1]?.imageUrl ?? "";
      const headline = escapeForHtml(r.headline);
      const bodyParas = r.body
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p class="body-p">${escapeForHtml(p)}</p>`)
        .join("\n  ");
      // CTA microcopy — required on sections #3+. Generic verb so the
      // injected section feels native.
      const ctaLine = n >= 3
        ? `<p class="body-p">👉 <strong><a href="${safeUrl}" style="color:${safePrimary};">See the full routine →</a></strong></p>`
        : "";
      const imgTag = img ? `<img class="reason-img" src="${escapeForHtml(img)}" alt="">` : "";
      return [
        `<!-- REASON ${n} (server-injected fallback — Claude dropped this section in render) -->`,
        `<section class="reason-section">`,
        `  <h2 class="h2-section">${n}. ${headline}</h2>`,
        `  ${imgTag}`,
        `  ${bodyParas}`,
        ctaLine ? `  ${ctaLine}` : "",
        `</section>`,
        ``,
      ].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

  return html.slice(0, insertAt) + sectionsHtml + "\n\n" + html.slice(insertAt);
}

/**
 * Pull every "N. ..." numbered section heading number out of rendered
 * listicle HTML. Tolerant of various heading shapes the model might use:
 *
 *   <h2>1. Headline...</h2>
 *   <h2 class="x">  7. Headline</h2>
 *   <h2><span>11</span>. Headline</h2>  (rare)
 *
 * The regex matches a digit-run at the start of any h2/h3 content, after
 * stripping inner tags. We dedupe so an accidental double-render counts
 * as one. Returns the section numbers in document order.
 */
function extractRenderedSectionNumbers(html: string): number[] {
  const out: number[] = [];
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  const seen = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const inner = (m[1] ?? "").replace(/<[^>]+>/g, "").trim();
    const numMatch = inner.match(/^\s*(\d{1,2})\b/);
    if (!numMatch) continue;
    const n = parseInt(numMatch[1] ?? "0", 10);
    if (n > 0 && n <= 30 && !seen.has(n)) {
      out.push(n);
      seen.add(n);
    }
  }
  return out;
}

/**
 * Given the expected section count (e.g. 11) and the numbers we found in
 * the rendered HTML, return the missing numbers (e.g. [7, 11]). Detects
 * both "skipped middle" and "missing end".
 */
function computeMissingSections(expected: number, rendered: number[]): number[] {
  const have = new Set(rendered);
  const missing: number[] = [];
  for (let i = 1; i <= expected; i++) if (!have.has(i)) missing.push(i);
  return missing;
}

function imagePromptMentionsProduct(text: string, productName: string | null | undefined): boolean {
  if (!text) return false;

  // Strip boilerplate first so we only check the substantive scene
  // description for product mentions. The master prompt appends fixed
  // packaging-preservation language to product-in-scene prompts, and that
  // boilerplate must not contaminate the gate signal.
  const scanText = stripBoilerplate(text);

  // Product-name tokens — strongest signal. Word-boundary regex so "alcami"
  // doesn't match "alcamiform"; common stopwords filtered so single overlap
  // with words like "beauty" or "wellness" doesn't trigger the gate.
  const productNameLower = (productName ?? "").toLowerCase();
  const allTokens = productNameLower
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length >= 4);
  const specificTokens = allTokens.filter((t) => !COMMON_PRODUCT_NAME_STOPWORDS.has(t));

  // Match on a specific (non-stopword) token. If the brand name is entirely
  // common words (e.g. "Pure Elements"), specificTokens will be empty and we
  // fall through to the full-phrase check below.
  if (specificTokens.some((t) => new RegExp(`\\b${t}\\b`, "i").test(scanText))) return true;

  // Full product-name phrase match (case-insensitive, whitespace-tolerant).
  // Catches the case where the prompt says "Pure Elements" as a deliberate
  // phrase even though neither word alone is specific.
  if (productNameLower.length >= 4) {
    const phrasePattern = productNameLower
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    if (new RegExp(`\\b${phrasePattern}\\b`, "i").test(scanText)) return true;
  }

  // Generic packaging nouns + product-category nouns. When the prompt
  // references any of these — even without the brand name — the section
  // is clearly about a consumable product and the model would otherwise
  // invent a competing brand (the AURA-BOTANICS-style hallucination
  // bug). Attaching the product reference image forces the model to
  // use the actual product instead.
  //
  // Curated to avoid false positives from common English words. The
  // category list covers skincare (cleanser/serum/cream/oil/etc.),
  // supplements (powder/capsule/gummy/scoop), beverages (drink/shake/
  // latte/blend), and food (bar/cookie/chew). Add more as new product
  // categories surface.
  const generic = [
    // Packaging nouns
    "the product", "this product", "the packaging", "product packaging",
    "the pouch", "the bag", "the bottle", "the jar", "the sachet",
    "the container", "the label", "the dropper", "the nozzle", "the wrapper",
    "the tube", "the can", "the box", "the stick", "the tin", "the pump",
    "supplement bag", "powder bag", "powder pouch",
    // Skincare category nouns — "the gel cleanser" → product is the cleanser.
    "the cleanser", "the gel cleanser", "the foaming cleanser",
    "the serum", "the moisturizer", "the moisturiser", "the cream",
    "the gel cream", "the face oil", "the body oil", "the toner", "the mist",
    "the spray", "the lotion", "the balm", "the mask", "the patches",
    "the sunscreen", "the spf", "the retinol", "the salicylic", "the eye cream",
    "the kit", "the routine", "the 3-step", "the three-step", "the system",
    // Supplements / wellness
    "the supplement", "the capsule", "the tablet", "the gummy", "the gummies",
    "the scoop", "the powder mix", "the powder blend", "the protein", "the collagen",
    // Beverages / functional drinks
    "the drink", "the shake", "the latte", "the blend", "the brew", "the elixir",
    // Food / snack
    "the bar", "the cookie", "the chew", "the chews",
    // Generic action that requires a product
    "applying the", "applying it", "using the", "scoop of",
  ];
  if (generic.some((g) => new RegExp(`\\b${g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(scanText))) return true;

  // Marker tokens used in master prompts (least-ambiguous fallback).
  if (/@element\d/i.test(scanText) || /@image[3-9]/i.test(scanText)) return true;
  return false;
}

/**
 * Discover real, working policy/legal links from a brand's website footer.
 *
 * Strategy: fetch the origin homepage, scan ALL anchors, find ones whose
 * text OR href slug matches a policy keyword (impressum, datenschutz, agb,
 * widerruf, privacy, terms, refund, legal, imprint, contact, kontakt).
 * Resolve relative URLs to absolute against the origin. Return up to 6
 * unique links — these are the actual published policy pages the brand
 * owns, so the lander we deploy can link to them and they will resolve
 * for end users.
 *
 * Falls back to an empty array on any fetch error — the prompt then just
 * omits the footer link bar instead of rendering broken /policies/* URLs.
 */
async function discoverFooterLinks(originUrl: string): Promise<{ label: string; href: string }[]> {
  try {
    const origin = new URL(originUrl).origin;
    const r = await fetch(origin + "/", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; InanaBot/1.0)" },
    });
    if (!r.ok) return [];
    const html = (await r.text()).slice(0, 200_000);

    // Match every <a href="..." ...>text</a> in the page.
    const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const keywordRe =
      /(impressum|datenschutz|datenschutzerkl|agb|widerruf|widerrufsbelehrung|privacy|terms|refund|legal[- ]?notice|imprint|kontakt|contact|shipping|versand)/i;
    const seen = new Set<string>();
    const found: { label: string; href: string; priority: number }[] = [];

    let m: RegExpExecArray | null;
    while ((m = anchorRe.exec(html)) !== null) {
      const rawHref = m[1].trim();
      const rawText = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (!rawText || rawText.length > 40) continue;
      const haystack = rawHref + " " + rawText;
      if (!keywordRe.test(haystack)) continue;

      let absoluteHref: string;
      try {
        absoluteHref = new URL(rawHref, origin).toString();
      } catch {
        continue;
      }
      // Only same-origin links — we don't want to link to external
      // social profiles, third-party cookie pages, etc.
      if (new URL(absoluteHref).origin !== origin) continue;
      if (seen.has(absoluteHref)) continue;
      seen.add(absoluteHref);

      // Priority order: imprint > privacy > terms > refund > shipping > contact
      const slug = (rawHref + " " + rawText).toLowerCase();
      let priority = 99;
      if (/impressum|imprint|legal[- ]?notice/.test(slug)) priority = 1;
      else if (/datenschutz|privacy/.test(slug)) priority = 2;
      else if (/agb|terms/.test(slug)) priority = 3;
      else if (/widerruf|refund/.test(slug)) priority = 4;
      else if (/shipping|versand/.test(slug)) priority = 5;
      else if (/kontakt|contact/.test(slug)) priority = 6;
      found.push({ label: rawText, href: absoluteHref, priority });
    }

    found.sort((a, b) => a.priority - b.priority);
    return found.slice(0, 6).map(({ label, href }) => ({ label, href }));
  } catch (err) {
    console.warn(`[listicles] discoverFooterLinks failed for ${originUrl}:`, err);
    return [];
  }
}

async function loadListicle(id: string) {
  const [row] = await db
    .select()
    .from(schema.listicles)
    .where(eq(schema.listicles.id, id))
    .limit(1);
  return row ?? null;
}

async function touch(id: string, patch: Partial<schema.Listicle>) {
  await db
    .update(schema.listicles)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.listicles.id, id));
}

// ── CRUD ───────────────────────────────────────────────────────────

listiclesRouter.post("/", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      brandId?: string;
      productId?: string;
      source?: "generate" | "paste";
      language?: string;
      destinationUrl?: string;
      angleName?: string;
      copyMarkdown?: string;
      guidance?: string;
    };
    if (!body.brandId || !body.productId || !body.source) {
      return sendError(res, 400, "brandId, productId, and source are required");
    }
    // Brand gate on the client-supplied brandId — 404 (not 403) so brand
    // existence doesn't leak. Same convention as products/jobs create.
    const { user, role } = req.auth!;
    if (!(await canSeeBrand(user.id, role, body.brandId))) {
      return sendError(res, 404, "Brand not found");
    }
    const [row] = await db
      .insert(schema.listicles)
      .values({
        brandId: body.brandId,
        productId: body.productId,
        source: body.source,
        language: body.language ?? "en",
        destinationUrl: body.destinationUrl?.trim() || null,
        angleName: body.angleName?.trim() || null,
        copyMarkdown: body.copyMarkdown?.trim() || null,
        guidance: body.guidance?.trim() || null,
        status: "drafting",
      })
      .returning();
    res.json({ listicle: row });
  } catch (err) {
    console.error("[listicles] create failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

listiclesRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const row = await loadListicle(req.params.id);
    if (!row) return sendError(res, 404, "Listicle not found");
    const images = await db
      .select()
      .from(schema.listicleImages)
      .where(eq(schema.listicleImages.listicleId, row.id))
      .orderBy(asc(schema.listicleImages.sectionIdx));
    res.json({ listicle: row, images });
  } catch (err) {
    console.error("[listicles] read failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

listiclesRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const row = await loadListicle(req.params.id);
    if (!row) return sendError(res, 404, "Listicle not found");

    // Whitelist of fields the client may update. Pipeline-generated fields
    // (status, landerlab IDs, URLs, error) are server-controlled.
    const allowed = [
      "copyMarkdown",
      "angleName",
      "guidance",
      "destinationUrl",
      "htmlFeedback",
      "language",
      // Winning-ad workflow: the editable analysis preview lets the user
      // tweak what Claude extracted before generating the listicle copy.
      "winningAdAnalysis",
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in req.body) patch[k] = req.body[k];
    }
    if (Object.keys(patch).length === 0) {
      return sendError(res, 400, "No editable fields supplied");
    }
    await touch(row.id, patch);
    const updated = await loadListicle(row.id);
    res.json({ listicle: updated });
  } catch (err) {
    console.error("[listicles] patch failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── Winning-ad workflow: analyze uploaded ad ──────────────────────
//
// Used by the "Build from a winning ad" mode. Client uploads a video
// (.mp4/.mov) or static (.jpg/.png) ad as a base64 dataUrl. We:
//   1. Decode + upload the file to fal.storage so we have a stable URL
//      to (a) feed to fal whisper (video) or Claude vision (static)
//      and (b) replay back to the user.
//   2. For video: run fal-ai/whisper on the audio track → transcript.
//      For static: skip transcription; the image itself is the input.
//   3. Run prompts/ad_extract_angle.md to pull the structured angle
//      (primary_angle_name, hook, mechanism, target_pain, key_claims[],
//      tone, creative_format, summary) so the listicle copy generator
//      can later open the article with sections that mirror the ad.
//   4. Persist winningAdUrl / winningAdType / winningAdTranscript /
//      winningAdAnalysis on the listicle row. Return analysis to client
//      so the user can review + tweak it in the UI before continuing.

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], "base64") };
}

listiclesRouter.post("/:id/analyze-ad", async (req: Request, res: Response) => {
  try {
    const row = await loadListicle(req.params.id);
    if (!row) return sendError(res, 404, "Listicle not found");

    const body = req.body as {
      dataUrl?: string;
      filename?: string;
    };
    if (!body.dataUrl) return sendError(res, 400, "dataUrl is required");
    const decoded = decodeDataUrl(body.dataUrl);
    if (!decoded) return sendError(res, 400, "dataUrl is not a valid base64 data URL");
    const { buffer, mime } = decoded;
    const filename = body.filename ?? `ad-${Date.now()}`;

    // Determine ad type from MIME. Anything video/* or audio/* uses the
    // transcription path; image/* uses the Claude-vision path. We reject
    // everything else.
    const adType: "video" | "static" =
      mime.startsWith("video/") || mime.startsWith("audio/")
        ? "video"
        : mime.startsWith("image/")
          ? "static"
          : (() => {
              throw new Error(`Unsupported MIME for ad upload: ${mime}`);
            })();

    await touch(row.id, { status: "analyzing", error: null });

    // 1) Upload to fal.storage for stable URL.
    const adUrl = await uploadToFalStorage(buffer, mime, filename);

    // 2) Transcribe if video, else pass image straight to the prompt.
    let transcript: string | null = null;
    if (adType === "video") {
      try {
        const t = await transcribeAudio({ audioUrl: adUrl });
        transcript = t.text || null;
      } catch (err) {
        // If transcription fails we don't kill the whole flow — Claude
        // can still try to read the static frames via vision. Log and
        // continue with empty transcript.
        console.warn(`[listicles] fal whisper failed for ${adUrl}:`, err);
      }
    }

    // 3) Load brand + product context for the prompt.
    const [product] = await db.select().from(schema.products).where(eq(schema.products.id, row.productId)).limit(1);
    const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, row.brandId)).limit(1);
    // Brand description for the angle extractor: prefer pulling the
    // Brand Overview section out of the new guidelines markdown
    // (single source of truth). Falls back to the legacy
    // research.description for brands not yet re-extracted.
    const brandDescription = brand?.guidelinesMarkdown
      ? brand.guidelinesMarkdown
          .split(/^## 2\./m)[0]
          ?.replace(/^# [^\n]*\n/, "")
          .replace(/^>.*$/gm, "")
          .trim()
          .slice(0, 800)
        ?? ""
      : ((brand?.research ?? {}) as { description?: string }).description ?? "";

    // 4) Extract angle via Claude. For static ads we attach the image
    //    URL so Claude vision can read it. For video we just hand over
    //    the transcript text.
    const prompt = loadPrompt("ad_extract_angle", {
      ad_type: adType,
      product_name: product?.name ?? "",
      product_category: product?.category ?? "",
      brand_description: brandDescription,
      ad_content: adType === "video"
        ? (transcript?.trim() || "(no transcript available — transcription failed or audio had no speech)")
        : "(see attached image)",
    });

    const result = await generateText({
      systemPrompt: prompt.rendered,
      userMessage: "Extract the marketing angle from the ad above. Return ONLY the JSON object.",
      model: prompt.config.model,
      maxTokens: prompt.config.maxTokens ?? 2000,
      ...(adType === "static" ? { imageUrls: [adUrl] } : {}),
    });

    let analysis: Record<string, unknown> = {};
    try {
      analysis = extractJsonObject<Record<string, unknown>>(result.text, {
        stopReason: result.stopReason,
        action: "ad_extract_angle",
      });
    } catch (err) {
      console.error(
        `[listicles] ad_extract_angle parse failed for listicle ${row.id}.\n` +
        `stop_reason=${result.stopReason} tokensOut=${result.tokensOut}\n` +
        `RAW OUTPUT:\n${result.text}`
      );
      throw err;
    }

    await touch(row.id, {
      winningAdUrl: adUrl,
      winningAdType: adType,
      winningAdTranscript: transcript,
      winningAdAnalysis: analysis,
      // Mirror the primary angle name onto the canonical angleName field so
      // downstream UI + render still shows a single source of truth.
      angleName: (analysis.primary_angle_name as string) ?? row.angleName,
      status: "drafting",
      error: null,
    });

    res.json({
      adUrl,
      adType,
      transcript,
      analysis,
    });
  } catch (err) {
    console.error("[listicles] analyze-ad failed:", err);
    await touch(req.params.id, { status: "failed", error: err instanceof Error ? err.message : String(err) }).catch(() => {});
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── Step: extract offer from destinationUrl ───────────────────────

listiclesRouter.post("/:id/extract-offer", async (req: Request, res: Response) => {
  try {
    const row = await loadListicle(req.params.id);
    if (!row) return sendError(res, 404, "Listicle not found");
    if (!row.destinationUrl) return sendError(res, 400, "No destinationUrl set on this listicle");

    // Fetch the destination page. We tolerate failures gracefully —
    // a sensible-but-empty offer object is OK, the user can still ship.
    //
    // We keep the FULL HTML on `pageHtmlFull` for the discount badge
    // scan (Alcami's discount badges sit beyond the 50K mark — slicing
    // for Claude before scanning misses them). The `pageContent` we
    // hand to the LLM is still capped at 50K to keep the prompt within
    // model context limits.
    let pageHtmlFull = "";
    let pageContent = "";
    try {
      const r = await fetch(row.destinationUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; InanaBot/1.0)" },
      });
      pageHtmlFull = await r.text();
      pageContent = pageHtmlFull.slice(0, 50_000); // cap at 50K chars for the LLM
    } catch (err) {
      console.warn(`[listicles] failed to fetch destinationUrl ${row.destinationUrl}:`, err);
    }

    if (!pageContent) {
      // Offer that's not extractable from URL — record null offer but
      // don't fail. User can manually edit the listicle copy later.
      await touch(row.id, { offerExtract: { raw_offer_summary: null } });
      return res.json({ offer: { raw_offer_summary: null } });
    }

    // SHOPIFY DETERMINISTIC PRICING FACT-CHECK
    //
    // The HTML alone is unreliable for discount extraction — Shopify product
    // pages render pricing in JS, so the raw HTML contains lots of percent
    // values (15%, 20%, 30%, 40% across variants, plus unrelated noise) and
    // no single headline "X% off" number. Claude tends to confabulate a
    // number that "feels right" rather than pulling one verbatim.
    //
    // Shopify exposes the canonical product data at `<product-url>.json`
    // (no auth required, public). We fetch it, compute the actual max
    // discount across all variants (Math.round((1 - price/compare) * 100)),
    // and feed that as a verified fact to the offer_extract prompt — so
    // Claude can't invent a different number.
    //
    // We ALSO capture the maxDiscount in a separate variable so that AFTER
    // the offer_extract call we can override Claude's output if it ignored
    // the verified number. Belt-and-suspenders: the prompt asks Claude to
    // use it, and we double-check the JSON he returned, replacing any
    // smaller number with the verified MAX.
    let pricingFacts = "";
    let verifiedMaxDiscount = 0;
    // Node's built-in fetch() is undici-based and sends a fingerprint
    // (Accept-Encoding: br/gzip + others) that Shopify's geo-routing
    // uses to serve a different storefront — for Blume specifically
    // it returns the US store JSON (no compare_at_price) instead of
    // the canonical international store ($75 / $132 → 43% off).
    // `https.request` doesn't trigger that routing, so we use it for
    // the .json fetch. Same data, same TLS, just consistent storefront.
    const fetchShopifyJsonRaw = (url: string): Promise<unknown> =>
      new Promise((resolve, reject) => {
        try {
          const u = new URL(url);
          const req = https.request({
            method: "GET",
            hostname: u.hostname,
            path: u.pathname + u.search,
            timeout: 8000,
            headers: { "User-Agent": "Mozilla/5.0 (compatible; InanaBot/1.0)", Accept: "*/*" },
          }, (res) => {
            let body = "";
            res.on("data", (c) => { body += c; });
            res.on("end", () => {
              try { resolve(JSON.parse(body)); }
              catch (e) { reject(e); }
            });
          });
          req.on("error", reject);
          req.on("timeout", () => { req.destroy(new Error("shopify json fetch timeout")); });
          req.end();
        } catch (e) { reject(e); }
      });
    try {
      const m = row.destinationUrl.match(/^(.+\/products\/[^/?#]+)/);
      if (m) {
        const jsonUrl = m[1] + ".json";
        // NOTE: deliberately uses fetchShopifyJsonRaw (https.request),
        // NOT global fetch(). Node's undici-based fetch triggers
        // Shopify's geo-routing and serves the US storefront for many
        // CA/EU brands — that storefront often has no compare_at_price
        // even when the canonical international storefront does (Blume
        // is the canonical example: US returns $66.95 / no discount,
        // international returns $75 / $132 = 43% off).
        let productJson: {
          product?: {
            variants?: { title?: string; price?: string | number; compare_at_price?: string | number | null }[];
          };
        } = {};
        try {
          productJson = await fetchShopifyJsonRaw(jsonUrl) as typeof productJson;
        } catch (rawErr) {
          // Fallback to fetch if the raw https request fails for any
          // reason (cert, DNS) — at least we get SOMETHING.
          console.warn(`[listicles] raw https fetch failed for ${jsonUrl}, falling back to fetch():`, rawErr);
          const jr = await fetch(jsonUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; InanaBot/1.0)" },
          });
          if (jr.ok) productJson = await jr.json() as typeof productJson;
        }
        if (productJson?.product) {
          const variants = productJson.product?.variants ?? [];
          const rows: string[] = [];
          let maxDiscount = 0;
          for (const v of variants) {
            const price = typeof v.price === "string" ? parseFloat(v.price) : (v.price ?? 0);
            const compare =
              v.compare_at_price == null
                ? 0
                : typeof v.compare_at_price === "string"
                  ? parseFloat(v.compare_at_price)
                  : v.compare_at_price;
            const discount = compare > 0 && price > 0 ? Math.round((1 - price / compare) * 100) : 0;
            if (discount > maxDiscount) maxDiscount = discount;
            rows.push(`  - ${v.title ?? "(untitled)"}: price=${price}, compare_at=${compare || "(none)"}, discount=${discount}%`);
          }
          if (variants.length > 0) {
            verifiedMaxDiscount = maxDiscount;
            pricingFacts =
              `\n\n## VERIFIED SHOPIFY PRICING (canonical — use this, not your interpretation of the HTML)\n\n` +
              `Variants:\n${rows.join("\n")}\n\n` +
              `**MAX DISCOUNT ACROSS ALL VARIANTS: ${maxDiscount}%**\n\n` +
              `Use exactly ${maxDiscount}% in the discount_label (the canonical headline % for a "Bis zu X%" / "Up to X%" message). ` +
              `If max discount is 0, return null for discount_label — do NOT invent one.\n`;
            console.log(`[listicles] Shopify pricing fact-check: max discount = ${maxDiscount}% across ${variants.length} variants`);
          }
        }
      }
    } catch (err) {
      console.warn(`[listicles] Shopify .json fetch failed (non-fatal):`, err);
    }

    // SECOND-PASS HTML SCAN — for visible discount badges (e.g. quantity
    // discounts "15% OFF / 20% OFF / 25% OFF", subscription savings
    // "subscribe & save 24%", banner promos "29% OFF") that aren't
    // exposed in the product's .json variant `compare_at_price` or
    // `selling_plan_groups`. Many Shopify brands use third-party apps
    // (ReBuy, Stay AI, Bold Subscriptions, Booster Bundle Discounts,
    // etc.) that render their discount badges directly in the page
    // HTML and never write to the canonical pricing fields.
    //
    // Triggered when the .json fact-check found 0% discount but the
    // rendered HTML clearly advertises a percent off. We pick the MAX
    // % found, capped at 90% as a sanity ceiling.
    //
    // Filtering — to avoid false positives like "30% protein", "20% of
    // customers", "10% body fat reduction", we ONLY match when the
    // percentage is paired with a discount-context word: "off",
    // "discount", "save", "savings", "rabatt", "sparen", "réduction",
    // "ahorra", "subscribe".
    if (verifiedMaxDiscount === 0) {
      // Scan the FULL HTML (not the 50K slice). Alcami specifically
      // renders its discount badges past the 50K mark — slicing first
      // makes us miss them entirely. Scanning is a cheap regex pass.
      const htmlScanned = pageHtmlFull || pageContent;
      const candidates: { pct: number; matched: string }[] = [];
      const patterns: RegExp[] = [
        // "15% OFF", "25% off!", "Up to 50% off"
        /\b(\d{1,2})\s*%\s*off\b/gi,
        /\b(\d{1,2})\s*%\s*discount\b/gi,
        // Subscribe & save 24% / Save 20% / Save up to 30%
        /\bsave\s+(?:up\s+to\s+)?(\d{1,2})\s*%/gi,
        /\bsubscribe\s*(?:&|and)\s*save\s*(?:up\s+to\s+)?(\d{1,2})\s*%/gi,
        // German
        /\b(\d{1,2})\s*%\s*rabatt\b/gi,
        /\bbis\s+zu\s+(\d{1,2})\s*%/gi,
        /\bspare\s+(\d{1,2})\s*%/gi,
        // French / Spanish
        /\b(\d{1,2})\s*%\s*de?\s*r[ée]duction\b/gi,
        /\b(\d{1,2})\s*%\s*de?\s*descuento\b/gi,
        /\bahorra\s+(\d{1,2})\s*%/gi,
      ];
      for (const re of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(htmlScanned)) !== null) {
          const pct = parseInt(m[1] ?? "0", 10);
          if (pct >= 5 && pct <= 90) candidates.push({ pct, matched: m[0] });
        }
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.pct - a.pct);
        const top = candidates[0]!;
        verifiedMaxDiscount = top.pct;
        pricingFacts =
          (pricingFacts || "") +
          `\n\n## VERIFIED PAGE-HTML DISCOUNT SCAN (no .json compare_at; found visible discount badges)\n\n` +
          `Highest discount badge in page HTML: **${top.pct}%** (matched: "${top.matched.trim()}")\n\n` +
          `All discount matches found, max first:\n${candidates.slice(0, 8).map((c) => `  - ${c.pct}% ("${c.matched.trim()}")`).join("\n")}\n\n` +
          `**Use exactly ${top.pct}% in discount_label.** Format: "Up to ${top.pct}% off". This is the brand's highest visible discount badge, verified by direct text match on the page HTML.\n`;
        console.log(
          `[listicles] HTML discount scan: max = ${top.pct}% (matched "${top.matched.trim()}", total candidates ${candidates.length})`,
        );
      }
    }

    const prompt = loadPrompt("offer_extract", { page_content: pageContent + pricingFacts });
    const result = await generateText({
      systemPrompt: prompt.rendered,
      userMessage: "Extract the offer from the page content above. Return only JSON.",
      model: prompt.config.model,
      maxTokens: prompt.config.maxTokens ?? 2000,
    });

    let parsed: Record<string, unknown> = {};
    try {
      parsed = extractJsonObject<Record<string, unknown>>(result.text, {
        stopReason: result.stopReason,
        action: "offer_extract",
      });
    } catch (err) {
      console.error(
        `[listicles] offer_extract parse failed.\n` +
        `stop_reason=${result.stopReason} tokensOut=${result.tokensOut}\n` +
        `RAW OUTPUT:\n${result.text}`
      );
      // Offer extract is non-fatal — listicle generation can continue
      // with an empty offer object. Swallow + leave parsed = {}.
    }

    // POST-EXTRACT OVERRIDE: when the Shopify .json fact-check found a
    // verified max discount, force discount_label + raw_offer_summary to
    // reflect it. Some Claude runs ignore the prompt's "use exactly N%"
    // instruction and pick a smaller variant-specific number out of the
    // raw HTML — this guarantees we always advertise the MAX possible
    // discount (which is what every downstream tool — announcement bar,
    // CTA, savings ribbon — should align on).
    if (verifiedMaxDiscount > 0) {
      const parsedLabel = typeof parsed.discount_label === "string" ? parsed.discount_label : "";
      const parsedPercent = parsedLabel.match(/(\d{1,3})\s*%/)?.[1];
      const parsedNum = parsedPercent ? parseInt(parsedPercent, 10) : 0;
      if (!parsedLabel || parsedNum < verifiedMaxDiscount) {
        const correctedLabel = `Up to ${verifiedMaxDiscount}% off`;
        console.log(
          `[listicles] discount override: model said "${parsedLabel || "(empty)"}" (${parsedNum}%), corrected to "${correctedLabel}" (verified max ${verifiedMaxDiscount}%)`,
        );
        parsed.discount_label = correctedLabel;
        // Also patch raw_offer_summary so the listicle copy generator
        // gets the right number in the offer hint.
        const existingSummary = typeof parsed.raw_offer_summary === "string" ? parsed.raw_offer_summary : "";
        if (existingSummary) {
          parsed.raw_offer_summary = existingSummary.replace(/\bUp to \d{1,3}\s*%/i, `Up to ${verifiedMaxDiscount}%`);
          // If the summary didn't have a "Up to X%" phrase at all, prefix it.
          if (!/\d{1,3}\s*%/.test(parsed.raw_offer_summary as string)) {
            parsed.raw_offer_summary = `Up to ${verifiedMaxDiscount}% off — ${existingSummary}`;
          }
        } else {
          parsed.raw_offer_summary = `Up to ${verifiedMaxDiscount}% off`;
        }
      }
    }

    await touch(row.id, { offerExtract: parsed });
    res.json({ offer: parsed });
  } catch (err) {
    console.error("[listicles] extract-offer failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── Step: generate the listicle copy (calls existing listicle_copy prompt) ──

listiclesRouter.post("/:id/generate-copy", async (req: Request, res: Response) => {
  try {
    const row = await loadListicle(req.params.id);
    if (!row) return sendError(res, 404, "Listicle not found");

    // Optional feedback for the "regenerate with feedback" path. When
    // present, we pass the user's notes + the current copy as a
    // previous-draft block into the prompt so the model can revise the
    // existing copy rather than start from scratch. Empty string =
    // first-time generation (or a clean from-scratch regen). Same
    // convention as the b-roll / image-feedback flows.
    const feedbackInput = typeof (req.body as { feedback?: unknown })?.feedback === "string"
      ? ((req.body as { feedback: string }).feedback).trim()
      : "";

    // Look up product + brand + angle for prompt variables. The angle is
    // free-form (string) so users can supply a custom name if the brand
    // doesn't have a structured angle that matches.
    const [product] = await db.select().from(schema.products).where(eq(schema.products.id, row.productId)).limit(1);
    if (!product) return sendError(res, 404, "Linked product not found");
    const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, row.brandId)).limit(1);
    if (!brand) return sendError(res, 404, "Linked brand not found");

    const angleBlock = (() => {
      if (!row.angleName) return "(no specific angle — write a strong general listicle for this product)";
      const angles = (product.research as { angles?: { name: string; block: string }[] })?.angles ?? [];
      const match = angles.find((a) => a.name === row.angleName);
      return match ? `${match.name}\n\n${match.block}` : row.angleName;
    })();

    const offer = (row.offerExtract as { raw_offer_summary?: string } | null)?.raw_offer_summary
      ?? "(no offer details — write a strong CTA but don't invent specific discounts)";

    // Brand context for the listicle copy generator. Prefer the new
    // single-source-of-truth guidelines markdown (carries voice, tone,
    // do's & don'ts — much richer than the old description+tone pair).
    // Falls back to the legacy `research` fields for brands not yet
    // re-extracted under the new pipeline.
    const brandContext = brand.guidelinesMarkdown
      ? [
          brand.name ? `Name: ${brand.name}` : null,
          brand.brandUrl ? `URL: ${brand.brandUrl}` : null,
          "",
          "Brand Guidelines (style, voice, palette, do's & don'ts):",
          "",
          brand.guidelinesMarkdown.trim(),
        ].filter((s) => s !== null).join("\n")
      : [
          brand.name ? `Name: ${brand.name}` : null,
          brand.brandUrl ? `URL: ${brand.brandUrl}` : null,
          (brand.research as { tone?: string })?.tone ? `Tone: ${(brand.research as { tone?: string }).tone}` : null,
          (brand.research as { description?: string })?.description ? `Description: ${(brand.research as { description?: string }).description}` : null,
        ].filter(Boolean).join("\n");

    // Winning-ad context (only when source === "winning_ad"). Build the
    // structured block the prompt expects + a list of the brand's OTHER
    // research angles to use as catch-all coverage in the later sections.
    const isWinningAd = row.source === "winning_ad" && !!row.winningAdAnalysis;
    const winningAdAnalysis = (row.winningAdAnalysis ?? {}) as {
      primary_angle_name?: string;
      hook?: string;
      mechanism?: string;
      target_pain?: string;
      key_claims?: string[];
      tone?: string;
      creative_format?: string;
      summary?: string;
    };
    const winningAdAngleBlock = isWinningAd
      ? [
          `Primary angle: ${winningAdAnalysis.primary_angle_name ?? "(missing)"}`,
          `Hook (first 5 seconds / above-the-fold): ${winningAdAnalysis.hook ?? "(missing)"}`,
          `Mechanism: ${winningAdAnalysis.mechanism ?? "(missing)"}`,
          `Target pain: ${winningAdAnalysis.target_pain ?? "(missing)"}`,
          `Key claims:\n${(winningAdAnalysis.key_claims ?? []).map((c) => `  - ${c}`).join("\n") || "  - (none extracted)"}`,
          `Tone: ${winningAdAnalysis.tone ?? "(unspecified)"}`,
          `Creative format: ${winningAdAnalysis.creative_format ?? "(unspecified)"}`,
        ].join("\n")
      : "(not applicable — this listicle isn't tied to a specific winning ad)";

    // "Other angles" block — the brand's broader research angles that
    // aren't the winning-ad angle. Used as catch-all material in
    // sections #4-#10 of the winning-ad flow. We pull from
    // product.research.angles (already populated by the DFY Research
    // workflow) and exclude the one whose name matches the winning ad's
    // primary angle (if any match).
    const allAngles = ((product.research as { angles?: { name: string; block: string }[] })?.angles ?? []);
    const winningAdAngleName = (winningAdAnalysis.primary_angle_name ?? "").toLowerCase();
    const otherAngles = isWinningAd
      ? allAngles.filter((a) => a.name.toLowerCase() !== winningAdAngleName)
      : [];
    const otherAnglesBlock = isWinningAd
      ? otherAngles.length > 0
        ? otherAngles.map((a) => `### ${a.name}\n${a.block}`).join("\n\n")
        : "(no other research angles available — write the catch-all sections in the brand's voice without a pre-defined angle)"
      : "(not applicable — only used in the winning-ad workflow)";

    const prompt = loadPrompt("listicle_copy", {
      product: product.name,
      angle: angleBlock,
      brand_context: brandContext || "(no brand context available)",
      offer,
      // Destination URL drives every CTA link target in the rendered
      // markdown — both the per-section `👉` microcopy and the final
      // offer block button. Fall back to "#" if the user didn't paste
      // one (which shouldn't happen on the Listicle Builder, but the
      // shared Copy Engine path passes "#" too — see CopyEngineAppPage).
      destination_url: row.destinationUrl?.trim() || "#",
      language: row.language,
      guidance: row.guidance?.trim() || "(no extra guidance)",
      // When feedback is supplied, we ALSO inject the current
      // copyMarkdown as the "previous draft" so the model has the
      // exact text it should revise. The prompt's feedback block
      // says: "apply this on top of everything above — keep the rest
      // of the listicle intact and only adjust what's called out".
      feedback: feedbackInput && row.copyMarkdown
        ? `${feedbackInput}\n\n--- Previous draft to revise ---\n\n${row.copyMarkdown.trim()}`
        : "(no prior draft to revise)",
      // Winning-ad variables — "no" when not in that flow so the prompt's
      // conditional routing rules stay dormant.
      winning_ad_present: isWinningAd ? "yes" : "no",
      winning_ad_angle_block: winningAdAngleBlock,
      winning_ad_summary: isWinningAd ? winningAdAnalysis.summary ?? "(no summary available)" : "(not applicable)",
      other_angles_block: otherAnglesBlock,
    });

    const result = await generateText({
      systemPrompt: prompt.rendered,
      userMessage: "Write the listicle now. Follow every rule above. Output only the listicle Markdown.",
      model: prompt.config.model,
      maxTokens: prompt.config.maxTokens ?? 8000,
    });
    let copyMd = result.text;

    // SECTION-COUNT VALIDATION + RETRY (copy step).
    //
    // The prompt instructs the model to write exactly 11 numbered
    // sections, with the H1 reading "11 Reasons...". The model
    // occasionally writes the H1 correctly (advertising 11) but
    // produces only 10 sections in the body — leaving the downstream
    // HTML render's section-count validator with `expected=10`
    // (because it counts sections in the markdown). Result: a lander
    // whose H1 promises 11 reasons but only has 10 sections.
    //
    // Fix: count sections in the markdown right here, BEFORE we
    // persist. If short, retry ONCE with explicit feedback naming the
    // missing section numbers. Bounded by one retry to keep latency
    // sane — the deterministic HTML-render fallback (server-side
    // section injection) is the final safety net.
    const EXPECTED_SECTIONS = 11;
    const countSections = (md: string): number =>
      (md.match(/^[#]{3,4}\s+\d+\./gm) ?? []).length;
    const initialCount = countSections(copyMd);
    if (initialCount < EXPECTED_SECTIONS) {
      const presentNums: number[] = [];
      const numRe = /^[#]{3,4}\s+(\d+)\./gm;
      let nm: RegExpExecArray | null;
      while ((nm = numRe.exec(copyMd)) !== null) {
        const n = parseInt(nm[1] ?? "0", 10);
        if (n > 0) presentNums.push(n);
      }
      const missingNums: number[] = [];
      for (let n = 1; n <= EXPECTED_SECTIONS; n++) {
        if (!presentNums.includes(n)) missingNums.push(n);
      }
      console.warn(
        `[listicles] generate-copy: wrote ${initialCount}/${EXPECTED_SECTIONS} sections (numbers: ${presentNums.join(", ")}); missing: ${missingNums.join(", ")} — retrying`,
      );
      try {
        const fixupResult = await generateText({
          systemPrompt: prompt.rendered,
          userMessage:
            `Your previous draft wrote only ${initialCount} numbered sections out of the required ${EXPECTED_SECTIONS}. ` +
            `Missing section number(s): ${missingNums.join(", ")}. ` +
            `Re-write the COMPLETE listicle with ALL ${EXPECTED_SECTIONS} numbered sections this time. ` +
            `Each missing section needs its own ### heading with its number, body copy, and (for #3+) the 👉 CTA microcopy line. ` +
            `The H1 already says "${EXPECTED_SECTIONS} Reasons" — the body must match that count. ` +
            `Output the FULL markdown from the pre-headline callout through the offer block, not just the missing sections. ` +
            `Before you finish, COUNT your "### N." headings — must be exactly ${EXPECTED_SECTIONS}.`,
          model: prompt.config.model,
          maxTokens: prompt.config.maxTokens ?? 8000,
        });
        const fixupCount = countSections(fixupResult.text);
        if (fixupCount > initialCount) {
          copyMd = fixupResult.text;
          console.log(`[listicles] generate-copy retry: now have ${fixupCount}/${EXPECTED_SECTIONS} sections`);
        } else {
          console.warn(`[listicles] generate-copy retry did not improve (still ${fixupCount}/${EXPECTED_SECTIONS}); keeping first draft`);
        }
      } catch (retryErr) {
        console.warn(`[listicles] generate-copy retry threw (non-fatal):`, retryErr);
      }
    } else {
      console.log(`[listicles] generate-copy: wrote ${initialCount}/${EXPECTED_SECTIONS} sections (complete)`);
    }

    await touch(row.id, { copyMarkdown: copyMd, status: "drafting" });
    res.json({ copyMarkdown: copyMd });
  } catch (err) {
    console.error("[listicles] generate-copy failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── Step: generate per-section image prompts ──────────────────────

/**
 * Parses the listicle markdown for numbered section headlines (the
 * `### N. Headline` lines from the listicle_copy format), then runs the
 * listicle_image_prompts master prompt to get N image prompts in
 * `*`-separated form. Persists one row in `listicle_images` per section
 * so the frontend can manage approval state per image.
 */
listiclesRouter.post("/:id/generate-image-prompts", async (req: Request, res: Response) => {
  try {
    const row = await loadListicle(req.params.id);
    if (!row) return sendError(res, 404, "Listicle not found");
    if (!row.copyMarkdown) return sendError(res, 400, "No copy to extract from. Generate or paste the listicle first.");

    // Parse section headlines from the markdown — matches `### 1. Headline`
    // through `### 99. Headline`. Tolerates leading whitespace and bold
    // wrapping.
    const sectionRe = /^[ \t]*#{3,4}[ \t]+(\d+)\.\s+(.+?)$/gm;
    const sections: { idx: number; headline: string }[] = [];
    let m;
    while ((m = sectionRe.exec(row.copyMarkdown)) !== null) {
      sections.push({ idx: Number(m[1]), headline: m[2].replace(/[*_]/g, "").trim() });
    }
    if (sections.length === 0) {
      return sendError(res, 422, "Could not find any numbered sections (### N. Headline) in the copy");
    }

    // Run the image-prompts generator on the full markdown — its prompt
    // tells the model to produce one image suggestion per bullet point,
    // separated by `*`.
    const prompt = loadPrompt("listicle_image_prompts", { copy_markdown: row.copyMarkdown });
    const result = await generateText({
      systemPrompt: prompt.rendered,
      userMessage: "Output the image prompts now. One per bullet point, separated by *.",
      model: prompt.config.model,
      maxTokens: prompt.config.maxTokens ?? 8000,
    });
    const prompts = result.text
      .split(/\n\*\s*\n|\n\*\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (prompts.length === 0) {
      return sendError(res, 502, "Image prompt writer returned no prompts");
    }

    // Replace any existing rows (clean slate per regeneration).
    await db.delete(schema.listicleImages).where(eq(schema.listicleImages.listicleId, row.id));
    const inserts = sections.map((s, i) => ({
      listicleId: row.id,
      sectionIdx: s.idx,
      sectionHeadline: s.headline,
      imagePrompt: prompts[i] ?? null,
      imageStatus: "idle" as const,
      imageApproval: "pending" as const,
    }));
    const inserted = await db.insert(schema.listicleImages).values(inserts).returning();
    await touch(row.id, { status: "images" });
    res.json({ images: inserted });
  } catch (err) {
    console.error("[listicles] generate-image-prompts failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── Step: generate a single image (with optional feedback) ────────

listiclesRouter.post("/:id/images/:imageId/generate", async (req: Request, res: Response) => {
  try {
    const listicleRow = await loadListicle(req.params.id);
    if (!listicleRow) return sendError(res, 404, "Listicle not found");
    const [imgRow] = await db
      .select()
      .from(schema.listicleImages)
      .where(and(
        eq(schema.listicleImages.id, req.params.imageId),
        eq(schema.listicleImages.listicleId, listicleRow.id),
      ))
      .limit(1);
    if (!imgRow) return sendError(res, 404, "Image not found");
    if (!imgRow.imagePrompt) return sendError(res, 400, "Image has no prompt to render");

    const feedback = (req.body?.feedback as string | undefined)?.trim();
    const [product] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, listicleRow.productId))
      .limit(1);
    const allProductRefs = product
      ? [product.productImageUrl, product.productBackImageUrl, product.contentImageUrl].filter((u): u is string => !!u)
      : [];

    const productMentioned = imagePromptMentionsProduct(imgRow.imagePrompt, product?.name);
    const productRefs = productMentioned ? allProductRefs : [];

    await db
      .update(schema.listicleImages)
      .set({ imageStatus: "generating", imageError: null })
      .where(eq(schema.listicleImages.id, imgRow.id));

    try {
      // Feedback path: use the focused rework prompt (same as character b-roll
      // image feedback path), passing the prior image first as the edit
      // source. Otherwise: fresh generation with the original prompt.
      //
      // In-flight prompt sanitizer: earlier versions of the image-prompt
      // generator appended "Don't include any written copy in the image."
      // which NBP/edit (correctly) interpreted as "strip ALL text, including
      // the product packaging branding" — producing blank generic pouches
      // instead of the real product. We replace that legacy suffix with the
      // corrected guidance so cached image rows on older listicles benefit
      // from the fix on Regen without needing to restart from step 1.
      const sanitizePrompt = (text: string): string => {
        if (!text) return text;
        const legacyRe = /Don'?t include any written copy in the image\.?/gi;
        if (!legacyRe.test(text)) return text;
        return text.replace(
          legacyRe,
          "Do not add any ad copy, captions, headlines, or text overlays to the image. If the product appears in the scene, keep the packaging exactly as shown in the reference image — preserve the original logo, brand name, and all label text verbatim; do not invent, alter, translate, or remove any text on the packaging."
        );
      };
      let finalPrompt = sanitizePrompt(imgRow.imagePrompt);
      let imageUrls: string[];
      if (feedback && imgRow.imageUrl) {
        const reworkPrompt = loadPrompt("character_broll_image_feedback", { feedback });
        finalPrompt = reworkPrompt.rendered;
        imageUrls = [imgRow.imageUrl, ...productRefs];
      } else {
        imageUrls = productRefs;
      }

      // Anti-hallucination guard. When we're sending the prompt to the
      // text-to-image model WITHOUT product reference images, the model
      // is free to invent any product that fits the scene — that's how
      // we ended up with "AURA BOTANICS Gel Cleanser" appearing in a
      // Blume listicle. Append a strict NO-PRODUCT rule that explicitly
      // forbids any commercial product, bottle, tube, container, or
      // brand-bearing object from appearing in the frame. The model can
      // still render hands, hair, water, lather, soap suds, droplets —
      // just no product container that could be mistaken for a
      // competitor's packaging.
      //
      // We append the guard at runtime (not only in the prompt that
      // produced the imagePrompt) so it benefits cached / older
      // listicle image rows on every Regen — no need to start from
      // step 1.
      if (productRefs.length === 0) {
        finalPrompt = `${finalPrompt}\n\nSTRICT NO-PRODUCT RULE — render NOTHING that could be mistaken for a commercial product. NO bottle, tube, jar, pump, dropper, sachet, pouch, can, tin, box, container, packaging, label, brand name, logo, or branded item ANYWHERE in the frame — not in the foreground, not in the background, not in hand, not on counter, not on shelf, not in mirror reflection. If the scene calls for an action that involves a product (washing, applying, sipping), render ONLY the action and its visible result (lather, foam, water, droplets, glow on skin, hand reaching, etc.) — never the container itself. Generic unbranded everyday objects (a plain glass of water, a plain ceramic mug, a plain hand towel) are fine; anything bearing a label, a wordmark, or a recognizable packaging shape is FORBIDDEN.`;
      }

      // Pick the right fal model: nano-banana-pro/edit is image-to-image and
      // requires at least one image_url. When the per-section prompt does
      // NOT mention the product (and we therefore deliberately withheld the
      // product reference images), fall back to the plain nano-banana-pro
      // text-to-image variant — same image style/family, just no img2img.
      // Same fallback shape as Single Scene.
      const hasInputImages = imageUrls.length > 0;
      const result = await generateImage({
        model: hasInputImages ? "fal-ai/nano-banana-pro/edit" : "fal-ai/nano-banana-pro",
        input: hasInputImages
          ? {
              prompt: finalPrompt,
              image_urls: imageUrls,
              // Square 1:1 — matches the reference listicle template and the
              // user's explicit preference. Different from B-Roll (9:16
              // mobile-vertical) — this is for editorial-style images that
              // sit inline with body text.
              aspect_ratio: "1:1",
              num_images: 1,
              output_format: "jpeg",
            }
          : {
              prompt: finalPrompt,
              aspect_ratio: "1:1",
              num_images: 1,
              output_format: "jpeg",
            },
      });
      const url = result.urls[0];
      if (!url) throw new Error("No image URL returned");

      const [updated] = await db
        .update(schema.listicleImages)
        .set({
          imageUrl: url,
          imageStatus: "ready",
          imageApproval: "pending",
          ...(feedback ? { imageFeedback: feedback } : {}),
        })
        .where(eq(schema.listicleImages.id, imgRow.id))
        .returning();
      res.json({ image: updated });
    } catch (err) {
      await db
        .update(schema.listicleImages)
        .set({
          imageStatus: "failed",
          imageError: err instanceof Error ? err.message : String(err),
        })
        .where(eq(schema.listicleImages.id, imgRow.id));
      throw err;
    }
  } catch (err) {
    console.error("[listicles] generate-image failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

listiclesRouter.patch("/:id/images/:imageId", async (req: Request, res: Response) => {
  try {
    const allowed = ["imageApproval", "imageFeedback"] as const;
    const patch: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in req.body) patch[k] = req.body[k];
    }
    if (Object.keys(patch).length === 0) return sendError(res, 400, "No editable fields supplied");
    const [updated] = await db
      .update(schema.listicleImages)
      .set(patch)
      .where(and(
        eq(schema.listicleImages.id, req.params.imageId),
        eq(schema.listicleImages.listicleId, req.params.id),
      ))
      .returning();
    if (!updated) return sendError(res, 404, "Image not found");
    res.json({ image: updated });
  } catch (err) {
    console.error("[listicles] patch-image failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── Step: render the full HTML via Claude ─────────────────────────

listiclesRouter.post("/:id/render-html", async (req: Request, res: Response) => {
  try {
    const row = await loadListicle(req.params.id);
    if (!row) return sendError(res, 404, "Listicle not found");
    if (!row.copyMarkdown) return sendError(res, 400, "No copy to render");

    const images = await db
      .select()
      .from(schema.listicleImages)
      .where(eq(schema.listicleImages.listicleId, row.id))
      .orderBy(asc(schema.listicleImages.sectionIdx));

    const [product] = await db.select().from(schema.products).where(eq(schema.products.id, row.productId)).limit(1);
    const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, row.brandId)).limit(1);
    if (!product || !brand) return sendError(res, 404, "Linked product or brand missing");

    // Brand palette, fonts, AND design-system tokens for the HTML
    // render. brand.guidelinesMarkdown is the single source of truth;
    // parseBrandGuidelines + pickCtaColor + pickBackgroundColor turn
    // it into the specific CSS values the lander template needs.
    //
    // Why all this routing? An earlier version did `primary = palette[0]?.hex`
    // which broke for any brand whose first palette entry was a hero/
    // background color (e.g. Blume Peach #F6CDB7) rather than the CTA
    // color (Blume Terracotta #C97B5C). The new picker scores each
    // palette color by its `usage` text + WCAG contrast against white,
    // so a CTA is never a pastel and a page background is never a deep
    // charcoal. When the brand markdown has the dedicated Design System
    // section (## 9), those values override the score — explicit beats
    // inference.
    const { parseBrandGuidelines, pickCtaColor, pickBackgroundColor, pickBodyTextColor, isLoadableFontName } = await import("../lib/brandGuidelinesParse.js");
    let palette: { name?: string; hex: string; usage?: string }[];
    let fonts: { name: string; usage?: string }[];
    let designSystem: import("../lib/brandGuidelinesParse.js").ParsedDesignSystem | null = null;
    if (brand.guidelinesMarkdown) {
      const parsed = parseBrandGuidelines(brand.guidelinesMarkdown);
      palette = parsed.colors.map((c) => ({ name: c.name, hex: c.hex, usage: c.usage }));
      fonts = parsed.fonts.map((f) => ({ name: f.name, usage: f.role.toLowerCase() }));
      designSystem = parsed.designSystem;
    } else {
      const research = (brand.research ?? {}) as {
        colorPalette?: { name?: string; hex: string; usage?: string }[];
        fonts?: { name: string; usage?: string }[];
      };
      palette = research.colorPalette ?? [];
      fonts = research.fonts ?? [];
    }
    // Convert palette into the ParsedColor shape pickCtaColor expects.
    const palettePicker = palette.filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c.hex)).map((c) => ({
      name: c.name ?? "",
      hex: c.hex.toUpperCase(),
      usage: c.usage ?? "",
    }));
    const primary = pickCtaColor(designSystem, palettePicker) ?? palette[0]?.hex ?? "#C8A56A";
    const pageBg = pickBackgroundColor(designSystem, palettePicker) ?? "#FFFFFF";
    // Brand-tinted body text color (when the brand uses dark navy /
    // charcoal as its body text instead of #1F1F1F). Falls back to a
    // generic dark when the palette doesn't expose one.
    const bodyTextHex = pickBodyTextColor(palettePicker) ?? "#1F1F1F";
    // Muted text — derived from the body text color, lightened. If we
    // can't determine the body text deterministically, fall back to a
    // neutral mid-gray.
    const mutedTextHex = bodyTextHex === "#1F1F1F" ? "#6B6B6B" : "#7A7A85";
    // Accent — second-best CTA-like score that isn't the primary, or palette[1].
    const accent = palette.find((c) => c.hex.toUpperCase() !== primary.toUpperCase())?.hex ?? palette[1]?.hex ?? "#8B6A3A";
    // Hook callout background — a light tint. Prefer the page background
    // if it's already a light cream; otherwise use a known light entry.
    const hookBg = pageBg && pageBg.toLowerCase() !== "#ffffff"
      ? pageBg
      : palette.find((c) => /soft|cream|tint|pastel|background/i.test(c.usage ?? ""))?.hex ?? palette[2]?.hex ?? "#F8F0E0";
    // Fonts — drop unloadable names so we never inject broken CSS
    // (e.g. `font-family: Display Serif (custom — likely Didone), sans-serif`).
    // When no valid family remains we fall back to safe defaults the
    // listicle prompt already knows how to render.
    const validFonts = fonts.filter((f) => isLoadableFontName(f.name));
    const headingFont =
      validFonts.find((f) => /primary|head|display|h1|h2/i.test(f.usage ?? ""))?.name
      ?? validFonts[0]?.name
      ?? "Playfair Display";
    const bodyFont =
      validFonts.find((f) => /secondary|body|paragraph|text/i.test(f.usage ?? ""))?.name
      ?? validFonts[1]?.name
      ?? validFonts[0]?.name
      ?? "Inter";

    // Design-system tokens for the CTA button — fall through to safe
    // listicle defaults when the brand markdown predates Section 9 or
    // the model didn't fill in a value. The hover effect is intentionally
    // a free-text string — the lander prompt converts it into a CSS
    // declaration the model picks.
    const cta = designSystem?.cta ?? null;
    const btnRadius = cta?.borderRadius ?? "10px";
    const btnPadding = cta?.padding ?? "18px 28px";
    const btnFontWeight = cta?.fontWeight ?? "700";
    const btnFontTransform = cta?.fontTransform ?? "uppercase";
    const btnLetterSpacing = cta?.letterSpacing ?? "0.04em";
    const btnBorder = cta?.border ?? "none";
    const btnShadow = cta?.boxShadow ?? "none";
    const btnHover = cta?.hover ?? "darkens slightly";
    const btnTextColor = cta?.color ?? "#FFFFFF";
    const cardRadius = designSystem?.card?.borderRadius ?? "12px";
    const cardBorder = designSystem?.card?.border ?? "1px solid rgba(0,0,0,0.06)";
    const cardShadow = designSystem?.card?.boxShadow ?? "none";

    // Auxiliary brand colors the listicle prompt needs for surfaces
    // OTHER than the CTA: the announcement bar background (a dark,
    // brand-derived navy/charcoal/terracotta, NOT a hardcoded Javvy
    // purple), the trust-pill cream (a darker tint of the page bg),
    // and the buy-box card cream (slightly off-white that still feels
    // on-brand).
    //
    // Picking strategy:
    //   ANN_BG_HEX  = the darkest non-text color in the palette
    //                 (charcoal, navy, deep terracotta). Falls back to
    //                 the CTA hex if no dark palette entry exists.
    //   TRUST_BG    = a darker shade of the page background, derived
    //                 algorithmically (pageBg darkened ~8%).
    //   CARD_BG     = page bg if the brand uses a colored page bg;
    //                 otherwise white.
    //
    // These eliminate the hardcoded #2a2552 / #FFF1D6 / #FFF8E7 that
    // were baked into the listicle template from the Javvy clone era.
    const relLum = (hex: string): number => {
      const h = hex.replace(/^#/, "");
      if (h.length !== 6) return 1;
      const v = (s: string) => parseInt(s, 16) / 255;
      const r = v(h.slice(0, 2)), g = v(h.slice(2, 4)), b = v(h.slice(4, 6));
      const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const darkenHex = (hex: string, amount: number): string => {
      const h = hex.replace(/^#/, "");
      if (h.length !== 6) return hex;
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const d = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 - amount))));
      return `#${d(r).toString(16).padStart(2, "0")}${d(g).toString(16).padStart(2, "0")}${d(b).toString(16).padStart(2, "0")}`.toUpperCase();
    };
    // Darkest palette color — what an announcement bar / footer / dark
    // band needs to read as a strong banded color. Excludes the page
    // background, which can also be very dark on dark-mode brands.
    const darkestCandidate = palette
      .filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c.hex))
      .filter((c) => c.hex.toUpperCase() !== pageBg.toUpperCase())
      .sort((a, b) => relLum(a.hex) - relLum(b.hex))[0];
    const annBgHex = darkestCandidate?.hex ?? primary;
    const annTextHex = relLum(annBgHex) < 0.4 ? "#FFFFFF" : "#1F1F1F";
    // Trust pill — slightly darker tint of the page background so the
    // pill reads as elevated on the cream. If the page bg is white we
    // use a very faint warm gray so it doesn't disappear.
    const trustBg = pageBg.toUpperCase() === "#FFFFFF" ? "#F4F4F4" : darkenHex(pageBg, 0.05);
    // Buy-box card — keep white when the page bg is also white,
    // otherwise inherit the page bg so the card sits flat on the page
    // rather than introducing a third color.
    const cardBg = designSystem?.card?.background
      ?? (pageBg.toUpperCase() === "#FFFFFF" ? "#FFFFFF" : pageBg);

    const offer = (row.offerExtract ?? {}) as {
      discount_label?: string;
      scarcity_line?: string;
      shipping_line?: string;
      guarantee_line?: string;
      trust_line?: string;
      cta_text?: string;
      secondary_cta_text?: string;
      countdown_label?: string;
      raw_offer_summary?: string;
      free_gifts?: string[];
    };

    // Discover real, working policy links from the brand's actual website
    // footer (Impressum, Datenschutz, AGB, Widerruf, etc.) so the lander
    // we publish can link to legitimate pages that resolve in production.
    // Falls back to an empty string on failure — the prompt then renders
    // the footer link-free.
    const footerLinks = row.destinationUrl ? await discoverFooterLinks(row.destinationUrl) : [];
    const footerLinksHtml = footerLinks.length
      ? footerLinks
          .map(({ label, href }) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`)
          .join(' <span style="opacity:0.4;margin:0 4px;">·</span> ')
      : "";

    // Derive the bare percent number from the discount_label so the prompt
    // can compose the structured Javvy-style headline + CTA button
    // ("UP TO 58% OFF" + "GET 58% OFF →"). The offer_extract step is the
    // single source of truth for the discount — it pulls it verbatim from
    // the user's destination URL. Here we just parse the number out of the
    // label so we don't depend on the model to do that arithmetic.
    const discountPercentMatch =
      offer.discount_label?.match(/(\d{1,3})\s*%/) ?? offer.raw_offer_summary?.match(/(\d{1,3})\s*%/) ?? null;
    const discountPercent = discountPercentMatch ? discountPercentMatch[1] : "";

    // Parse the listicle markdown into structured reasons. Re-uses the
    // same section regex from generate-image-prompts so the order matches.
    // NOTE: end-of-input is matched by `(?![\s\S])`, NOT `\Z` — JavaScript
    // regex does not support `\Z` (it would be treated as a literal `Z`),
    // and using it silently drops the last section because the lookahead
    // never matches at end-of-string.
    const sectionRe = /(^[ \t]*#{3,4}[ \t]+\d+\.\s+(.+?)$)([\s\S]*?)(?=^[ \t]*#{3,4}[ \t]+\d+\.|^[ \t]*##\s|(?![\s\S]))/gm;
    const parsedReasons: { headline: string; body: string }[] = [];
    let m;
    while ((m = sectionRe.exec(row.copyMarkdown)) !== null) {
      parsedReasons.push({
        headline: m[2].replace(/[*_]/g, "").trim(),
        body: m[3].trim().replace(/^👉.*$/gm, "").trim(), // drop the 👉 CTA microcopy line
      });
    }

    // Build the REASONS_BLOCK that's interpolated into the master prompt.
    // Use image URLs from the listicle_images table; falls back to a
    // sensible placeholder if an image is missing or failed.
    const reasonsBlock = parsedReasons
      .map((r, i) => {
        const img = images[i];
        const url = img?.imageUrl ?? "";
        return [
          `REASON ${i + 1}:`,
          `  HEADLINE: ${r.headline}`,
          `  IMAGE_URL: ${url}`,
          `  BODY: ${r.body}`,
        ].join("\n");
      })
      .join("\n\n");

    // Pick a fictional author. Stable per listicle — derived from listicle
    // id so regenerating with feedback doesn't re-roll the byline.
    const authorPool = [
      { name: "Petra K.", img: "https://i.pravatar.cc/96?img=49" },
      { name: "Sarah M.", img: "https://i.pravatar.cc/96?img=44" },
      { name: "Anna H.", img: "https://i.pravatar.cc/96?img=47" },
      { name: "Maria L.", img: "https://i.pravatar.cc/96?img=46" },
      { name: "Julia W.", img: "https://i.pravatar.cc/96?img=45" },
    ];
    const hash = row.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const author = authorPool[hash % authorPool.length];

    // Extract the H1 + hook line from the listicle copy if possible.
    const h1Match = row.copyMarkdown.match(/^#\s+(.+?)$/m);
    // Pre-headline callout — the italic+bold "Read this BEFORE..." line
    // at the top of the copy markdown. Strip the italic / bold markdown
    // markers so the rendered hook callout shows clean text + lets the
    // HTML prompt apply its own bolding to "BEFORE".
    const hookMatch = row.copyMarkdown.match(/^[\s>]*\*+(.+?)\*+\s*$/m);
    const mainHeadline = h1Match?.[1]?.trim() ?? `${parsedReasons.length} reasons to try ${product.name}`;
    // Punchy fallback when no pre-headline callout was found. Tied to
    // the product category, not the angle (the angle name is often a
    // verbose problem description that reads awkwardly in a BEFORE
    // hook — "Read this BEFORE you address your nervous system
    // dysregulation" → no). Defaults to the product category:
    //   "Read this BEFORE you buy another <category>."
    const categoryHint = (product.category && !/^uncategorized$/i.test(product.category) ? product.category : "product").toLowerCase();
    const hookLine = (() => {
      if (hookMatch?.[1]) return hookMatch[1].replace(/\*+/g, "").trim();
      return `Read this BEFORE you buy another ${categoryHint}.`;
    })();

    // Build the two-line announcement strings — Javvy pattern:
    //   Line 1 = campaign-style label (the visible top line like
    //            "🇺🇸 MEMORIAL DAY SPECIAL ✨")
    //   Line 2 = discount + free-gifts callout (like "UP TO 58% OFF
    //            WITH FREE GIFTS")
    // Localized for the listicle language. Free-gifts suffix only
    // appears when the offer extract actually found free gifts.
    const isDe = row.language === "de";
    const announcementLine1 = isDe ? "✨ ZEITLICH BEGRENZTES ANGEBOT ✨" : "✨ LIMITED-TIME OFFER ✨";
    const hasFreeGifts = Boolean(offer.free_gifts && offer.free_gifts.length > 0);
    const announcementLine2 = (() => {
      if (!discountPercent && !offer.discount_label) return "";
      const discountText = discountPercent
        ? isDe
          ? `BIS ZU ${discountPercent}% RABATT`
          : `UP TO ${discountPercent}% OFF`
        : (offer.discount_label ?? "").toUpperCase();
      const suffix = hasFreeGifts ? (isDe ? " MIT GRATIS-GESCHENKEN" : " WITH FREE GIFTS") : "";
      return discountText + suffix;
    })();

    const vars: Record<string, string> = {
      LANGUAGE: row.language,
      PRODUCT_NAME: product.name,
      PRODUCT_CATEGORY: product.category ?? "product",
      // Description for the listicle's audience block. Prefer pulling
      // the Brand Overview section out of guidelinesMarkdown; fall back
      // to the legacy research.description.
      AUDIENCE_DESCRIPTION: (() => {
        if (brand.guidelinesMarkdown) {
          const overview = brand.guidelinesMarkdown.split(/^## 2\./m)[0] ?? "";
          const trimmed = overview.replace(/^# [^\n]*\n/, "").replace(/^>.*$/gm, "").trim();
          if (trimmed) return trimmed.slice(0, 600);
        }
        return ((brand.research ?? {}) as { description?: string }).description ?? "people interested in this category";
      })(),
      ANNOUNCEMENT_LINE_1: announcementLine1,
      ANNOUNCEMENT_LINE_2: announcementLine2,
      MAIN_HEADLINE: mainHeadline,
      AUTHOR_NAME: author.name,
      AUTHOR_PHOTO_URL: author.img,
      DATE: new Date().toLocaleDateString(row.language === "de" ? "de-DE" : "en-US", { year: "numeric", month: "long", day: "numeric" }),
      HOOK_LINE: hookLine,
      REASONS_BLOCK: reasonsBlock,
      OFFER_LABEL: offer.discount_label ?? "Exclusive offer",
      OFFER_PRODUCT_IMAGE_URL: product.productImageUrl ?? "",
      OFFER_HEADLINE: offer.discount_label ?? `Get ${product.name} today`,
      OFFER_SUBLINE: offer.raw_offer_summary ?? "",
      DISCOUNT_PERCENT: discountPercent,
      DISCOUNT_LABEL: offer.discount_label ?? "",
      HAS_FREE_GIFTS: offer.free_gifts && offer.free_gifts.length > 0 ? "yes" : "no",
      CTA_TEXT: offer.cta_text ?? "Get the offer",
      CTA_URL: row.destinationUrl ?? "#",
      FOOTER_LINKS_HTML: footerLinksHtml,
      COUNTDOWN_LABEL: offer.countdown_label ?? "Offer ends in",
      SCARCITY_LINE: offer.scarcity_line ?? "",
      SHIPPING_LINE: offer.shipping_line ?? "",
      GUARANTEE_LINE: offer.guarantee_line ?? "",
      SECONDARY_CTA_TEXT: offer.secondary_cta_text ?? "",
      TRUST_LINE: offer.trust_line ?? "",
      BRAND_NAME: brand.name,
      BRAND_LOGO_URL: brand.logoUrl ?? "",
      // Tagline was a legacy field on the old JSON research shape. It
      // isn't a first-class field in the new guidelines markdown, so we
      // fall through to empty when the brand has been re-extracted. The
      // listicle template renders an empty tagline gracefully.
      BRAND_TAGLINE: (brand.research as { tagline?: string } | null)?.tagline ?? "",
      FOOTER_LINKS: "",
      YEAR: String(new Date().getFullYear()),
      PRIMARY_HEX: primary,
      ACCENT_HEX: accent,
      HOOK_BG_HEX: hookBg,
      PAGE_BG_HEX: pageBg,
      // Darkest brand color — announcement bar, footer band, any
      // strong dark surface. Replaces the hardcoded #2a2552 Javvy navy
      // the lander template was inheriting.
      ANN_BG_HEX: annBgHex,
      ANN_TEXT_HEX: annTextHex,
      // Trust pill background — a faintly-darker tint of the page bg.
      TRUST_BG_HEX: trustBg,
      // Buy-box / feature card surface background — derived from the
      // brand's page bg, not a hardcoded cream.
      CARD_BG_HEX: cardBg,
      // Body text color — many DTC brands use a brand-tinted dark
      // (Blume's navy `#001E42`, e.g.) instead of pure black. Picked
      // from the brand's palette via usage-text scoring; falls back
      // to the listicle's generic #1F1F1F when no brand body-text
      // color was extracted.
      BODY_TEXT_HEX: bodyTextHex,
      MUTED_TEXT_HEX: mutedTextHex,
      HEADING_FONT: headingFont,
      BODY_FONT: bodyFont,
      // Brand-specific button design tokens — parsed from
      // brand.guidelinesMarkdown § 9 Design System. The lander template
      // applies them verbatim so cloned pages match the brand's actual
      // button style (radius, padding, shadow, hover behaviour) rather
      // than the listicle's hardcoded chunky-shadow default.
      BTN_RADIUS: btnRadius,
      BTN_PADDING: btnPadding,
      BTN_FONT_WEIGHT: btnFontWeight,
      BTN_FONT_TRANSFORM: btnFontTransform,
      BTN_LETTER_SPACING: btnLetterSpacing,
      BTN_BORDER: btnBorder,
      BTN_SHADOW: btnShadow,
      BTN_HOVER: btnHover,
      BTN_TEXT_COLOR: btnTextColor,
      CARD_RADIUS: cardRadius,
      CARD_BORDER: cardBorder,
      CARD_SHADOW: cardShadow,
      LANGUAGE_SPECIFIC_NOTES: row.language === "de" ? "Use the formal/informal voice that matches the brand tone — for wellbe-style brands, prefer informal 'du'." : "",
      HTML_FEEDBACK: row.htmlFeedback?.trim() || "(no feedback — this is the first render or the user is happy enough to deploy)",
    };

    await touch(row.id, { status: "rendering" });
    try {
      const prompt = loadPrompt("listicle_lander_html", vars);
      const result = await generateText({
        systemPrompt: prompt.rendered,
        userMessage: "Render the complete HTML page now per the spec above. Output starts with <!DOCTYPE html> and ends with </html>.",
        model: prompt.config.model,
        maxTokens: prompt.config.maxTokens ?? 16000,
      });
      let html = result.text.trim();
      if (!html.toLowerCase().includes("<!doctype html>")) {
        throw new Error("HTML render did not produce a full document (missing <!DOCTYPE html>)");
      }

      // POST-RENDER SECTION-COUNT VALIDATION + RETRY + DETERMINISTIC FALLBACK
      //
      // Three layers of recovery, each cheaper than the previous failing
      // to take the gap to zero:
      //   1. Validator — count numbered <h2> sections, compare to
      //      expected from parsedReasons. Always logs so we can audit
      //      every render.
      //   2. Retry — one targeted re-render with "you missed sections
      //      X and Y" feedback. Capped at one to bound latency.
      //   3. Deterministic server-side injection — if Claude STILL
      //      refuses to render a section after the retry, we build
      //      the section HTML ourselves and inject it before the buy-
      //      box. Always produces a complete page.
      const expectedCount = parsedReasons.length;
      const firstRendered = extractRenderedSectionNumbers(html);
      const firstMissing = computeMissingSections(expectedCount, firstRendered);
      console.log(
        `[listicles] section-count check: expected ${expectedCount}, rendered ${firstRendered.length} (${firstRendered.join(", ")})${firstMissing.length > 0 ? `, MISSING: ${firstMissing.join(", ")}` : ", complete"}`,
      );
      if (firstMissing.length > 0) {
        // Layer 2 — targeted retry.
        const missingReasonsBlock = firstMissing
          .map((n) => {
            const r = parsedReasons[n - 1];
            if (!r) return null;
            const img = images[n - 1];
            return [
              `REASON ${n}:`,
              `  HEADLINE: ${r.headline}`,
              `  IMAGE_URL: ${img?.imageUrl ?? ""}`,
              `  BODY: ${r.body}`,
            ].join("\n");
          })
          .filter(Boolean)
          .join("\n\n");
        const fixupUser =
          `Your previous HTML render dropped ${firstMissing.length} numbered section(s): ${firstMissing.join(", ")}. ` +
          `Re-render the COMPLETE HTML document including ALL ${expectedCount} numbered sections this time. ` +
          `The sections you missed last time:\n\n${missingReasonsBlock}\n\n` +
          `Output the FULL document from <!DOCTYPE html> to </html> — not just the missing sections. ` +
          `Every numbered section from 1 to ${expectedCount} MUST appear in document order, each rendered with its own h2, image, body paragraphs, and CTA microcopy. ` +
          `Before you finish, COUNT your numbered <h2> elements. The count must be exactly ${expectedCount}.`;
        try {
          const fixupResult = await generateText({
            systemPrompt: prompt.rendered,
            userMessage: fixupUser,
            model: prompt.config.model,
            maxTokens: prompt.config.maxTokens ?? 16000,
          });
          const fixupHtml = fixupResult.text.trim();
          if (fixupHtml.toLowerCase().includes("<!doctype html>")) {
            const renderedAfter = extractRenderedSectionNumbers(fixupHtml);
            const stillMissing = computeMissingSections(expectedCount, renderedAfter);
            if (stillMissing.length < firstMissing.length) {
              html = fixupHtml;
              console.log(`[listicles] section-count retry: now have ${renderedAfter.length}/${expectedCount}${stillMissing.length > 0 ? `; ${stillMissing.length} still missing: ${stillMissing.join(", ")}` : " (complete)"}`);
            } else {
              console.warn(`[listicles] section-count retry did not improve (still missing: ${stillMissing.join(", ")}); keeping first render`);
            }
          } else {
            console.warn(`[listicles] section-count retry produced a non-document (no <!DOCTYPE html>); keeping first render`);
          }
        } catch (retryErr) {
          console.warn(`[listicles] section-count retry threw (non-fatal):`, retryErr);
        }

        // Layer 3 — deterministic server-side injection. Constructs the
        // section HTML ourselves using the listicle template's class
        // conventions and inserts it before the buy-box. Guarantees a
        // complete page even when Claude refuses to render a section.
        const finalMissing = computeMissingSections(expectedCount, extractRenderedSectionNumbers(html));
        if (finalMissing.length > 0) {
          html = injectMissingSections(
            html,
            finalMissing,
            parsedReasons,
            images.map((i) => ({ imageUrl: i?.imageUrl ?? null })),
            row.destinationUrl ?? "#",
            primary,
          );
          console.log(`[listicles] section-count fallback: server-injected ${finalMissing.length} missing section(s): ${finalMissing.join(", ")}`);
        }
      }

      await touch(row.id, { renderedHtml: html, status: "ready", error: null });
      res.json({ renderedHtml: html });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await touch(row.id, { status: "failed", error: msg });
      throw err;
    }
  } catch (err) {
    console.error("[listicles] render-html failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── Step: deploy to LanderLab ─────────────────────────────────────

listiclesRouter.post("/:id/deploy", async (req: Request, res: Response) => {
  try {
    const row = await loadListicle(req.params.id);
    if (!row) return sendError(res, 404, "Listicle not found");
    if (!row.renderedHtml) return sendError(res, 400, "Render the HTML before deploying");

    const [product] = await db.select().from(schema.products).where(eq(schema.products.id, row.productId)).limit(1);

    // 1. Find the primary domain (cached after first call)
    const domain = await pickPrimaryDomain();

    // 2. Create an empty lander shell
    const baseSlug = buildSlug(product?.name ?? "listicle", row.angleName);
    const name = `${product?.name ?? "Listicle"} — ${row.angleName ?? "general"} — ${new Date().toISOString().slice(0, 10)}`;
    const created = await createLander(name);

    // 3. Push our HTML into the variant
    await saveVariantHtml(created.masterVariantId, row.renderedHtml);

    // 4. Publish with auto-retry on slug collision
    const published = await publishLander({
      landerId: created.landerId,
      domainId: domain.id,
      domainName: domain.name,
      slug: baseSlug,
    });

    const editorUrl = buildEditorUrl(created.masterVariantId);
    const updates: Partial<schema.Listicle> = {
      status: "deployed",
      landerlabLanderId: String(created.landerId),
      landerlabVariantId: String(created.masterVariantId),
      landerlabEncryptedVariantId: created.encryptedVariantId,
      landerlabDomainId: String(domain.id),
      publishedUrl: published.publishedUrl,
      previewUrl: created.previewUrl,
      editorUrl,
      error: null,
    };
    await touch(row.id, updates);

    // Auto-save to Brand Assets so the deployed lander shows up in
    // the brand's asset library alongside videos / images. The asset
    // row's `url` is the publishedUrl (the live lander); the metadata
    // block carries every other URL (preview, editor, slug, listicle
    // id) so the Assets-page detail panel can render them as click-
    // through links without needing to re-query the listicles table.
    //
    // Idempotent: deleting the existing asset row first means a
    // re-deploy (e.g. after a render fix) replaces the entry rather
    // than creating a second row pointing at the same listicle.
    try {
      // Find any prior asset for this listicle and delete (re-deploys).
      const existingAssets = await db
        .select()
        .from(schema.brandAssets)
        .where(and(
          eq(schema.brandAssets.brandId, row.brandId),
          eq(schema.brandAssets.kind, "landing_page"),
        ));
      for (const a of existingAssets) {
        const meta = (a.metadata ?? {}) as { listicleId?: string };
        if (meta.listicleId === row.id) {
          await db.delete(schema.brandAssets).where(eq(schema.brandAssets.id, a.id));
        }
      }
      const titleBase = `${product?.name ?? "Listicle"} — ${row.angleName ?? "general"}`;
      await db.insert(schema.brandAssets).values({
        brandId: row.brandId,
        productId: row.productId,
        kind: "landing_page",
        url: published.publishedUrl,
        thumbnailUrl: null,
        title: titleBase,
        sourceApp: "listicle_builder",
        userId: req.auth?.user.id ?? null,
        metadata: {
          listicleId: row.id,
          publishedUrl: published.publishedUrl,
          previewUrl: created.previewUrl,
          editorUrl,
          slug: published.finalSlug,
          // H1 + product name make the side panel useful as a card
          // even without a thumbnail (we don't render the lander to
          // an image — too heavy for every deploy).
          headline: extractH1FromMarkdown(row.copyMarkdown ?? "") ?? titleBase,
          deployedAt: new Date().toISOString(),
        },
      });
    } catch (assetErr) {
      // Non-fatal — the deploy succeeded, we just couldn't save the
      // asset entry. User can re-deploy to retry the save.
      console.warn(`[listicles] auto-save to brand_assets failed (non-fatal):`, assetErr);
    }

    res.json({
      publishedUrl: published.publishedUrl,
      previewUrl: created.previewUrl,
      editorUrl,
      slug: published.finalSlug,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[listicles] deploy failed:", err);
    await touch(req.params.id, { status: "failed", error: msg });
    sendError(res, 500, msg);
  }
});

/** Tiny helper — pull the listicle's H1 ("# 11 Reasons Why ...") for the asset title. */
function extractH1FromMarkdown(md: string): string | null {
  const m = md.match(/^#\s+(.+?)$/m);
  return m ? m[1]!.trim() : null;
}
