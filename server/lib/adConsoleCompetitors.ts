/**
 * Ad Creative Console — competitor discovery + management (Phase 1).
 *
 * The "brand overlay" half of the feed (spec §5): each brand's own competitors,
 * whose Facebook ads + organic posts get pulled directly. Two sources:
 *   - `auto`   — LLM web_search discovery (`competitor_discover` prompt).
 *   - `manual` — operator-added in the Console.
 *
 * Both paths converge on `competitors`, deduped per brand by an app-computed
 * `dedupeKey` (fbPageId ?? lowercased igHandle ?? lowercased name) so the same
 * rival can't be added twice whether auto-discovered or hand-entered.
 */
import { and, asc, eq } from "drizzle-orm";
import { generateText } from "./anthropic.js";
import { db, schema } from "./db.js";
import { extractJsonObject } from "./jsonExtract.js";
import { loadPrompt } from "./prompts.js";
import type { Competitor } from "../db/schema.js";

const DISCOVER_ACTION = "competitor_discover";

const RESEARCH_EXCERPT_CHARS = 1000;
const MAX_PRODUCTS_IN_CONTEXT = 6;

/** Strip a leading "@", lowercase, and trim a social handle. "" → null. */
export function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const h = raw.trim().replace(/^@+/, "").toLowerCase();
  return h.length > 0 ? h : null;
}

function cleanString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s.length > 0 ? s : null;
}

/**
 * App identity for dedup. Prefer the most stable signal available:
 * fbPageId → igHandle → normalized name. Never empty.
 */
