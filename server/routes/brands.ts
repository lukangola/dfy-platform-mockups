/**
 * Brands — the top-level data scoping unit.
 *
 *   GET    /api/brands           — list all brands, newest first
 *   GET    /api/brands/:id       — fetch one (used for polling research status)
 *   POST   /api/brands           — create a brand AND its first product;
 *                                  fires brand_extract + product_research in parallel
 *   PATCH  /api/brands/:id       — edit brand fields (name, brandUrl, research)
 *   DELETE /api/brands/:id       — remove a brand (?cascade=true to also drop refs)
 *   POST   /api/brands/:id/research — manually re-trigger brand research
 *
 * The create flow is the important one: it accepts the brand's URL (for the
 * brand_extract pipeline), the first product's details (URL or fact sheet +
 * mandatory front/back clean product images), and returns { brand, product }
 * immediately while both research pipelines run async.
 */
import { and, desc, eq, inArray, sql as sqlTag } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { generateText } from "../lib/anthropic.js";
import { requireAuth } from "../lib/auth.js";
import { canSeeBrand, grantBrandsToUser, visibleBrandIds } from "../lib/brandAccess.js";
import { db, schema } from "../lib/db.js";
import { extractJsonObject } from "../lib/jsonExtract.js";
import { loadPrompt, PromptNotConfiguredError } from "../lib/prompts.js";
import { fetchUrlMeta } from "../lib/urlMeta.js";
import { runResearch as runProductResearch } from "./products.js";

export const brandsRouter: Router = Router();

const BRAND_RESEARCH_ACTION = "brand_extract";

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

