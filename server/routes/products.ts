import { desc, eq, sql as sqlTag } from "drizzle-orm";
import { type NextFunction, type Request, type Response, Router } from "express";
import { generateText } from "../lib/anthropic.js";
import { requireAuth } from "../lib/auth.js";
import { canSeeBrand, canSeeProduct } from "../lib/brandAccess.js";
import { db, schema } from "../lib/db.js";
import { extractJsonObject } from "../lib/jsonExtract.js";
import { loadPrompt, PromptNotConfiguredError } from "../lib/prompts.js";
import { generateImage, uploadToFalStorage } from "../lib/fal.js";
import { fetchUrlMeta } from "../lib/urlMeta.js";
import { getProductReferenceTemplateUrl } from "../lib/productReferenceTemplate.js";

export const productsRouter: Router = Router();

/**
 * Gate every /:id route on whether the caller can see the product's
 * brand. Mounting this once via `productsRouter.use("/:id", ...)` covers
 * GET/PATCH/DELETE plus every nested POST (angles, mechanism, research,
 * reassign-brand, image-candidate, etc.) without per-route boilerplate.
 * Auth must already be attached upstream — we read req.auth set by the
 * global attachAuth middleware.
 */
async function gateByProductAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.auth) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const { user, role } = req.auth;
  const productId = req.params.id;
  if (!productId) return next();
  if (!(await canSeeProduct(user.id, role, productId))) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  next();
}

const RESEARCH_ACTION = "product_research";

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

/**
 * Parses the ===ANGLE=== / NAME: / BODY: delimited format returned by
 * prompts/extract_angles.md. More robust than asking Haiku to emit JSON with
 * multi-line markdown values.
 */
function parseDelimitedAngles(text: string): { name: string; block: string }[] {
  const chunks = text.split(/^===ANGLE===\s*$/m).map((c) => c.trim()).filter(Boolean);
  const angles: { name: string; block: string }[] = [];
  for (const chunk of chunks) {
    const nameMatch = chunk.match(/^\s*NAME:\s*(.+?)\s*$/m);
    const bodyIdx = chunk.search(/^BODY:\s*$/m);
    if (!nameMatch || bodyIdx === -1) continue;
    const afterBody = chunk.slice(bodyIdx).replace(/^BODY:\s*\n?/, "").trim();
    if (!afterBody) continue;
    angles.push({ name: nameMatch[1].trim(), block: afterBody });
  }
  return angles;
}

/**
 * GET /api/products?brandId=... — list products for one brand, newest first.
 * brandId is required in the multi-brand world — without it we'd leak other
 * brands' products into the active workspace.
 */
