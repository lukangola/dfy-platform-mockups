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
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { canSeeBrand, visibleBrandIds } from "../lib/brandAccess.js";
import { ensureLogoIsPng } from "../lib/logoConvert.js";
import { db, schema } from "../lib/db.js";
import { parseBrandGuidelines } from "../lib/brandGuidelinesParse.js";
import { loadPrompt, PromptNotConfiguredError } from "../lib/prompts.js";
import { fetchUrlMeta } from "../lib/urlMeta.js";
import { runResearch as runProductResearch } from "./products.js";

export const brandsRouter: Router = Router();

// The Brand Guidelines Generator skill (adapted into prompts/brand_guidelines.md)
// is the single source of truth for brand identity. Output is the 8-section
// markdown style guide stored verbatim on brand.guidelinesMarkdown — rendered
// in the BrandInfoPage UI and injected into every downstream creative tool's
// prompt. The old `brand_extract` action that produced a JSON dossier is
// retired; nothing new reads brand.research.
const BRAND_RESEARCH_ACTION = "brand_guidelines";

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
      guidelinesMarkdown?: string;
      research?: unknown;
      brandFonts?: unknown;
    };
    const updates: Record<string, unknown> = {};
    if (body.brandFonts !== undefined) {
      // Real uploaded font files (family + regular/italic fal URLs + fallback).
      // Sanitised so a malformed onboarding payload can't poison the column.
      const { sanitizeBrandFonts } = await import("../lib/brandFonts.js");
      updates.brandFonts = sanitizeBrandFonts(body.brandFonts);
    }
    if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
    if (body.brandUrl !== undefined) updates.brandUrl = body.brandUrl ?? null;
    if (body.logoUrl !== undefined) {
      // Normalise the logo before saving: if the URL points at an SVG,
      // download + rasterise to PNG and store the PNG URL instead.
      // Downstream consumers (b-roll, message-testing, etc.) reject SVG
      // refs, so we never want an SVG URL on a brand row.
      updates.logoUrl = body.logoUrl ? await ensureLogoIsPng(body.logoUrl) : null;
    }
    if (typeof body.guidelinesMarkdown === "string") {
      // Editor saved the markdown directly. Update the source of truth,
      // and re-derive the mirrored brand.name + brand.logoUrl from the
      // new content so the brand chip stays consistent.
      const md = body.guidelinesMarkdown;
      updates.guidelinesMarkdown = md;
      const reparsed = parseBrandGuidelines(md);
      if (reparsed.name && !body.name) updates.name = reparsed.name;
      if (reparsed.logoUrl && body.logoUrl === undefined) {
        updates.logoUrl = await ensureLogoIsPng(reparsed.logoUrl);
      }
    }
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
 * PATCH /api/brands/:id/dfy — flip the Done-For-You client flag.
 *
 * Admin-only: marking a brand a DFY client unlocks the Client Console
 * (client share links + feedback triage) for everyone who can see the brand,
 * so it's a managed action, not something a member/manager should self-serve.
 * Body: `{ isDfyClient: boolean }`.
 */
brandsRouter.patch("/:id/dfy", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { team } = req.auth!;
    const body = (req.body ?? {}) as { isDfyClient?: unknown };
    if (typeof body.isDfyClient !== "boolean") {
      return sendError(res, 400, "isDfyClient must be a boolean");
    }
    // Scope strictly to the admin's team — an admin can't flip a brand that
    // isn't on their team even if they guess the id.
    const [row] = await db
      .update(schema.brands)
      .set({ isDfyClient: body.isDfyClient })
      .where(and(eq(schema.brands.id, req.params.id), eq(schema.brands.teamId, team.id)))
      .returning();
    if (!row) return sendError(res, 404, "Brand not found");
    res.json({ brand: row });
  } catch (err) {
    console.error("[brands] dfy toggle failed:", err);
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
 *     productBackImageUrl?: string,  // optional — clean back shot
 *   }
 *
 * Creates the brand, creates its first product, returns both.
 * Brand research (brand_extract) and product research run async in parallel.
 *
 * Admin-only. Non-admin members must never be able to create workspaces —
 * a workspace they spawn would have no `brand_members` row for the admin
 * (admins implicitly see every brand on their team, so the row check is
 * skipped anyway, but the intent is to keep workspace creation a managed
 * action). Defense in depth: the BrandSwitcher hides the "Add new brand"
 * button when `role !== "admin"`, but the API must enforce this too so
 * a member can't bypass the UI by hitting the endpoint directly.
 */
