/**
 * Brands — the top-level data scoping unit.
 *
 *   GET  /api/brands         — list all brands, newest first
 *   GET  /api/brands/:id     — fetch one (used for polling research status)
 *   POST /api/brands         — create a brand AND its first product;
 *                              fires brand_extract + product_research in parallel
 *   POST /api/brands/:id/research — manually re-trigger brand research
 *
 * The create flow is the important one: it accepts the brand's URL (for the
 * brand_extract pipeline), the first product's details (URL or fact sheet +
 * mandatory front/back clean product images), and returns { brand, product }
 * immediately while both research pipelines run async.
 */
import { desc, eq } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { generateText } from "../lib/anthropic.js";
import { db, schema } from "../lib/db.js";
import { loadPrompt, PromptNotConfiguredError } from "../lib/prompts.js";
import { fetchUrlMeta } from "../lib/urlMeta.js";
import { runResearch as runProductResearch } from "./products.js";

export const brandsRouter: Router = Router();

const BRAND_RESEARCH_ACTION = "brand_extract";

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

brandsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(schema.brands)
      .orderBy(desc(schema.brands.createdAt));
    res.json({ brands: rows });
  } catch (err) {
    console.error("[brands] list failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

brandsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(schema.brands)
      .where(eq(schema.brands.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Brand not found");
    res.json({ brand: row });
  } catch (err) {
    console.error("[brands] get failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * PATCH /api/brands/:id — edit brand fields (name, brandUrl, research JSON).
 * Used by BrandInfoPage's "edit and save" flow.
 */
brandsRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      name?: string;
      brandUrl?: string | null;
      logoUrl?: string | null;
      research?: unknown;
    };
    const updates: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
    if (body.brandUrl !== undefined) updates.brandUrl = body.brandUrl ?? null;
    if (body.logoUrl !== undefined) updates.logoUrl = body.logoUrl ?? null;
    if (body.research !== undefined) updates.research = body.research;
    if (Object.keys(updates).length === 0) return sendError(res, 400, "No updates provided");

    const [row] = await db
      .update(schema.brands)
      .set(updates)
      .where(eq(schema.brands.id, req.params.id))
      .returning();
    if (!row) return sendError(res, 404, "Brand not found");
    res.json({ brand: row });
  } catch (err) {
    console.error("[brands] patch failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/brands
 * Body:
 *   {
 *     name: string,
 *     brandUrl: string,
 *     productUrl?: string,           // one of productUrl | factSheet required
 *     factSheet?: string,
 *     productName?: string,
 *     productImageUrl: string,       // mandatory — clean front shot
 *     productBackImageUrl: string,   // mandatory — clean back shot
 *   }
 *
 * Creates the brand, creates its first product, returns both.
 * Brand research (brand_extract) and product research run async in parallel.
 */
brandsRouter.post("/", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    brandUrl?: string;
    productUrl?: string;
    factSheet?: string;
    productName?: string;
    productImageUrl?: string;
    productBackImageUrl?: string;
  };

  const brandUrl = body.brandUrl?.trim() || "";
  const productUrl = body.productUrl?.trim() || "";
  const factSheet = body.factSheet?.trim() || "";
  const productImageUrl = body.productImageUrl?.trim() || "";
  const productBackImageUrl = body.productBackImageUrl?.trim() || "";

  if (!brandUrl) return sendError(res, 400, "brandUrl is required");
  let brandUrlParsed: URL;
  try {
    brandUrlParsed = new URL(brandUrl);
  } catch {
    return sendError(res, 400, "brandUrl is not a valid URL");
  }
  if (!productUrl && !factSheet) {
    return sendError(res, 400, "Either productUrl or factSheet is required");
  }
  if (productUrl) {
    try {
      new URL(productUrl);
    } catch {
      return sendError(res, 400, "productUrl is not a valid URL");
    }
  }
  if (!productImageUrl) return sendError(res, 400, "productImageUrl (front) is required");
  if (!productBackImageUrl) return sendError(res, 400, "productBackImageUrl is required");

  // Placeholder name derived from the hostname until brand_extract fills it in.
  const placeholderName = brandUrlParsed.hostname.replace(/^www\./, "");

  try {
    const [brand] = await db
      .insert(schema.brands)
      .values({
        name: placeholderName,
        brandUrl,
        researchStatus: "pending",
      })
      .returning();

    // Derive product name: explicit > scrape > factSheet slice > fallback.
    let productName = body.productName?.trim() || "";
    let scrapeCandidates: { url: string; width: number | null; height: number | null; source: string; score: number }[] = [];
    if (productUrl) {
      try {
        const meta = await fetchUrlMeta(productUrl);
        if (!productName) productName = meta.title ?? meta.siteName ?? productUrl;
        scrapeCandidates = meta.imageCandidates ?? [];
      } catch (err) {
        console.warn("[brands] product urlMeta fetch failed:", err);
      }
    }
    if (!productName) productName = factSheet ? factSheet.slice(0, 60) : placeholderName;

    // Seed imageCandidates with the mandatory front+back uploads (highest score
    // so they sort first in the candidate gallery).
    const initialCandidates = [
      { url: productImageUrl, width: null, height: null, source: "user-upload", score: 6000 },
      { url: productBackImageUrl, width: null, height: null, source: "user-upload-back", score: 5900 },
      ...scrapeCandidates,
    ];

    const [product] = await db
      .insert(schema.products)
      .values({
        brandId: brand.id,
        name: productName,
        category: "Uncategorized",
        productUrl: productUrl || null,
        factSheet: factSheet || null,
        productImageUrl,
        productBackImageUrl,
        researchStatus: "pending",
        research: { imageCandidates: initialCandidates },
      })
      .returning();

    // Fire both research pipelines in parallel, fire-and-forget.
    void runBrandResearch(brand.id, brandUrl);
    void runProductResearch(product.id);

    res.json({ brand, product });
  } catch (err) {
    console.error("[brands] create failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/brands/:id/research — manually re-run brand_extract for a brand.
 */
brandsRouter.post("/:id/research", async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(schema.brands)
      .where(eq(schema.brands.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Brand not found");
    if (!row.brandUrl) return sendError(res, 424, "Brand has no brandUrl — cannot research");

    await db
      .update(schema.brands)
      .set({ researchStatus: "pending", researchError: null })
      .where(eq(schema.brands.id, row.id));

    void runBrandResearch(row.id, row.brandUrl);
    res.json({ ok: true });
  } catch (err) {
    console.error("[brands] re-research failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * Runs the brand_extract master prompt against the brand URL, parses the JSON
 * dossier, and stores it on brands.research. Also mirrors the logoUrl into the
 * dedicated column so the BrandSwitcher can render it without parsing JSON.
 */
async function runBrandResearch(brandId: string, brandUrl: string): Promise<void> {
  const started = Date.now();
  try {
    await db
      .update(schema.brands)
      .set({ researchStatus: "researching", researchError: null })
      .where(eq(schema.brands.id, brandId));

    const prompt = loadPrompt(BRAND_RESEARCH_ACTION, { url: brandUrl });
    const result = await generateText({
      systemPrompt: prompt.rendered,
      userMessage: `Brand website: ${brandUrl}`,
      maxTokens: prompt.config.maxTokens,
      tools: prompt.config.tools,
    });

    // brand_extract is expectsJson: true — model returns a single JSON object.
    const cleaned = result.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`brand_extract returned non-JSON: ${cleaned.slice(0, 200)}…`);
    }

    const logoUrl = typeof parsed.logoUrl === "string" ? parsed.logoUrl : null;
    const extractedName = typeof parsed.name === "string" ? parsed.name.trim() : "";

    // brand_extract is the source of truth for name + logo — overwrite
    // whatever placeholder is on the row. If extraction returned a blank
    // name, keep the placeholder rather than wiping it.
    const setPatch: Record<string, unknown> = {
      research: parsed,
      researchStatus: "complete",
      researchError: null,
      logoUrl,
    };
    if (extractedName) setPatch.name = extractedName;

    await db
      .update(schema.brands)
      .set(setPatch)
      .where(eq(schema.brands.id, brandId));

    await db.insert(schema.generations).values({
      action: BRAND_RESEARCH_ACTION,
      kind: "text",
      inputs: { brandId, url: brandUrl },
      output: { brand: parsed },
      model: result.model,
      promptVersion: prompt.version,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: String(result.costUsd),
      durationMs: result.durationMs,
    });

    console.log(
      `[brands] research complete for ${brandId} in ${Date.now() - started}ms — ` +
      `$${result.costUsd.toFixed(4)}, ${result.tokensIn} in / ${result.tokensOut} out`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[brands] research failed for ${brandId}:`, err);
    await db
      .update(schema.brands)
      .set({
        researchStatus: "failed",
        researchError: err instanceof PromptNotConfiguredError
          ? "Brand research prompt not configured. Create prompts/brand_extract.md."
          : msg,
      })
      .where(eq(schema.brands.id, brandId));

    await db.insert(schema.generations).values({
      action: BRAND_RESEARCH_ACTION,
      kind: "text",
      inputs: { brandId, url: brandUrl },
      output: null,
      model: "unknown",
      error: msg,
      durationMs: Date.now() - started,
    });
  }
}