export function computeDedupeKey(input: {
  fbPageId?: string | null;
  igHandle?: string | null;
  name: string;
}): string {
  const fbPageId = cleanString(input.fbPageId);
  if (fbPageId) return `fb:${fbPageId.toLowerCase()}`;
  const ig = normalizeHandle(input.igHandle);
  if (ig) return `ig:${ig}`;
  return `name:${input.name.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

export async function listCompetitors(brandId: string): Promise<Competitor[]> {
  return db
    .select()
    .from(schema.competitors)
    .where(eq(schema.competitors.brandId, brandId))
    .orderBy(asc(schema.competitors.createdAt));
}

export type ManualCompetitorInput = {
  name: string;
  fbPageUrl?: string | null;
  fbPageId?: string | null;
  igHandle?: string | null;
  tiktokHandle?: string | null;
};

/**
 * Insert a manually-added competitor. Returns { competitor, created }: when the
 * dedupeKey already exists for the brand, the existing row is returned with
 * created=false (idempotent, no duplicate).
 */
export async function addManualCompetitor(
  brandId: string,
  input: ManualCompetitorInput,
  userId: string | null,
): Promise<{ competitor: Competitor; created: boolean }> {
  const name = input.name.trim();
  if (!name) throw new Error("Competitor name is required");

  const igHandle = normalizeHandle(input.igHandle);
  const tiktokHandle = normalizeHandle(input.tiktokHandle);
  const fbPageUrl = cleanString(input.fbPageUrl);
  const fbPageId = cleanString(input.fbPageId);
  const dedupeKey = computeDedupeKey({ fbPageId, igHandle, name });

  const [existing] = await db
    .select()
    .from(schema.competitors)
    .where(and(eq(schema.competitors.brandId, brandId), eq(schema.competitors.dedupeKey, dedupeKey)))
    .limit(1);
  if (existing) return { competitor: existing, created: false };

  const [row] = await db
    .insert(schema.competitors)
    .values({
      brandId,
      name,
      fbPageUrl,
      fbPageId,
      igHandle,
      tiktokHandle,
      source: "manual",
      status: "active",
      dedupeKey,
      createdBy: userId,
    })
    .returning();
  return { competitor: row, created: true };
}

export type CompetitorPatch = {
  name?: string;
  fbPageUrl?: string | null;
  fbPageId?: string | null;
  igHandle?: string | null;
  tiktokHandle?: string | null;
  status?: string; // "active" | "archived"
};

export async function updateCompetitor(id: string, patch: CompetitorPatch): Promise<Competitor | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof patch.name === "string" && patch.name.trim()) set.name = patch.name.trim();
  if ("fbPageUrl" in patch) set.fbPageUrl = cleanString(patch.fbPageUrl);
  if ("fbPageId" in patch) set.fbPageId = cleanString(patch.fbPageId);
  if ("igHandle" in patch) set.igHandle = normalizeHandle(patch.igHandle);
  if ("tiktokHandle" in patch) set.tiktokHandle = normalizeHandle(patch.tiktokHandle);
  if (patch.status === "active" || patch.status === "archived") set.status = patch.status;

  const [row] = await db
    .update(schema.competitors)
    .set(set)
    .where(eq(schema.competitors.id, id))
    .returning();
  return row ?? null;
}

export async function deleteCompetitor(id: string): Promise<boolean> {
  const deleted = await db.delete(schema.competitors).where(eq(schema.competitors.id, id)).returning();
  return deleted.length > 0;
}

/** Build the discovery prompt context from the brand + its products. */
function buildDiscoveryContext(
  brand: { name: string; brandUrl: string | null; nicheType: string | null; guidelinesMarkdown: string | null },
  products: { name: string; category: string | null; productUrl: string | null; research: unknown }[],
): string {
  const lines: string[] = [`BRAND NAME: ${brand.name}`];
  if (brand.brandUrl) lines.push(`BRAND WEBSITE: ${brand.brandUrl}`);
  if (brand.nicheType) lines.push(`NICHE: ${brand.nicheType}`);
  lines.push("", "PRODUCTS:");
  for (const p of products.slice(0, MAX_PRODUCTS_IN_CONTEXT)) {
    lines.push(`- ${p.name}${p.category ? ` (${p.category})` : ""}${p.productUrl ? ` — ${p.productUrl}` : ""}`);
    const research = (p.research ?? {}) as { markdown?: unknown };
    const md = typeof research.markdown === "string" ? research.markdown.trim() : "";
    if (md) lines.push(`  What it is: ${md.slice(0, RESEARCH_EXCERPT_CHARS)}${md.length > RESEARCH_EXCERPT_CHARS ? "…" : ""}`);
  }
  return lines.join("\n");
}

export type DiscoveredCompetitor = {
  name: string;
  igHandle: string | null;
  fbPageUrl: string | null;
  website: string | null;
  reason: string | null;
};

/**
 * Run LLM web_search competitor discovery for a brand and persist new finds.
 * Existing competitors (matched by dedupeKey) are left untouched — discovery
 * only ADDS, never overwrites a manual entry. Returns the inserted rows plus
 * the full current competitor list.
 */
export async function discoverCompetitors(
  brandId: string,
): Promise<{ inserted: Competitor[]; all: Competitor[]; discovered: number }> {
  const [brand] = await db
    .select({
      name: schema.brands.name,
      brandUrl: schema.brands.brandUrl,
      nicheType: schema.brands.nicheType,
      guidelinesMarkdown: schema.brands.guidelinesMarkdown,
    })
    .from(schema.brands)
    .where(eq(schema.brands.id, brandId))
    .limit(1);
  if (!brand) throw new Error("Brand not found");

  const products = await db
    .select({
      name: schema.products.name,
      category: schema.products.category,
      productUrl: schema.products.productUrl,
      research: schema.products.research,
    })
    .from(schema.products)
    .where(eq(schema.products.brandId, brandId));
  if (products.length === 0) {
    throw new Error("Brand has no products — add a product before discovering competitors.");
  }

  const context = buildDiscoveryContext(brand, products);
  const prompt = loadPrompt(DISCOVER_ACTION, { context });
  const result = await generateText({
    systemPrompt: prompt.rendered,
    userMessage: "Find this brand's direct competitors. Output only the JSON object specified.",
    model: prompt.config.model,
    maxTokens: prompt.config.maxTokens ?? 4000,
    tools: prompt.config.tools,
    thinking: prompt.config.thinking,
    webSearchMaxUses: prompt.config.webSearchMaxUses,
  });

  let parsed: { competitors?: unknown } = {};
  try {
    parsed = extractJsonObject(result.text, { stopReason: result.stopReason, action: "Competitor discovery" });
  } catch (err) {
    console.error(
      `[ad-console] competitor discovery parse failed for brand ${brandId}.\n` +
      `stop_reason=${result.stopReason} tokensOut=${result.tokensOut}\nRAW:\n${result.text}`,
    );
    throw err;
  }

  const rawList = Array.isArray(parsed.competitors) ? (parsed.competitors as Record<string, unknown>[]) : [];
  const discovered: DiscoveredCompetitor[] = rawList
    .map((c) => ({
      name: cleanString(c.name) ?? "",
      igHandle: normalizeHandle(c.igHandle),
      fbPageUrl: cleanString(c.fbPageUrl),
      website: cleanString(c.website),
      reason: cleanString(c.reason),
    }))
    .filter((c) => c.name.length > 0);

  const inserted: Competitor[] = [];
  for (const c of discovered) {
    const dedupeKey = computeDedupeKey({ igHandle: c.igHandle, name: c.name });
    const [row] = await db
      .insert(schema.competitors)
      .values({
        brandId,
        name: c.name,
        fbPageUrl: c.fbPageUrl,
        igHandle: c.igHandle,
        source: "auto",
        status: "active",
        discoveryReason: c.reason,
        dedupeKey,
      })
      .onConflictDoNothing({ target: [schema.competitors.brandId, schema.competitors.dedupeKey] })
      .returning();
    if (row) inserted.push(row);
  }

  await db.insert(schema.generations).values({
    action: DISCOVER_ACTION,
    kind: "text",
    inputs: { brandId, brandName: brand.name },
    output: { discovered: discovered.length, inserted: inserted.length },
    model: result.model,
    promptVersion: prompt.version,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: String(result.costUsd),
    durationMs: result.durationMs,
  });

  const all = await listCompetitors(brandId);
  console.log(`[ad-console] competitor discovery for ${brandId}: ${discovered.length} found, ${inserted.length} new (${result.durationMs}ms)`);
  return { inserted, all, discovered: discovered.length };
}