brandsRouter.post("/", requireAdmin, async (req: Request, res: Response) => {
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
  // Back image is optional — many products are shot as single-hero only.
  // When absent we store NULL on the product row and skip the back-image
  // seed in initialCandidates below; the front shot alone is enough for
  // every downstream generator's product-fidelity check.

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

    // No brand_members grant needed for the creator — the route is
    // requireAdmin-gated, so the creator is always an admin and admins
    // implicitly see every brand on their team via canSeeBrand's role
    // short-circuit. Members get access only when the admin explicitly
    // assigns them via PUT /api/team/members/:userId/brands.

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

    // Seed imageCandidates with the user uploads (highest score so they
    // sort first in the candidate gallery). Back image is only added
    // when present — undefined back ⇒ no second seed row.
    const initialCandidates = [
      { url: productImageUrl, width: null, height: null, source: "user-upload", score: 6000 },
      ...(productBackImageUrl
        ? [{ url: productBackImageUrl, width: null, height: null, source: "user-upload-back", score: 5900 }]
        : []),
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
        // Empty string ⇒ NULL so the column accurately reflects "no back
        // shot uploaded" instead of pretending an empty string is a URL.
        productBackImageUrl: productBackImageUrl || null,
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
 *
 * Admin-only — destructive workspace operation. The same intent that
 * gates POST /api/brands behind requireAdmin gates this: workspace
 * lifecycle is a managed action, not something a member should be
 * able to trigger by hitting the endpoint directly (or by mistake).
 */
brandsRouter.delete("/:id", requireAdmin, async (req: Request, res: Response) => {
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
 * Recover the markdown document from a model response that may be lightly
 * "dressed up" despite the prompt's strict output rules.
 *
 * Two real failure modes we've seen with server-side web tools + adaptive
 * thinking, both of which leave a perfectly good document behind a few
 * stray characters at the very start:
 *
 *   1. The whole document wrapped in a ```markdown … ``` code fence. The
 *      prompt forbids it, but Opus still does it sometimes (confirmed on
 *      shopetalon.com). The text then starts with "```markdown" not "#".
 *   2. Interim tool-use narration ("Let me check the product page…") emitted
 *      as a separate text block before the final document. generateText
 *      concatenates every text block, so the combined output can start with
 *      that preamble.
 *
 * Strip a wrapping fence, then — if it still doesn't start at an H1 — slice
 * from the first markdown H1 (preferring the canonical "… Brand Guidelines"
 * title line). Returns the cleaned markdown, which the caller still validates
 * starts with `#` so a genuine refusal / empty response still fails loudly.
 */
export function normalizeGuidelinesMarkdown(raw: string): string {
  let md = raw.replace(/^\s+|\s+$/g, "");

  // 1. Strip a wrapping code fence around the entire document.
  if (md.startsWith("```")) {
    md = md
      .replace(/^```[^\n]*\n/, "") // opening fence line (```markdown, ```md, ```)
      .replace(/\n```\s*$/, "")    // closing fence
      .trim();
  }

  // 2. Prefer the canonical "<Brand> Brand Guidelines" H1 title wherever it
  //    sits. This both strips leading narration AND beats a stray preamble
  //    heading (e.g. "# Research notes") that would otherwise win. The
  //    template title always ends in "Brand Guidelines".
  const titled = md.match(/^#[ \t]+.*Brand Guidelines\b.*$/im);
  if (titled && titled.index !== undefined) return md.slice(titled.index).trim();

  // 3. Already at some H1 — accept it (covers a model that deviated from the
  //    exact title wording but still emitted a structured document).
  if (md.startsWith("#")) return md;

  // 4. Last resort — slice from the first H1 anywhere in the text.
  const anyH1 = md.match(/^#[ \t]+\S.*$/m);
  if (anyH1 && anyH1.index !== undefined) return md.slice(anyH1.index).trim();

  return md;
}

/**
 * Runs the brand_guidelines prompt (adapted from the Brand Guidelines
 * Generator skill) against the brand URL. The prompt's output is the raw
 * 8-section markdown style guide — that's the single source of truth.
 *
 * After generation we run the deterministic markdown parser to mirror
 * `name` (from the H1) and `logoUrl` (from the Logo Usage section's image
 * link) into the dedicated brand columns. Those mirrored columns let the
 * BrandSwitcher render the brand chip + logo without having to parse
 * markdown on every request. They are derived, not authored — re-running
 * research overwrites them from the new markdown.
 */
export async function runBrandResearch(brandId: string, brandUrl: string): Promise<void> {
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

    // The skill is configured `expectsJson: false`. The raw response IS
    // the markdown document. We defensively normalise it first —
    // stripping an accidental wrapping ```markdown fence and any interim
    // tool-use narration — then verify it starts at an H1. A genuine
    // refusal / empty response has no H1 and still fails loudly here.
    const markdown = normalizeGuidelinesMarkdown(result.text);
    if (!markdown.startsWith("#")) {
      console.error(
        `[brands] ${BRAND_RESEARCH_ACTION} output didn't start with an H1 for ${brandUrl}.\n` +
        `stop_reason=${result.stopReason} tokensOut=${result.tokensOut}\n` +
        `RAW OUTPUT:\n${result.text}`,
      );
      throw new Error("Brand guidelines output did not start with a markdown heading — prompt likely produced commentary instead of the document.");
    }

    // Deterministic one-way read of the markdown for the two derived
    // fields the brand chip + downstream tools need without parsing the
    // full document. parseBrandGuidelines is not a separate extraction
    // method — it's a regex view of the section structure the prompt
    // emits.
    const parsed = parseBrandGuidelines(markdown);
    const rawLogoUrl = parsed.logoUrl;
    const extractedName = parsed.name;

    // Convert SVG logos to PNG before persisting. fal.ai's image
    // generation models reject SVGs as reference images, which makes the
    // entire B-Roll pipeline fail for brands that happen to have an SVG
    // logo. Normalising at ingestion time means downstream consumers
    // never have to think about format compatibility.
    const logoUrl = await ensureLogoIsPng(rawLogoUrl);

    const setPatch: Record<string, unknown> = {
      // The single source of truth — the markdown style guide verbatim.
      guidelinesMarkdown: markdown,
      // Mirrored fields used by the brand chip / downstream code that
      // shouldn't parse the markdown on every read.
      logoUrl,
      // Clear the legacy JSON dossier — anything new reads
      // guidelinesMarkdown instead. (We keep the column for older brands
      // until the boot-time backfill regenerates them, but a freshly
      // generated brand has no need to keep both.)
      research: null,
      researchStatus: "complete",
      researchError: null,
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
      output: { markdown },
      model: result.model,
      promptVersion: prompt.version,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: String(result.costUsd),
      durationMs: result.durationMs,
    });

    console.log(
      `[brands] guidelines generated for ${brandId} in ${Date.now() - started}ms — ` +
      `$${result.costUsd.toFixed(4)}, ${result.tokensIn} in / ${result.tokensOut} out, ` +
      `markdown=${markdown.length} chars, colors=${parsed.colors.length}, fonts=${parsed.fonts.length}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[brands] research failed for ${brandId}:`, err);
    await db
      .update(schema.brands)
      .set({
        researchStatus: "failed",
        researchError: err instanceof PromptNotConfiguredError
          ? "Brand guidelines prompt not configured. Create prompts/brand_guidelines.md."
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
