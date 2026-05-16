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
import { and, asc, eq } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { generateText } from "../lib/anthropic.js";
import { db, schema } from "../lib/db.js";
import { generateImage } from "../lib/fal.js";
import { buildEditorUrl, buildSlug, createLander, pickPrimaryDomain, publishLander, saveVariantHtml } from "../lib/landerlab.js";
import { loadPrompt } from "../lib/prompts.js";

export const listiclesRouter: Router = Router();

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

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
function imagePromptMentionsProduct(text: string, productName: string | null | undefined): boolean {
  if (!text) return false;
  const lc = text.toLowerCase();
  const nameTokens = (productName ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length >= 4);
  if (nameTokens.some((t) => lc.includes(t))) return true;
  const generic = [
    "the product", "this product", "the packaging", "the pouch", "the bag",
    "the bottle", "the jar", "the tube", "the spray", "the sachet",
    "the can", "the tin", "the box", "the container", "the label",
    "the cap", "the lid", "the pump", "the dropper", "the nozzle",
    "the trigger", "the wrapper", "product packaging", "supplement bag",
    "powder bag", "powder pouch",
  ];
  return generic.some((g) => lc.includes(g));
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

// ── Step: extract offer from destinationUrl ───────────────────────

listiclesRouter.post("/:id/extract-offer", async (req: Request, res: Response) => {
  try {
    const row = await loadListicle(req.params.id);
    if (!row) return sendError(res, 404, "Listicle not found");
    if (!row.destinationUrl) return sendError(res, 400, "No destinationUrl set on this listicle");

    // Fetch the destination page. We tolerate failures gracefully —
    // a sensible-but-empty offer object is OK, the user can still ship.
    let pageContent = "";
    try {
      const r = await fetch(row.destinationUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; InanaBot/1.0)" },
      });
      pageContent = (await r.text()).slice(0, 50_000); // cap at 50K chars
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
    let pricingFacts = "";
    try {
      const m = row.destinationUrl.match(/^(.+\/products\/[^/?#]+)/);
      if (m) {
        const jsonUrl = m[1] + ".json";
        const jr = await fetch(jsonUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; InanaBot/1.0)" },
        });
        if (jr.ok) {
          const productJson = (await jr.json()) as {
            product?: {
              variants?: { title?: string; price?: string | number; compare_at_price?: string | number | null }[];
            };
          };
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

    const prompt = loadPrompt("offer_extract", { page_content: pageContent + pricingFacts });
    const result = await generateText({
      systemPrompt: prompt.rendered,
      userMessage: "Extract the offer from the page content above. Return only JSON.",
      model: prompt.config.model,
      maxTokens: prompt.config.maxTokens ?? 2000,
    });

    let parsed: Record<string, unknown> = {};
    try {
      const cleaned = result.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const m = result.text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
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

    const brandContext = [
      brand.name ? `Name: ${brand.name}` : null,
      brand.brandUrl ? `URL: ${brand.brandUrl}` : null,
      (brand.research as { tone?: string })?.tone ? `Tone: ${(brand.research as { tone?: string }).tone}` : null,
      (brand.research as { description?: string })?.description ? `Description: ${(brand.research as { description?: string }).description}` : null,
    ].filter(Boolean).join("\n");

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
      feedback: "(no prior draft to revise)",
    });

    const result = await generateText({
      systemPrompt: prompt.rendered,
      userMessage: "Write the listicle now. Follow every rule above. Output only the listicle Markdown.",
      model: prompt.config.model,
      maxTokens: prompt.config.maxTokens ?? 8000,
    });

    await touch(row.id, { copyMarkdown: result.text, status: "drafting" });
    res.json({ copyMarkdown: result.text });
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

    // Pull brand palette + fonts from research, with sensible defaults.
    const research = (brand.research ?? {}) as {
      colorPalette?: { name?: string; hex: string; usage?: string }[];
      fonts?: { name: string; usage?: string }[];
      description?: string;
    };
    const palette = research.colorPalette ?? [];
    const fonts = research.fonts ?? [];
    const primary = palette[0]?.hex ?? "#C8A56A";
    const accent = palette[1]?.hex ?? "#8B6A3A";
    const hookBg = palette[2]?.hex ?? "#F8F0E0";
    const headingFont = fonts.find((f) => /head|display|h1|h2/i.test(f.usage ?? ""))?.name ?? fonts[0]?.name ?? "Inter, system-ui, sans-serif";
    const bodyFont = fonts.find((f) => /body|paragraph|text/i.test(f.usage ?? ""))?.name ?? fonts[1]?.name ?? fonts[0]?.name ?? "Inter, system-ui, sans-serif";

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
    const sectionRe = /(^[ \t]*#{3,4}[ \t]+\d+\.\s+(.+?)$)([\s\S]*?)(?=^[ \t]*#{3,4}[ \t]+\d+\.|^[ \t]*##\s|\Z)/gm;
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
    const hookMatch = row.copyMarkdown.match(/^([^#\n][^\n]+!)$/m); // first sentence-with-! style hook
    const mainHeadline = h1Match?.[1]?.trim() ?? `${parsedReasons.length} reasons to try ${product.name}`;
    const hookLine = hookMatch?.[1]?.trim() ?? `Read this BEFORE you ${row.angleName ? "decide on your next " + row.angleName.toLowerCase() : "make your next purchase"}.`;

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
      AUDIENCE_DESCRIPTION: research.description ?? "people interested in this category",
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
      BRAND_TAGLINE: (brand.research as { tagline?: string })?.tagline ?? "",
      FOOTER_LINKS: "",
      YEAR: String(new Date().getFullYear()),
      PRIMARY_HEX: primary,
      ACCENT_HEX: accent,
      HOOK_BG_HEX: hookBg,
      HEADING_FONT: headingFont,
      BODY_FONT: bodyFont,
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
      const html = result.text.trim();
      if (!html.toLowerCase().includes("<!doctype html>")) {
        throw new Error("HTML render did not produce a full document (missing <!DOCTYPE html>)");
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