productsRouter.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const brandId = typeof req.query.brandId === "string" ? req.query.brandId : "";
    if (!brandId) return sendError(res, 400, "brandId query param is required");
    const { user, role } = req.auth!;
    if (!(await canSeeBrand(user.id, role, brandId))) {
      // Don't leak existence — return an empty product list, same as
      // if the brand legitimately had zero products. The 404 happens
      // upstream when the client tries to load the brand itself.
      return res.json({ products: [] });
    }
    const rows = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.brandId, brandId))
      .orderBy(desc(schema.products.createdAt));
    res.json({ products: rows });
  } catch (err) {
    console.error("[products] list failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// Gate every /:id route after this point. Mounting once is mechanical
// cover for GET/:id, PATCH/:id, DELETE/:id, plus every nested POST/PUT
// under /:id (angles, mechanism, research, reassign-brand, etc.).
productsRouter.use("/:id", requireAuth, gateByProductAccess);

/**
 * GET /api/products/:id — fetch one product (used for polling research status).
 */
productsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Product not found");
    // Auto-heal: if this product has a reference sheet but no mechanism
    // extraction (orphaned by a crashed chain runner, a manual rescue, or
    // a failed extractor), kick the extractor off in the background.
    // Idempotent — re-running while extraction is in flight is a no-op.
    const research = (row.research ?? {}) as Record<string, unknown>;
    maybeTriggerMechanismExtraction(row.id, research, row.productImageUrl);
    res.json({ product: row });
  } catch (err) {
    console.error("[products] get failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * PATCH /api/products/:id — partial update. Currently exposes `name` only;
 * other fields are managed by their dedicated endpoints (mechanism,
 * reference-sheet, research, images, etc.) which run side effects. Name
 * editing is the simple "user mistyped the product name and wants to rename"
 * path; no downstream regeneration needed.
 */
productsRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { name?: unknown };
    const updates: Partial<typeof schema.products.$inferInsert> = {};
    if (typeof body.name === "string") {
      const trimmed = body.name.trim();
      if (!trimmed) return sendError(res, 400, "name must not be empty");
      if (trimmed.length > 200) return sendError(res, 400, "name must be 200 characters or fewer");
      updates.name = trimmed;
    }
    if (Object.keys(updates).length === 0) {
      return sendError(res, 400, "No supported fields provided. Patch only accepts: name");
    }
    const [row] = await db
      .update(schema.products)
      .set(updates)
      .where(eq(schema.products.id, req.params.id))
      .returning();
    if (!row) return sendError(res, 404, "Product not found");
    res.json({ product: row });
  } catch (err) {
    console.error("[products] patch failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/products/:id/reassign-brand — move a product to a different brand.
 *
 * Body: { newBrandId: string, dryRun?: boolean }
 *
 * Updates the product's `brandId` AND every row in brand_assets / lp_builds
 * that references this product, so the move is consistent across all
 * downstream tables. Without this the product would land on the new brand
 * but its generated assets would still show under the old brand.
 *
 * `dryRun: true` returns the would-be counts without writing anything,
 * useful for confirming the scope of a move before committing.
 */
productsRouter.post("/:id/reassign-brand", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const body = (req.body ?? {}) as { newBrandId?: unknown; dryRun?: unknown };
    const newBrandId = typeof body.newBrandId === "string" ? body.newBrandId.trim() : "";
    const dryRun = body.dryRun === true;
    if (!newBrandId) return sendError(res, 400, "newBrandId is required");

    // Verify both rows exist before mutating anything.
    const [product] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id))
      .limit(1);
    if (!product) return sendError(res, 404, "Product not found");

    const [newBrand] = await db
      .select()
      .from(schema.brands)
      .where(eq(schema.brands.id, newBrandId))
      .limit(1);
    if (!newBrand) return sendError(res, 404, "newBrandId does not match an existing brand");

    // Caller must also have access to the TARGET brand — gateByProductAccess
    // already proved access on the source (via the product's current
    // brandId), but the target might be a brand the user can't see.
    const { user, role } = req.auth!;
    if (!(await canSeeBrand(user.id, role, newBrandId))) {
      return sendError(res, 404, "newBrandId does not match an existing brand");
    }

    if (product.brandId === newBrandId) {
      return res.json({
        ok: true,
        message: "Product is already on the target brand — nothing to do.",
        product,
      });
    }

    // Count what would move so the response is informative either way.
    // `safeCount` swallows "relation does not exist" errors so this
    // endpoint stays usable on production databases that haven't applied
    // the LP cloner migration yet (lp_builds may not exist there).
    const safeCount = async <T>(fn: () => Promise<T[]>): Promise<T[]> => {
      try { return await fn(); } catch (e) {
        console.warn("[products] reassign ref count skipped:", (e as Error).message);
        return [];
      }
    };
    // lp_builds may not exist on this deployment (LP cloner schema isn't
    // shipped everywhere). Use raw SQL with a try/catch so the missing
    // relation reports zero refs instead of TypeError.
    const safeCountRaw = async (table: string, column: string, value: string): Promise<number> => {
      try {
        const result = await db.execute(sqlTag.raw(
          `SELECT COUNT(*)::int AS count FROM "${table}" WHERE "${column}" = '${value}'`,
        ));
        const rows = (result as unknown as { rows?: Array<{ count: number }> }).rows ?? [];
        return rows[0]?.count ?? 0;
      } catch {
        return 0;
      }
    };
    const [assets, lpBuildsCount] = await Promise.all([
      safeCount(() => db.select({ id: schema.brandAssets.id }).from(schema.brandAssets).where(eq(schema.brandAssets.productId, id))),
      safeCountRaw("lp_builds", "product_id", id),
    ]);
    const counts = {
      brandAssets: assets.length,
      lpBuilds: lpBuildsCount,
    };

    if (dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        from: { brandId: product.brandId, brandName: undefined },
        to: { brandId: newBrand.id, brandName: newBrand.name },
        wouldMove: counts,
      });
    }

    // Perform the move. Three updates, all keyed by the product id. No
    // transaction wrapper because drizzle's default postgres driver
    // setup here doesn't expose one cleanly — but the updates are
    // idempotent and side-effect-free, so a partial failure is safe to
    // retry.
    const safeUpdate = async (label: string, fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e) {
        console.warn(`[products] reassign update skipped ${label}:`, (e as Error).message);
      }
    };
    await Promise.all([
      db
        .update(schema.products)
        .set({ brandId: newBrandId })
        .where(eq(schema.products.id, id)),
      counts.brandAssets > 0
        ? db
            .update(schema.brandAssets)
            .set({ brandId: newBrandId })
            .where(eq(schema.brandAssets.productId, id))
        : Promise.resolve(),
      counts.lpBuilds > 0
        ? safeUpdate("lp_builds", () => db.execute(sqlTag.raw(
            `UPDATE "lp_builds" SET "brand_id" = '${newBrandId}' WHERE "product_id" = '${id}'`,
          )))
        : Promise.resolve(),
    ]);

    console.log(
      `[products] reassigned ${id} (${JSON.stringify(product.name)}) from brand ${product.brandId} → ${newBrandId} (${JSON.stringify(newBrand.name)}). Updated ${counts.brandAssets} asset(s), ${counts.lpBuilds} lp_build(s).`,
    );
    res.json({
      ok: true,
      moved: { productId: id, from: product.brandId, to: newBrandId },
      counts,
    });
  } catch (err) {
    console.error("[products] reassign-brand failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * DELETE /api/products/:id — hard-delete a product. Brand assets that were
 * tagged with this productId keep their soft reference; they're still valid
 * assets, just no longer filterable by the deleted product. No FK cascade.
 */
productsRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const result = await db
      .delete(schema.products)
      .where(eq(schema.products.id, req.params.id))
      .returning({ id: schema.products.id });
    if (result.length === 0) return sendError(res, 404, "Product not found");
    res.json({ ok: true, id: result[0].id });
  } catch (err) {
    console.error("[products] delete failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/products
 * Body: { brandId: string, productUrl?: string, factSheet?: string,
 *         name?: string, category?: string,
 *         productImageUrl?: string, productBackImageUrl?: string,
 *         contentImageUrl?: string }
 * One of productUrl or factSheet is required. Creates the product row, returns
 * it immediately, then kicks off research async.
 */
productsRouter.post("/", requireAuth, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    brandId?: string;
    productUrl?: string;
    factSheet?: string;
    name?: string;
    category?: string;
    productImageUrl?: string;
    productBackImageUrl?: string;
    contentImageUrl?: string;
  };

  if (!body.brandId || typeof body.brandId !== "string") {
    return sendError(res, 400, "brandId is required");
  }
  const { user, role } = req.auth!;
  if (!(await canSeeBrand(user.id, role, body.brandId))) {
    return sendError(res, 404, "Brand not found");
  }
  const productUrl = body.productUrl?.trim() || "";
  const factSheet = body.factSheet?.trim() || "";
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

  let name = body.name?.trim() || "";
  const category = body.category?.trim() || "Uncategorized";
  let productImageUrl = body.productImageUrl ?? null;
  let imageCandidates: { url: string; width: number | null; height: number | null; source: string; score: number }[] = [];

  // Only scrape if a URL was provided — fact-sheet flow skips this entirely.
  if (productUrl) {
    try {
      const meta = await fetchUrlMeta(productUrl);
      if (!name) name = meta.title ?? meta.siteName ?? productUrl;
      if (!productImageUrl) productImageUrl = meta.image;
      imageCandidates = meta.imageCandidates;
    } catch (err) {
      console.warn("[products] urlMeta fetch failed:", err);
    }
  }
  if (!name) name = factSheet ? factSheet.slice(0, 60) : "Untitled Product";

  try {
    const [row] = await db
      .insert(schema.products)
      .values({
        brandId: body.brandId,
        name,
        category,
        productUrl: productUrl || null,
        factSheet: factSheet || null,
        productImageUrl,
        productBackImageUrl: body.productBackImageUrl ?? null,
        contentImageUrl: body.contentImageUrl ?? null,
        researchStatus: "pending",
        research: imageCandidates.length > 0 ? { imageCandidates } : null,
      })
      .returning();

    // Kick off research asynchronously — do not await.
    void runResearch(row.id);

    res.json({ product: row });
  } catch (err) {
    console.error("[products] create failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * GET /api/products/:id/angles
 * Returns the 5 strategic angles extracted from the product's research markdown.
 * Cached on products.research.angles after first extraction.
 */
productsRouter.get("/:id/angles", async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Product not found");

    const research = (row.research ?? {}) as Record<string, unknown>;
    const cached = (research as { angles?: { name: string; block: string }[] }).angles;
    if (Array.isArray(cached) && cached.length > 0) {
      return res.json({ angles: cached, cached: true });
    }

    const markdown = typeof research.markdown === "string" ? research.markdown : "";
    if (!markdown) {
      return sendError(res, 424, "Research markdown not available yet");
    }

    const prompt = loadPrompt("extract_angles", { markdown });
    const result = await generateText({
      systemPrompt: prompt.rendered,
      userMessage: "Extract the 5 angles.",
      model: prompt.config.model,
      maxTokens: prompt.config.maxTokens,
      tools: prompt.config.tools,
    });

    const parsed = parseDelimitedAngles(result.text);
    if (parsed.length === 0) {
      throw new Error("Angle extractor returned no angles");
    }

    await db
      .update(schema.products)
      .set({ research: { ...research, angles: parsed } })
      .where(eq(schema.products.id, row.id));

    await db.insert(schema.generations).values({
      action: "extract_angles",
      kind: "text",
      inputs: { productId: row.id },
      output: { angles: parsed },
      model: result.model,
      promptVersion: prompt.version,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: String(result.costUsd),
      durationMs: result.durationMs,
    });

    res.json({ angles: parsed, cached: false });
  } catch (err) {
    if (err instanceof PromptNotConfiguredError) {
      return sendError(res, 424, err.message);
    }
    console.error("[products] extract angles failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/products/:id/angles
 * Body: { description: string }
 *
 * Elaborates a user-supplied strategic angle description into a full angle
 * block (matching the shape of the auto-extracted angles) and appends it to
 * products.research.angles. Returns the new angle.
 *
 * Only runs Claude for this one angle — does NOT re-run the full product
 * research or re-extract all 5 existing angles.
 */
productsRouter.post("/:id/angles", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { description?: string };
    const description = body.description?.trim() ?? "";
    if (!description) return sendError(res, 400, "description is required");

    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Product not found");

    const research = (row.research ?? {}) as Record<string, unknown> & {
      markdown?: string;
      angles?: { name: string; block: string }[];
    };
    const markdown = typeof research.markdown === "string" ? research.markdown : "";
    if (!markdown) {
      return sendError(res, 424, "Research markdown not available yet — run product research first");
    }

    const prompt = loadPrompt("angle_elaborate", {
      description,
      research: markdown,
    });
    const result = await generateText({
      systemPrompt: prompt.rendered,
      userMessage: "Elaborate the user's angle into the full format.",
      model: prompt.config.model,
      maxTokens: prompt.config.maxTokens,
      tools: prompt.config.tools,
    });

    const parsed = parseDelimitedAngles(result.text);
    const angle = parsed[0];
    if (!angle) {
      throw new Error("Angle elaborator returned no parseable angle");
    }

    const existing = Array.isArray(research.angles) ? research.angles : [];
    const nextAngles = [...existing, angle];

    await db
      .update(schema.products)
      .set({ research: { ...research, angles: nextAngles } })
      .where(eq(schema.products.id, row.id));

    await db.insert(schema.generations).values({
      action: "angle_elaborate",
      kind: "text",
      inputs: { productId: row.id, description },
      output: { angle },
      model: result.model,
      promptVersion: prompt.version,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: String(result.costUsd),
      durationMs: result.durationMs,
    });

    res.json({ angle, angles: nextAngles });
  } catch (err) {
    if (err instanceof PromptNotConfiguredError) {
      return sendError(res, 424, err.message);
    }
    console.error("[products] add angle failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * GET /api/products/:id/mechanism
 * Returns the cached mechanism JSON. If not cached yet, runs the extractor
 * synchronously (legacy path used by the B-roll app).
 */
productsRouter.get("/:id/mechanism", async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Product not found");

    const research = (row.research ?? {}) as Record<string, unknown>;
    const cached = (research as { mechanism?: unknown }).mechanism;
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return res.json({ mechanism: cached, cached: true });
    }

    if (!row.productImageUrl) {
      return sendError(res, 424, "Product has no image — upload one before extracting the mechanism.");
    }

    const mechanism = await extractMechanismSync(row.id, row.productImageUrl);
    res.json({ mechanism, cached: false });
  } catch (err) {
    if (err instanceof PromptNotConfiguredError) {
      return sendError(res, 424, err.message);
    }
    console.error("[products] extract mechanism failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/products/:id/mechanism — manually (re-)trigger the async extractor.
 */
productsRouter.post("/:id/mechanism", async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Product not found");
    if (!row.productImageUrl) {
      return sendError(res, 424, "Product has no image — upload one before extracting the mechanism.");
    }

    const research = (row.research ?? {}) as Record<string, unknown>;
    await db
      .update(schema.products)
      .set({
        research: { ...research, mechanismStatus: "running", mechanismError: null },
      })
      .where(eq(schema.products.id, row.id));

    void runMechanismExtraction(row.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[products] mechanism retrigger failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/products/:id/reference-sheet — manually (re-)trigger the reference
 * sheet generator. Existing products that never had one get this button in the UI;
 * new products run it automatically after research.
 */
productsRouter.post("/:id/reference-sheet", async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Product not found");
    if (!row.productImageUrl) {
      return sendError(res, 424, "Product has no image — upload one before generating the reference sheet.");
    }

    // Optional feedback: when present, the runner uses the existing reference
    // sheet as the edit base (IMAGE 1 in the nano-banana-pro/edit input list)
    // and appends the feedback as a directive the model must apply. This is
    // the "regenerate with feedback" path — distinct from a from-scratch regen
    // because we want to evolve the current sheet, not recompose it.
    const bodyFeedback = typeof (req.body as { feedback?: unknown })?.feedback === "string"
      ? ((req.body as { feedback: string }).feedback).trim()
      : "";
    const feedback = bodyFeedback.length > 0 ? bodyFeedback : undefined;

    const research = (row.research ?? {}) as Record<string, unknown>;
    await db
      .update(schema.products)
      .set({
        research: {
          ...research,
          referenceSheetStatus: "running",
          referenceSheetError: null,
          mechanismStatus: "running",
          mechanismError: null,
        },
      })
      .where(eq(schema.products.id, row.id));

    void runReferenceSheetGeneration(row.id, { feedback });
    res.json({ ok: true });
  } catch (err) {
    console.error("[products] reference-sheet retrigger failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * PUT /api/products/:id/mechanism — save a user-edited mechanism array back
 * into research.mechanism. The model's extractor returns the same shape; this
 * endpoint is the "edit and save" path so the user can correct hallucinated
 * specs (wrong material, wrong opening mechanism, etc.) without re-running
 * the extractor. The saved mechanism is what downstream B-roll / image prompt
 * generators read, so hand-corrected specs propagate through the pipeline.
 */
productsRouter.put("/:id/mechanism", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { mechanism?: unknown };
    if (!Array.isArray(body.mechanism)) {
      return sendError(res, 400, "Body must include `mechanism` as an array.");
    }
    // Validate every entry has the 8 expected string fields. We coerce missing
    // fields to "" rather than rejecting — a freshly-added entry from the UI
    // may have blanks the user hasn't filled in yet.
    const allowedKeys = [
      "product_id",
      "physical_description",
      "container_material",
      "opening",
      "dispensing",
      "closing",
      "content_color",
      "viscosity",
    ] as const;
    const clean: Record<string, string>[] = [];
    for (const raw of body.mechanism) {
      if (!raw || typeof raw !== "object") {
        return sendError(res, 400, "Every mechanism entry must be an object.");
      }
      const entry: Record<string, string> = {};
      for (const k of allowedKeys) {
        const v = (raw as Record<string, unknown>)[k];
        entry[k] = typeof v === "string" ? v : v == null ? "" : String(v);
      }
      clean.push(entry);
    }

    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Product not found");

    const research = (row.research ?? {}) as Record<string, unknown>;
    await db
      .update(schema.products)
      .set({
        research: {
          ...research,
          mechanism: clean,
          // Mark the edit timestamp so the UI can show "last edited".
          // We keep mechanismGeneratedAt pointing at the model run; edits
          // don't overwrite it. mechanismStatus stays "complete" — an edit
          // is an accepted state, not a failure.
          mechanismEditedAt: new Date().toISOString(),
          mechanismStatus: "complete",
          mechanismError: null,
        },
      })
      .where(eq(schema.products.id, row.id));

    res.json({ ok: true, mechanism: clean });
  } catch (err) {
    console.error("[products] mechanism save failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

type StoredCandidate = {
  url: string;
  width: number | null;
  height: number | null;
  source: string;
  score: number;
};

function readCandidates(research: Record<string, unknown>): StoredCandidate[] {
  const raw = (research as { imageCandidates?: unknown }).imageCandidates;
  return Array.isArray(raw) ? (raw as StoredCandidate[]) : [];
}

/**
 * POST /api/products/:id/upload-image
 * Body: { dataUrl: "data:image/...;base64,...", filename?: string }
 * Uploads to fal.storage, appends to products.research.imageCandidates as a
 * top-ranked "user-upload" entry. Caller can then promote it to main image.
 */
productsRouter.post("/:id/upload-image", async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Product not found");

    const body = (req.body ?? {}) as { dataUrl?: string; filename?: string };
    if (!body.dataUrl || !body.dataUrl.startsWith("data:")) {
      return sendError(res, 400, "dataUrl (data:<mime>;base64,...) is required");
    }
    const match = body.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return sendError(res, 400, "dataUrl must be base64-encoded");
    const mime = match[1];
    if (!mime.startsWith("image/")) return sendError(res, 400, "Only image/* uploads are allowed");
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.byteLength > 8 * 1024 * 1024) return sendError(res, 413, "Image exceeds 8MB limit");

    const ext = mime.split("/")[1]?.split("+")[0] ?? "png";
    const filename = body.filename?.replace(/[^a-z0-9._-]/gi, "_") || `upload-${Date.now()}.${ext}`;
    const uploadedUrl = await uploadToFalStorage(buffer, mime, filename);

    const research = (row.research ?? {}) as Record<string, unknown>;
    const existing = readCandidates(research);
    const candidate: StoredCandidate = {
      url: uploadedUrl,
      width: null,
      height: null,
      source: "user-upload",
      score: 5000,
    };
    const next = [candidate, ...existing.filter((c) => c.url !== uploadedUrl)];
    const updatedResearch = { ...research, imageCandidates: next };

    await db
      .update(schema.products)
      .set({ research: updatedResearch })
      .where(eq(schema.products.id, row.id));

    res.json({ url: uploadedUrl, candidate, imageCandidates: next });
  } catch (err) {
    console.error("[products] upload-image failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/products/:id/main-image
 * Body: { url: string }
 * Promotes one of the imageCandidates (or any URL) to products.productImageUrl.
 */
productsRouter.post("/:id/main-image", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { url?: string };
    if (!body.url || typeof body.url !== "string") return sendError(res, 400, "url is required");

    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Product not found");

    await db
      .update(schema.products)
      .set({ productImageUrl: body.url })
      .where(eq(schema.products.id, row.id));
    res.json({ ok: true, productImageUrl: body.url });
  } catch (err) {
    console.error("[products] main-image failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/products/:id/image-candidate
 * Body: { url: string }
 * Adds an arbitrary image URL to the imageCandidates list (user-supplied shot).
 */
productsRouter.post("/:id/image-candidate", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { url?: string };
    if (!body.url || typeof body.url !== "string") return sendError(res, 400, "url is required");
    try {
      new URL(body.url);
    } catch {
      return sendError(res, 400, "url is not valid");
    }

    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Product not found");

    const research = (row.research ?? {}) as Record<string, unknown>;
    const existing = readCandidates(research);
    if (existing.some((c) => c.url === body.url)) {
      return res.json({ ok: true, imageCandidates: existing });
    }
    const candidate: StoredCandidate = {
      url: body.url,
      width: null,
      height: null,
      source: "user-url",
      score: 4500,
    };
    const next = [candidate, ...existing];
    await db
      .update(schema.products)
      .set({ research: { ...research, imageCandidates: next } })
      .where(eq(schema.products.id, row.id));
    res.json({ ok: true, candidate, imageCandidates: next });
  } catch (err) {
    console.error("[products] image-candidate failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * DELETE /api/products/:id/image-candidate
 * Body: { url: string }
 * Removes the candidate with this URL from research.imageCandidates. If that
 * URL is currently productImageUrl (main image), clears productImageUrl —
 * the caller can then promote a different candidate.
 */
productsRouter.delete("/:id/image-candidate", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { url?: string };
    if (!body.url || typeof body.url !== "string") return sendError(res, 400, "url is required");

    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Product not found");

    const research = (row.research ?? {}) as Record<string, unknown>;
    const existing = readCandidates(research);
    const next = existing.filter((c) => c.url !== body.url);
    const wasMain = row.productImageUrl === body.url;
    const wasBack = row.productBackImageUrl === body.url;
    const wasContent = row.contentImageUrl === body.url;
    // Idempotent success only if the URL appears NOWHERE — not in the
    // candidates array, not on any of the three canonical slots. (Before
    // the back/content fold-in landed, the candidate-array check alone
    // was enough — now we also have URLs that live only on dedicated
    // columns.)
    if (next.length === existing.length && !wasMain && !wasBack && !wasContent) {
      return res.json({ ok: true, imageCandidates: existing, productImageUrl: row.productImageUrl ?? null });
    }

    const nextMain = wasMain ? (next[0]?.url ?? null) : row.productImageUrl;

    // Each of the three canonical image slots (productImageUrl,
    // productBackImageUrl, contentImageUrl) can hold the URL being
    // deleted — clear whichever match so the gallery doesn't re-render
    // a phantom tile on next refresh. Front gets auto-promoted to the
    // next candidate; back + content just become null (the user can
    // re-upload via the Add-Reference flow if they need them back).
    await db
      .update(schema.products)
      .set({
        research: { ...research, imageCandidates: next },
        ...(wasMain ? { productImageUrl: nextMain } : {}),
        ...(wasBack ? { productBackImageUrl: null } : {}),
        ...(wasContent ? { contentImageUrl: null } : {}),
      })
      .where(eq(schema.products.id, row.id));

    res.json({ ok: true, imageCandidates: next, productImageUrl: nextMain });
  } catch (err) {
    console.error("[products] delete image-candidate failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * POST /api/products/:id/research — manually re-trigger research.
 */
productsRouter.post("/:id/research", async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, req.params.id))
      .limit(1);
    if (!row) return sendError(res, 404, "Product not found");

    await db
      .update(schema.products)
      .set({ researchStatus: "pending", researchError: null })
      .where(eq(schema.products.id, row.id));

    void runResearch(row.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[products] re-research failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

/**
 * Async research runner.
 * Reads productUrl / factSheet off the row itself so callers don't have to
 * pass them. Marks the row as "researching", calls Claude with the
 * product_research prompt, stores the full markdown report as
 * { markdown: "..." } in research jsonb, and flips researchStatus to "complete"
 * or "failed". Also writes a row to generations for accounting.
 */
export async function runResearch(productId: string) {
  const started = Date.now();
  try {
    const [existing] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1);
    if (!existing) return;
    const priorResearch = (existing.research ?? {}) as Record<string, unknown>;
    const productUrl = existing.productUrl ?? "";
    const factSheet = existing.factSheet ?? "";

    await db
      .update(schema.products)
      .set({ researchStatus: "researching", researchError: null })
      .where(eq(schema.products.id, productId));

    // Prompt variables: pass both, let the master prompt's conditional logic
    // decide which branch to walk. Empty string for the missing one.
    const vars = { url: productUrl, factSheet };
    const prompt = loadPrompt(RESEARCH_ACTION, vars);
    const userMessage = productUrl
      ? `Product URL: ${productUrl}`
      : `No product URL was provided. Analyse the product using the fact sheet in the system prompt.`;
    const result = await generateText({
      systemPrompt: prompt.rendered,
      userMessage,
      maxTokens: prompt.config.maxTokens,
      tools: prompt.config.tools,
    });

    const researchData: Record<string, unknown> = {
      // Preserve scrape-time metadata (imageCandidates, user uploads).
      ...priorResearch,
      markdown: result.text,
      model: result.model,
      promptVersion: prompt.version,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      completedAt: new Date().toISOString(),
    };

    // Pre-extract angles from the fresh markdown so the Message Testing /
    // B-roll apps feel instant on first open. Lazy fallback on the GET route
    // still handles older products that were researched before this was added.
    try {
      const anglesPrompt = loadPrompt("extract_angles", { markdown: result.text });
      const anglesResult = await generateText({
        systemPrompt: anglesPrompt.rendered,
        userMessage: "Extract the 5 angles.",
        model: anglesPrompt.config.model,
        maxTokens: anglesPrompt.config.maxTokens,
        tools: anglesPrompt.config.tools,
      });
      const angles = parseDelimitedAngles(anglesResult.text);
      if (angles.length > 0) {
        researchData.angles = angles;
        await db.insert(schema.generations).values({
          action: "extract_angles",
          kind: "text",
          inputs: { productId },
          output: { angles },
          model: anglesResult.model,
          promptVersion: anglesPrompt.version,
          tokensIn: anglesResult.tokensIn,
          tokensOut: anglesResult.tokensOut,
          costUsd: String(anglesResult.costUsd),
          durationMs: anglesResult.durationMs,
        });
        console.log(`[products] pre-extracted ${angles.length} angles for ${productId}`);
      }
    } catch (err) {
      console.warn(
        `[products] angle pre-extraction failed for ${productId}; lazy GET fallback will handle it:`,
        err
      );
    }

    // Mark mechanism + reference sheet as running so the UI shows spinners
    // instead of "Generate" buttons the moment research flips to complete.
    researchData.mechanismStatus = "running";
    researchData.referenceSheetStatus = "running";

    await db
      .update(schema.products)
      .set({
        research: researchData,
        researchStatus: "complete",
      })
      .where(eq(schema.products.id, productId));

    await db.insert(schema.generations).values({
      action: RESEARCH_ACTION,
      kind: "text",
      inputs: { productId, ...vars },
      output: { text: result.text },
      model: result.model,
      promptVersion: prompt.version,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: String(result.costUsd),
      durationMs: result.durationMs,
    });

    console.log(
      `[products] research complete for ${productId} in ${Date.now() - started}ms — ` +
      `$${result.costUsd.toFixed(4)}, ${result.tokensIn} in / ${result.tokensOut} out`
    );

    // Fire-and-forget the post-processing pipeline. Reference sheet runs first,
    // then chains to mechanism extraction using the sheet + product photo as input.
    void runReferenceSheetGeneration(productId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[products] research failed for ${productId}:`, err);

    await db
      .update(schema.products)
      .set({
        researchStatus: "failed",
        researchError: err instanceof PromptNotConfiguredError
          ? "Research prompt not configured. Create prompts/product_research.md."
          : msg,
      })
      .where(eq(schema.products.id, productId));

    await db.insert(schema.generations).values({
      action: RESEARCH_ACTION,
      kind: "text",
      inputs: { productId },
      output: null,
      model: "unknown",
      error: msg,
      durationMs: Date.now() - started,
    });
  }
}

/**
 * Vision extraction of container/opening/dispensing/closing/content_color/viscosity.
 * Returns the parsed JSON and also stores it + a generations row.
 */
async function extractMechanismSync(
  productId: string,
  productImageUrl: string,
  referenceSheetUrl?: string | null,
): Promise<unknown> {
  const toHttps = (u: string) => u.replace(/^http:\/\//, "https://");
  const imageUrls = [
    referenceSheetUrl ? toHttps(referenceSheetUrl) : null,
    toHttps(productImageUrl),
  ].filter((u): u is string => Boolean(u));
  const prompt = loadPrompt("extract_mechanism", {});
  const result = await generateText({
    systemPrompt: prompt.rendered,
    userMessage: referenceSheetUrl
      ? "Extract the mechanism specs. The first image is the technical reference sheet; the second is a raw product photo. Return JSON only."
      : "Extract the mechanism specs for every visible product. Return JSON only.",
    model: prompt.config.model,
    maxTokens: prompt.config.maxTokens,
    imageUrls,
  });

  // Use the centralised JSON extractor — handles truncation, balanced-brace
  // recovery, and includes stop_reason in error messages for easier debug.
  let mechanism: unknown;
  try {
    mechanism = extractJsonObject(result.text, {
      stopReason: result.stopReason,
      action: "Mechanism extractor",
    });
  } catch (err) {
    console.error(
      `[products] mechanism parse failed for product ${productId}.\n` +
      `stop_reason=${result.stopReason} tokensOut=${result.tokensOut}\n` +
      `RAW OUTPUT:\n${result.text}`
    );
    throw err;
  }

  const [row] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, productId))
    .limit(1);
  const research = (row?.research ?? {}) as Record<string, unknown>;
  await db
    .update(schema.products)
    .set({
      research: {
        ...research,
        mechanism,
        mechanismStatus: "complete",
        mechanismError: null,
        mechanismGeneratedAt: new Date().toISOString(),
      },
    })
    .where(eq(schema.products.id, productId));

  await db.insert(schema.generations).values({
    action: "extract_mechanism",
    kind: "text",
    inputs: { productId, imageUrl: productImageUrl, referenceSheetUrl: referenceSheetUrl ?? null },
    output: { mechanism },
    model: result.model,
    promptVersion: prompt.version,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: String(result.costUsd),
    durationMs: result.durationMs,
  });

  return mechanism;
}

/**
 * Inspect a product's research blob and decide whether the mechanism
 * extractor needs to be (re-)triggered. Fire-and-forget.
 *
 * Why this exists:
 *   The happy path is runReferenceSheetGeneration → runMechanismExtraction
 *   chained in-process. But that chain can be broken several ways:
 *     (a) Server crash / restart between sheet completion and mechanism start
 *         (the chained call is `void runMechanismExtraction(...)` — fire-and-
 *         forget — so a redeploy at the wrong moment leaves an orphan).
 *     (b) Manual rescue scripts that write `referenceSheetUrl` straight to
 *         the row without invoking the runner.
 *     (c) Mechanism extraction itself failing on a transient fal hiccup
 *         (Claude vision call dropped, JSON parse failed, etc.).
 *   Without auto-heal, the product is stuck in "sheet but no mechanism"
 *   state until a human notices. The single-product GET handler calls this
 *   so any orphan heals the moment the user opens its workspace; the
 *   boot-time sweep in server/index.ts catches the rest.
 *
 * Idempotent: re-running while an extraction is already in flight is a
 * no-op (we re-read inside the IIFE before flipping status to "running").
 *
 * Returns true if extraction was kicked off (for logging at the call site).
 */
export function maybeTriggerMechanismExtraction(
  productId: string,
  research: Record<string, unknown>,
  productImageUrl: string | null | undefined,
): boolean {
  if (!productImageUrl) return false;
  if ((research as { referenceSheetStatus?: string }).referenceSheetStatus !== "complete") return false;
  if (!(research as { referenceSheetUrl?: string }).referenceSheetUrl) return false;
  const mech = (research as { mechanism?: unknown }).mechanism;
  const status = (research as { mechanismStatus?: string }).mechanismStatus;
  const haveMech = Array.isArray(mech) && mech.length > 0;
  // Already healthy — done.
  if (status === "complete" && haveMech) return false;
  // Currently in-flight — leave it alone (the running extractor will finish
  // or fail; the next GET after that will heal a failure).
  if (status === "running") return false;
  // Anything else (pending, failed, undefined, or "complete" with empty
  // mechanism) is fair game for a re-trigger.
  void (async () => {
    try {
      // Re-read fresh to handle the race where two GETs both see "pending"
      // and both try to trigger — the second one will see "running" here
      // and bail.
      const [row] = await db
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, productId))
        .limit(1);
      if (!row) return;
      const fresh = (row.research ?? {}) as Record<string, unknown>;
      const freshStatus = (fresh as { mechanismStatus?: string }).mechanismStatus;
      const freshMech = (fresh as { mechanism?: unknown }).mechanism;
      if (freshStatus === "running") return;
      if (freshStatus === "complete" && Array.isArray(freshMech) && freshMech.length > 0) return;
      console.log(
        `[products] auto-healing mechanism for ${productId} (referenceSheet=complete, mechanismStatus=${freshStatus ?? "(none)"})`,
      );
      await db
        .update(schema.products)
        .set({
          research: { ...fresh, mechanismStatus: "running", mechanismError: null },
        })
        .where(eq(schema.products.id, productId));
      await runMechanismExtraction(productId);
    } catch (err) {
      console.error(`[products] auto-heal trigger failed for ${productId}:`, err);
    }
  })();
  return true;
}

/**
 * Boot-time sweep: find every product that has a complete reference sheet
 * but no mechanism and trigger extraction. Runs once at server startup.
 *
 * Step 1 — reset any "running" status to "pending". Anything in "running"
 *   at boot time was orphaned by the previous process's exit; the in-flight
 *   extractor died with the server. Resetting unblocks step 2.
 * Step 2 — scan for orphans (referenceSheetStatus=complete + no mechanism)
 *   and trigger extraction for each, throttled so we don't hammer fal /
 *   Anthropic at startup.
 *
 * Idempotent: products with mechanism already extracted are skipped; the
 * helper itself is idempotent re: in-flight extractions.
 */
export async function sweepOrphanedMechanismExtractions(): Promise<{
  resetRunning: number;
  triggered: number;
  skipped: number;
}> {
  // Step 1: reset "running" → "pending" for crash-orphans.
  let resetRunning = 0;
  try {
    const stuck = await db
      .select()
      .from(schema.products);
    for (const p of stuck) {
      const research = (p.research ?? {}) as Record<string, unknown>;
      if ((research as { mechanismStatus?: string }).mechanismStatus === "running") {
        await db
          .update(schema.products)
          .set({
            research: { ...research, mechanismStatus: "pending", mechanismError: null },
          })
          .where(eq(schema.products.id, p.id));
        resetRunning++;
      }
    }
  } catch (err) {
    console.error("[products] mechanism sweep: reset stage failed:", err);
  }

  // Step 2: trigger extraction for orphans, throttled to avoid a thundering
  // herd against fal / Anthropic on boot.
  let triggered = 0;
  let skipped = 0;
  try {
    const all = await db.select().from(schema.products);
    const orphans = all.filter((p) => {
      const r = (p.research ?? {}) as Record<string, unknown>;
      if ((r as { referenceSheetStatus?: string }).referenceSheetStatus !== "complete") return false;
      if (!(r as { referenceSheetUrl?: string }).referenceSheetUrl) return false;
      if (!p.productImageUrl) return false;
      const mech = (r as { mechanism?: unknown }).mechanism;
      const status = (r as { mechanismStatus?: string }).mechanismStatus;
      if (status === "complete" && Array.isArray(mech) && mech.length > 0) return false;
      return true;
    });
    if (orphans.length === 0) return { resetRunning, triggered: 0, skipped: 0 };
    console.log(`[products] mechanism sweep: ${orphans.length} orphan(s) to heal`);
    // Run sequentially with a small inter-trigger delay — extractor itself
    // is mostly Anthropic-bound and a single product takes ~30s. No need to
    // parallelise at boot.
    for (const p of orphans) {
      const research = (p.research ?? {}) as Record<string, unknown>;
      try {
        await db
          .update(schema.products)
          .set({
            research: { ...research, mechanismStatus: "running", mechanismError: null },
          })
          .where(eq(schema.products.id, p.id));
        // Fire-and-forget per product — the sweep returns immediately and
        // each extraction completes (or fails) in the background. This
        // matches the fetch-time auto-heal pattern: the user can refresh
        // and see status flipping as extractions finish.
        void runMechanismExtraction(p.id);
        triggered++;
      } catch (err) {
        console.error(`[products] mechanism sweep: trigger failed for ${p.id}:`, err);
        skipped++;
      }
    }
  } catch (err) {
    console.error("[products] mechanism sweep: scan stage failed:", err);
  }
  return { resetRunning, triggered, skipped };
}

/**
 * Async runner — updates research.mechanismStatus so the UI polls can show
 * "running" / "complete" / "failed".
 */
export async function runMechanismExtraction(productId: string): Promise<void> {
  try {
    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1);
    if (!row) return;
    if (!row.productImageUrl) {
      const research = (row.research ?? {}) as Record<string, unknown>;
      await db
        .update(schema.products)
        .set({
          research: {
            ...research,
            mechanismStatus: "failed",
            mechanismError: "Product has no image — upload one before extracting the mechanism.",
          },
        })
        .where(eq(schema.products.id, productId));
      return;
    }
    const research = (row.research ?? {}) as Record<string, unknown>;
    const referenceSheetUrl =
      typeof research.referenceSheetUrl === "string" ? research.referenceSheetUrl : null;
    await extractMechanismSync(productId, row.productImageUrl, referenceSheetUrl);
    console.log(`[products] mechanism extracted for ${productId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[products] mechanism extraction failed for ${productId}:`, err);
    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1);
    const research = (row?.research ?? {}) as Record<string, unknown>;
    await db
      .update(schema.products)
      .set({
        research: { ...research, mechanismStatus: "failed", mechanismError: msg },
      })
      .where(eq(schema.products.id, productId));
  }
}

// ── Bundle classification ─────────────────────────────────────────────
// Persisted on `research.bundle`. When a product is a BUNDLE (multiple
// distinct components in one offering), the reference-sheet generator
// switches to the per-component variant so each component gets its own
// labelled hero / orthographic / opening-mechanism / dispensing /
// content-swatch row. Single products skip this entirely — same prompt,
// same vars as before. See `prompts/product_bundle_classify.md`.

type BundleComponent = {
  label: string;
  packagingDescription: string;
  openingMechanism: string;
  dispensing: string;
  contentAppearance: string;
  approximateSize: string | null;
};

type BundleClassification = {
  isBundle: boolean;
  rationale?: string;
  components: BundleComponent[];
  classifiedAt: string;
  model?: string;
};

/**
 * Run the classifier and parse its output. Returns null on any failure
 * (model error, parse error, missing fields) so the caller can fall
 * through to the existing single-product code path. We never let
 * a classifier failure break reference-sheet generation.
 */
async function classifyBundleSafe(args: {
  productId: string;
  productInfoShort: string;
  factSheet: string;
  researchMarkdown: string;
  imageUrls: string[];
}): Promise<BundleClassification | null> {
  try {
    const prompt = loadPrompt("product_bundle_classify", {
      product_info_short: args.productInfoShort || "(none)",
      fact_sheet: args.factSheet?.trim() || "(none provided)",
      // Truncate research the same way the main prompt does so the
      // classifier doesn't pay for a 6KB+ context every call.
      research_markdown:
        (args.researchMarkdown ?? "").length > 6000
          ? (args.researchMarkdown ?? "").slice(0, 6000) + "\n\n[...truncated]"
          : args.researchMarkdown || "(none)",
    });
    // Vision input: the supplied product photos. Cap at 6 so the call
    // is fast and the model isn't drowning in angles of the same thing.
    const imageUrls = args.imageUrls.slice(0, 6);
    const result = await generateText({
      systemPrompt: prompt.rendered,
      userMessage: "Classify this product now. Return JSON only.",
      model: prompt.config.model,
      maxTokens: prompt.config.maxTokens ?? 3000,
      imageUrls,
    });
    const parsed = extractJsonObject<{
      isBundle?: unknown;
      rationale?: unknown;
      components?: unknown;
    }>(result.text, { stopReason: result.stopReason ?? undefined, action: "product_bundle_classify" });

    if (typeof parsed.isBundle !== "boolean" || !Array.isArray(parsed.components)) {
      console.warn(
        `[products] bundle classifier returned malformed output for ${args.productId}; treating as single`,
      );
      return null;
    }
    const components: BundleComponent[] = parsed.components
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c) => ({
        label: typeof c.label === "string" ? c.label.trim() : "Unknown component",
        packagingDescription: typeof c.packagingDescription === "string" ? c.packagingDescription.trim() : "TBD",
        openingMechanism: typeof c.openingMechanism === "string" ? c.openingMechanism.trim() : "TBD",
        dispensing: typeof c.dispensing === "string" ? c.dispensing.trim() : "TBD",
        contentAppearance: typeof c.contentAppearance === "string" ? c.contentAppearance.trim() : "TBD",
        approximateSize:
          typeof c.approximateSize === "string" && c.approximateSize.trim() ? c.approximateSize.trim() : null,
      }));
    return {
      isBundle: parsed.isBundle,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : undefined,
      components,
      classifiedAt: new Date().toISOString(),
      model: result.model,
    };
  } catch (err) {
    console.warn(
      `[products] bundle classifier failed for ${args.productId} (falling back to single):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Render the components array into the human-readable Markdown block
 * the bundle reference-sheet prompt expects. Numbered, one component
 * per block, with every spec field labelled — this is what the
 * downstream image model reads to know which component is which.
 */
function renderComponentsBreakdown(components: BundleComponent[]): string {
  return components
    .map((c, i) => {
      const lines = [
        `### Component ${i + 1} — ${c.label}`,
        `- packagingDescription: ${c.packagingDescription}`,
        `- openingMechanism: ${c.openingMechanism}`,
        `- dispensing: ${c.dispensing}`,
        `- contentAppearance: ${c.contentAppearance}`,
        `- approximateSize: ${c.approximateSize ?? "TBD"}`,
      ];
      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * Async runner — generates the 9:16 product reference sheet via
 * fal-ai/nano-banana-pro/edit. Uses the template at
 * client/public/templates/product-reference-sheet.png as the first image input
 * and every scraped / user-provided product candidate as supporting inputs so
 * the model has all the angles and packaging shots it can fuse.
 */
async function runReferenceSheetGeneration(
  productId: string,
  opts: { feedback?: string } = {},
): Promise<void> {
  const started = Date.now();
  const feedback = opts.feedback?.trim() || undefined;
  // Debug-state hoisted above the try so the catch can persist what we
  // actually sent to fal — previous failed-generation rows only stored
  // `{ productId }` in inputs, which made diagnosing "Not Found" /
  // "Unprocessable Entity" failures basically impossible because we
  // couldn't tell which image_urls had been fed to the model.
  let debugImageUrls: string[] = [];
  let debugDroppedImages: string[] = [];
  let debugBundleUsed: { isBundle: boolean; components: number } | null = null;
  try {
    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1);
    if (!row) return;

    const research = (row.research ?? {}) as Record<string, unknown>;
    const existingSheetUrl =
      typeof (research as { referenceSheetUrl?: unknown }).referenceSheetUrl === "string"
        ? ((research as { referenceSheetUrl: string }).referenceSheetUrl as string)
        : null;

    const templateUrl = await getProductReferenceTemplateUrl();
    if (!templateUrl) {
      await db
        .update(schema.products)
        .set({
          research: {
            ...research,
            referenceSheetStatus: "failed",
            referenceSheetError:
              "Template image missing. Add client/public/templates/product-reference-sheet.png",
          },
        })
        .where(eq(schema.products.id, productId));
      return;
    }

    const candidates = readCandidates(research)
      .map((c) => c.url)
      .filter((u): u is string => typeof u === "string");
    const mainImage = row.productImageUrl ?? null;
    // Reference-sheet generation should fuse EVERY product angle the user
    // has on file — front + back + content + every scraped candidate. The
    // back and content shots live on dedicated DB columns (set by the Add
    // Product modal's image-upload flow) and were previously absent from
    // this input set. Without them the model only saw the front, so the
    // generated reference sheet couldn't reproduce back-of-pack ingredient
    // panels or lifestyle / packaging detail. Dedupe across all sources
    // since the URL may appear in both the candidates array and a column.
    const rawProductImages = Array.from(
      new Set(
        [
          mainImage,
          row.productBackImageUrl,
          row.contentImageUrl,
          ...candidates,
        ].filter((u): u is string => Boolean(u))
      )
    );

    // Sanitize the URL list before handing it to fal.ai. Two concrete
    // failure modes this catches:
    //   1) Unrendered template URLs. Some shops embed Liquid /
    //      Mustache variables in their product-grid `<img>` tags and
    //      only fill them in via client-side JS. When the scraper grabs
    //      raw HTML it sometimes pulls URLs like
    //        https://shop.example.com/products/{{ it.product.image.thumb }}
    //      The string can arrive either raw or percent-encoded
    //      (`%7B%7B`/`%7D%7D`). fal.ai then 404s fetching the URL and
    //      returns "Unprocessable Entity" for the whole request — so a
    //      single garbage candidate kills the entire reference-sheet
    //      generation even though every other URL was fine.
    //   2) `http://` URLs. fal usually upgrades, but some endpoints
    //      have rejected http:// in the past — cheap to normalise.
    //
    // We log dropped URLs so the next time a generation fails with
    // 422 we can scan logs for "dropped image_url" instead of digging
    // through a vague fal error body. Failure mode going forward is
    // "we gave fal fewer images than expected" rather than "the whole
    // request died on a broken candidate".
    const sanitizeImageUrlForFal = (url: string): string | null => {
      const trimmed = (url ?? "").trim();
      if (!trimmed) return null;
      // Reject unrendered template variables (raw or percent-encoded).
      if (
        trimmed.includes("{{") ||
        trimmed.includes("}}") ||
        /%7[bB]/.test(trimmed) ||
        /%7[dD]/.test(trimmed)
      ) {
        return null;
      }
      // Upgrade http:// → https://. (Some fal endpoints have
      // historically rejected http:// inputs.)
      const upgraded = trimmed.replace(/^http:\/\//i, "https://");
      // Final sanity: must look like a fully-qualified URL.
      try {
        const u = new URL(upgraded);
        if (u.protocol !== "https:") return null;
        return upgraded;
      } catch {
        return null;
      }
    };
    const productImages: string[] = [];
    const droppedImages: string[] = [];
    for (const u of rawProductImages) {
      const clean = sanitizeImageUrlForFal(u);
      if (clean) productImages.push(clean);
      else droppedImages.push(u);
    }
    debugDroppedImages = droppedImages;
    if (droppedImages.length > 0) {
      console.log(
        `[products] reference sheet for ${productId}: dropped ${droppedImages.length} unusable image_url(s):`,
        droppedImages,
      );
    }

    if (productImages.length === 0) {
      await db
        .update(schema.products)
        .set({
          research: {
            ...research,
            referenceSheetStatus: "failed",
            referenceSheetError:
              "Product has no image(s). Upload or scrape at least one before generating.",
          },
        })
        .where(eq(schema.products.id, productId));
      return;
    }

    // Assemble text context so the prompt can ground the product's identity
    // and dimensions in provided data instead of hallucinating from pixels.
    // - product_name / category: from the DB row
    // - fact_sheet: the user-supplied raw text (often contains dimensions)
    // - research_markdown: the full strategic diagnosis (may mention sizing)
    // - product_url: source page if we have one
    // - hero_image_note: tells the model which input image is the hero to copy
    const researchMarkdown =
      typeof (research as { markdown?: unknown }).markdown === "string"
        ? ((research as { markdown: string }).markdown as string)
        : "";
    const productInfoBlocks: string[] = [];
    productInfoBlocks.push(`Name: ${row.name || "(unknown)"}`);
    if (row.category) productInfoBlocks.push(`Category: ${row.category}`);
    if (row.productUrl) productInfoBlocks.push(`Source URL: ${row.productUrl}`);
    if (row.factSheet && row.factSheet.trim()) {
      productInfoBlocks.push(`Fact sheet (user-provided — authoritative for dimensions / specs):\n${row.factSheet.trim()}`);
    }
    if (researchMarkdown.trim()) {
      // Truncate to ~6k chars so the prompt doesn't balloon; the key sizing
      // and packaging detail in research usually appears in the first few sections.
      const truncated = researchMarkdown.length > 6000
        ? researchMarkdown.slice(0, 6000) + "\n\n[...truncated]"
        : researchMarkdown;
      productInfoBlocks.push(`Strategic research (may reference packaging / dimensions / format):\n${truncated}`);
    }
    const productInfo = productInfoBlocks.join("\n\n");

    // Feedback mode: user is asking us to evolve the existing reference sheet
    // based on written feedback. In that case the existing sheet becomes
    // IMAGE 1 (the edit base), and we skip the template — nano-banana-pro/edit
    // will anchor on the existing sheet's layout rather than re-synthesize
    // from scratch. This matches the "image feedback" pattern used in the
    // Character B-roll and Static Ads flows.
    const feedbackMode = Boolean(feedback && existingSheetUrl);

    // Build hero_image_note dynamically based on which slot the hero lives in.
    // Feedback mode: IMAGE 1 = existing sheet, IMAGE 2 = main product photo.
    // From-scratch mode: IMAGE 1 = template, IMAGE 2 = main product photo.
    // Either way the main product photo is IMAGE 2 when a mainImage exists.
    const heroImageNote = feedbackMode
      ? (mainImage
          ? "IMAGE 1 is the existing reference sheet you previously generated — use its overall composition and layout as the base to edit. IMAGE 2 is the main product photograph the user uploaded; the Hero Center must still be a faithful copy of that photo, not a redesign."
          : "IMAGE 1 is the existing reference sheet you previously generated — use its overall composition and layout as the base to edit. Among the remaining product images, pick the clearest and copy it faithfully into the Hero Center.")
      : (mainImage
          ? "IMAGE 2 in the input list is the main product photograph the user uploaded/selected. That image is the authoritative hero — copy it faithfully into the 'Hero Center' slot."
          : "No main product photograph was explicitly designated; use the clearest, highest-resolution product photo among the provided product images as the hero and copy it faithfully.");

    // feedback_note is empty on a clean regen, and becomes a strongly-worded
    // "here's what to change" block when the user supplied feedback.
    const feedbackNote = feedbackMode && feedback
      ? [
          "---",
          "",
          "# USER FEEDBACK — APPLY THIS ON TOP OF EVERYTHING ABOVE",
          "",
          "IMAGE 1 in the input list is the previous version of this reference sheet. The user reviewed it and asked for the following changes. Keep everything else the same — same hero product, same mechanism, same dimensions, same overall layout — and only adjust what the feedback explicitly calls out. Do NOT take the feedback as license to redesign the sheet from scratch or substitute a different product.",
          "",
          "User feedback:",
          feedback,
        ].join("\n")
      : "";

    // ── Bundle detection ────────────────────────────────────────────
    // Classify whether this offering is a single product or a bundle of
    // multiple distinct components. The result is cached on
    // `research.bundle` and survives feedback regens (we re-use the
    // cached classification rather than re-paying the classifier call
    // on every retrigger).
    //
    // Hard rule: if the classifier returns SINGLE (or fails), the call
    // BELOW falls through to the existing `product_reference_image`
    // prompt with the exact same vars and image inputs as before — so
    // single-product output stays bit-identical to pre-bundle behaviour.
    const cachedBundle = (research as { bundle?: BundleClassification | null }).bundle ?? null;
    const bundleClassification: BundleClassification | null =
      feedbackMode && cachedBundle
        ? cachedBundle
        : await classifyBundleSafe({
            productId,
            productInfoShort: [
              `Name: ${row.name || "(unknown)"}`,
              row.category ? `Category: ${row.category}` : "",
              row.productUrl ? `Source URL: ${row.productUrl}` : "",
            ].filter(Boolean).join("\n"),
            factSheet: row.factSheet ?? "",
            researchMarkdown,
            imageUrls: productImages,
          });
    const isBundle =
      bundleClassification?.isBundle === true &&
      Array.isArray(bundleClassification.components) &&
      bundleClassification.components.length >= 2;
    debugBundleUsed = bundleClassification
      ? { isBundle, components: bundleClassification.components?.length ?? 0 }
      : null;
    if (bundleClassification) {
      console.log(
        `[products] bundle classification for ${productId}: isBundle=${bundleClassification.isBundle}, components=${bundleClassification.components?.length ?? 0}${
          bundleClassification.rationale ? ` (${bundleClassification.rationale})` : ""
        }`,
      );
    }
    // Persist the classification so the UI / API can show "Bundle detected"
    // and so feedback regens can reuse it without re-classifying.
    if (bundleClassification && !feedbackMode) {
      const [freshForBundle] = await db
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, productId))
        .limit(1);
      const freshResearchForBundle = (freshForBundle?.research ?? {}) as Record<string, unknown>;
      await db
        .update(schema.products)
        .set({
          research: { ...freshResearchForBundle, bundle: bundleClassification },
        })
        .where(eq(schema.products.id, productId));
    }

    // Pick the prompt variant + render. Single-product → identical to
    // pre-bundle behaviour (same prompt, same vars). Bundle → the
    // per-component variant with a `components_breakdown` block that
    // tells the model what each component IS, how it opens, what it
    // dispenses, what the contents look like.
    const prompt = isBundle && bundleClassification
      ? loadPrompt("product_reference_image_bundle", {
          product_info: productInfo,
          hero_image_note: heroImageNote,
          feedback_note: feedbackNote,
          component_count: String(bundleClassification.components.length),
          components_breakdown: renderComponentsBreakdown(bundleClassification.components),
        })
      : loadPrompt("product_reference_image", {
          product_info: productInfo,
          hero_image_note: heroImageNote,
          feedback_note: feedbackNote,
        });

    // nano-banana-pro/edit takes the prompt + image_urls. Cap at 8 images.
    // - feedbackMode: IMAGE 1 = existing sheet (edit base), then product photos
    // - default: IMAGE 1 = template (layout anchor), then product photos
    const imageUrls = (
      feedbackMode && existingSheetUrl
        ? [existingSheetUrl, ...productImages]
        : [templateUrl, ...productImages]
    ).slice(0, 8);
    debugImageUrls = imageUrls;

    const result = await generateImage({
      model: "fal-ai/nano-banana-pro/edit",
      input: {
        prompt: prompt.rendered,
        image_urls: imageUrls,
        aspect_ratio: "9:16",
        resolution: "2K",
        num_images: 1,
        output_format: "jpeg",
      },
    });

    const url = result.urls[0];
    if (!url) throw new Error("nano-banana-pro/edit returned no image URL");

    const [fresh] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1);
    const freshResearch = (fresh?.research ?? {}) as Record<string, unknown>;
    await db
      .update(schema.products)
      .set({
        research: {
          ...freshResearch,
          referenceSheetUrl: url,
          referenceSheetStatus: "complete",
          referenceSheetError: null,
          referenceSheetGeneratedAt: new Date().toISOString(),
          mechanismStatus: "running",
          mechanismError: null,
        },
      })
      .where(eq(schema.products.id, productId));

    await db.insert(schema.generations).values({
      action: "product_reference_image",
      kind: "image",
      inputs: {
        productId,
        templateUrl,
        productImages: imageUrls,
        feedback: feedback ?? null,
        feedbackMode,
        editBaseSheet: feedbackMode ? existingSheetUrl : null,
      },
      output: { url, raw: result.raw },
      model: result.model,
      promptVersion: prompt.version,
      durationMs: result.durationMs,
    });

    console.log(`[products] reference sheet generated for ${productId} in ${Date.now() - started}ms`);

    // Chain mechanism extraction — uses the new reference sheet + product photo.
    void runMechanismExtraction(productId);
  } catch (err) {
    // fal-ai errors carry diagnostic info in several places depending on
    // the failure mode. We dig into all of them so the persisted error
    // tells the operator what actually went wrong instead of just
    // "Unprocessable Entity" or "Not Found":
    //
    //   - body.detail              → validation messages (e.g. "image_urls[3] could not be fetched")
    //   - body                     → some fal subdomains return the body as a string
    //   - status                   → HTTP status (422 / 404 / 500 / etc.)
    //   - name                     → error class name (ApiError / ValidationError)
    //
    // We also persist the full input the runner sent — image_urls (which
    // 90% of failures involve), URLs we dropped during sanitization, and
    // the bundle-classifier verdict — so the generations row is enough
    // by itself to reproduce or pinpoint the failure without re-running
    // the pipeline.
    const errObj = (err ?? {}) as {
      status?: number;
      body?: unknown;
      message?: string;
      name?: string;
    };
    let falDetailStr: string | null = null;
    if (errObj.body && typeof errObj.body === "object") {
      const bod = errObj.body as { detail?: unknown };
      if (typeof bod.detail === "string") {
        falDetailStr = bod.detail;
      } else if (bod.detail !== undefined) {
        try { falDetailStr = JSON.stringify(bod.detail); } catch { /* ignore */ }
      }
    } else if (typeof errObj.body === "string" && errObj.body.trim()) {
      falDetailStr = errObj.body;
    }
    const baseMsg = err instanceof Error ? err.message : String(err);
    const statusPrefix = errObj.status ? `HTTP ${errObj.status}: ` : "";
    const msg = falDetailStr
      ? `${statusPrefix}${baseMsg} — ${falDetailStr}`
      : `${statusPrefix}${baseMsg}`;
    console.error(
      `[products] reference sheet generation failed for ${productId}:`,
      err,
      `\n  status=${errObj.status ?? "(none)"}`,
      `\n  name=${errObj.name ?? "(none)"}`,
      `\n  body=${typeof errObj.body === "string" ? errObj.body.slice(0, 300) : JSON.stringify(errObj.body ?? null).slice(0, 300)}`,
      `\n  image_urls fed to fal (${debugImageUrls.length}):`,
      debugImageUrls,
      `\n  image_urls dropped at sanitize (${debugDroppedImages.length}):`,
      debugDroppedImages,
    );
    const [row] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1);
    const research = (row?.research ?? {}) as Record<string, unknown>;
    // Reference-sheet failure means mechanism extraction will never run
    // (the chain from success block doesn't fire). The POST /reference-sheet
    // endpoint pre-sets BOTH statuses to "running", so we must also clear
    // mechanismStatus here — otherwise the UI shows the mechanism as
    // "Running" forever even though nothing will ever happen.
    await db
      .update(schema.products)
      .set({
        research: {
          ...research,
          referenceSheetStatus: "failed",
          referenceSheetError: msg,
          mechanismStatus: "failed",
          mechanismError: `Reference-sheet generation failed — mechanism extraction skipped. Underlying cause: ${msg}`,
        },
      })
      .where(eq(schema.products.id, productId));

    await db.insert(schema.generations).values({
      action: "product_reference_image",
      kind: "image",
      inputs: {
        productId,
        // The actual list of URLs we sent to fal — pinpoints which image
        // the model couldn't fetch / validate when something fails server-side.
        productImages: debugImageUrls,
        // What sanitisation already removed before fal was called.
        droppedImages: debugDroppedImages,
        // Whether we routed through the bundle prompt or the single-product
        // prompt — affects the prompt vars + the components_breakdown var.
        bundleUsed: debugBundleUsed,
        feedback: feedback ?? null,
      },
      output: {
        // Stash the raw error shape so future debugging has the full
        // fal response, not just the stringified message.
        errorDetail: {
          status: errObj.status ?? null,
          name: errObj.name ?? null,
          message: errObj.message ?? null,
          body: errObj.body ?? null,
        },
      },
      model: "fal-ai/nano-banana-pro/edit",
      error: msg,
      durationMs: Date.now() - started,
    });
  }
}