brandsRouter.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const { user, team, role } = req.auth!;
    // Filter to the caller's team AND to brands they're allowed to see.
    // Admins get everything on the team; members get only the brand ids
    // listed in brand_members. Empty visible set → empty response (the
    // BrandSwitcher renders the "ask your admin" empty state in this case).
    const visible = await visibleBrandIds(user.id, role, team.id);
    if (visible.size === 0) return res.json({ brands: [] });
    const rows = await db
      .select()
      .from(schema.brands)
      .where(and(eq(schema.brands.teamId, team.id), inArray(schema.brands.id, Array.from(visible))))
      .orderBy(desc(schema.brands.createdAt));
    res.json({ brands: rows });
  } catch (err) {
    console.error("[brands] list failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

brandsRouter.get("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { user, role } = req.auth!;
    if (!(await canSeeBrand(user.id, role, req.params.id))) {
      return sendError(res, 404, "Brand not found");
    }
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
brandsRouter.patch("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { user, role } = req.auth!;
    if (!(await canSeeBrand(user.id, role, req.params.id))) {
      return sendError(res, 404, "Brand not found");
    }
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
brandsRouter.post("/", requireAuth, async (req: Request, res: Response) => {
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
    const { user, team } = req.auth!;
    const [brand] = await db
      .insert(schema.brands)
      .values({
        name: placeholderName,
        brandUrl,
        researchStatus: "pending",
        // Stamp the team on creation so the visibility filter picks it
        // up immediately. Previously brands could be created with a NULL
        // team_id (relying on the boot backfill); that's a race we don't
        // need.
        teamId: team.id,
      })
      .returning();

    // Auto-grant access to (a) the creator and (b) every admin on the
    // team — admins don't strictly need a row (the role check bypasses
    // this table), but other MEMBERS who happen to be the creator do.
    // We only persist a row for the creator if they're NOT an admin;
    // admins get implicit access via canSeeBrand's role short-circuit.
    if (req.auth!.role !== "admin") {
      await grantBrandsToUser({ userId: user.id, brandIds: [brand.id], createdBy: user.id });
    }

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
 * DELETE /api/brands/:id — remove a brand.
 *
 * By default this REFUSES if anything still references the brand
 * (products, lp_builds, brand_assets). The response includes counts so
 * the caller knows what's blocking. Pass `?cascade=true` to also delete
 * those dependent rows in the same transaction.
 *
 * Intentionally minimal — added for one-shot cleanup of a duplicate
 * brand row. Production safety net: counts are surfaced in the
 * non-cascade response so an operator can see exactly what would be
 * removed before flipping the flag.
 */
brandsRouter.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const cascade = String(req.query.cascade ?? "").toLowerCase() === "true";
    const { user, role } = req.auth!;
    if (!(await canSeeBrand(user.id, role, id))) {
      return sendError(res, 404, "Brand not found");
    }

    const [row] = await db
      .select()
      .from(schema.brands)
      .where(eq(schema.brands.id, id))
      .limit(1);
    if (!row) return sendError(res, 404, "Brand not found");

    // Reference counts across every table that points at brand_id.
    // `safeCount` wraps each query in a try/catch so a missing relation
    // (e.g. `lp_builds` on a production DB that hasn't applied the LP
    // cloner migration yet) reports zero refs instead of crashing with
    // "Cannot read properties of undefined (reading 'id')" or a Postgres
    // "relation does not exist" error.
    const safeCount = async <T>(fn: () => Promise<T[]>): Promise<T[]> => {
      try {
        return await fn();
      } catch (e) {
        console.warn("[brands] reference count skipped:", (e as Error).message);
        return [];
      }
    };
    // Count references via raw SQL so we don't depend on `schema.lpBuilds`
    // existing — the LP cloner schema isn't deployed everywhere, and a
    // missing table just means zero refs for THIS deployment.
    const safeCountRaw = async (table: string, column: string, value: string): Promise<number> => {
      try {
        const result = await db.execute(sqlTag.raw(
          `SELECT COUNT(*)::int AS count FROM "${table}" WHERE "${column}" = '${value}'`,
        ));
        const rows = (result as unknown as { rows?: Array<{ count: number }> }).rows ?? [];
        return rows[0]?.count ?? 0;
      } catch {
        // "relation does not exist" → table not deployed here. Treat as 0.
        return 0;
      }
    };
    const [products, lpBuildsCount, brandAssetsRows] = await Promise.all([
      safeCount(() => db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.brandId, id))),
      safeCountRaw("lp_builds", "brand_id", id),
      safeCount(() => db.select({ id: schema.brandAssets.id }).from(schema.brandAssets).where(eq(schema.brandAssets.brandId, id))),
    ]);
    const refs = {
      products: products.length,
      lpBuilds: lpBuildsCount,
      brandAssets: brandAssetsRows.length,
    };
    const totalRefs = refs.products + refs.lpBuilds + refs.brandAssets;

    if (totalRefs > 0 && !cascade) {
      return res.status(409).json({
        error: "Brand has dependent rows. Re-call with ?cascade=true to delete them too.",
        brand: { id: row.id, name: row.name },
        references: refs,
      });
    }

    if (cascade && totalRefs > 0) {
      // Delete the dependents first so the brand delete doesn't leave
      // orphans. No FK cascade is configured in the schema; we do it
      // manually here. Same safe-wrap pattern as the ref count above.
      const safeDelete = async (label: string, fn: () => Promise<unknown>) => {
        try {
          await fn();
        } catch (e) {
          console.warn(`[brands] cascade-delete skipped ${label}:`, (e as Error).message);
        }
      };
      await Promise.all([
        refs.lpBuilds > 0
          ? safeDelete("lp_builds", () => db.execute(sqlTag.raw(`DELETE FROM "lp_builds" WHERE "brand_id" = '${id}'`)))
          : Promise.resolve(),
        refs.brandAssets > 0
          ? safeDelete("brand_assets", () => db.delete(schema.brandAssets).where(eq(schema.brandAssets.brandId, id)))
          : Promise.resolve(),
        refs.products > 0
          ? safeDelete("products", () => db.delete(schema.products).where(eq(schema.products.brandId, id)))
          : Promise.resolve(),
      ]);
      console.log(
        `[brands] cascade-delete for ${id}: products=${refs.products}, lpBuilds=${refs.lpBuilds}, brandAssets=${refs.brandAssets}`,
      );
    }

    // Always clean up brand_members grants for the brand we're deleting,
    // regardless of cascade flag — orphaned grant rows would point at a
    // non-existent brand and just confuse the access check.
    try {
      await db.delete(schema.brandMembers).where(eq(schema.brandMembers.brandId, id));
    } catch (e) {
      console.warn("[brands] brand_members cleanup skipped:", (e as Error).message);
    }

    await db.delete(schema.brands).where(eq(schema.brands.id, id));
    console.log(`[brands] deleted ${id} (name=${JSON.stringify(row.name)})`);
    res.json({
      ok: true,
      deleted: { id: row.id, name: row.name },
      cascadeRemoved: cascade ? refs : null,
    });
  } catch (err) {
    console.error("[brands] delete failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/brands/:id/research — manually re-run brand_extract for a brand.
 */
brandsRouter.post("/:id/research", requireAuth, async (req: Request, res: Response) => {
  try {
    const { user, role } = req.auth!;
    if (!(await canSeeBrand(user.id, role, req.params.id))) {
      return sendError(res, 404, "Brand not found");
    }
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

    // brand_extract is expectsJson: true. Use the centralised extractor —
    // it strips ```json fences, then if that fails grabs the first
    // balanced { ... } substring (which survives trailing commentary).
    // Logs stop_reason + length in the error for fast debugging when
    // the upstream prompt truncates or goes off-format.
    let parsed: Record<string, unknown>;
    try {
      parsed = extractJsonObject<Record<string, unknown>>(result.text, {
        stopReason: result.stopReason,
        action: BRAND_RESEARCH_ACTION,
      });
    } catch (err) {
      // Log the full raw output so we can post-mortem prompt issues
      // without redeploying. The error thrown is short + user-safe.
      console.error(
        `[brands] ${BRAND_RESEARCH_ACTION} parse failed for ${brandUrl}.\n` +
        `stop_reason=${result.stopReason} tokensOut=${result.tokensOut}\n` +
        `RAW OUTPUT:\n${result.text}`
      );
      throw err;
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
