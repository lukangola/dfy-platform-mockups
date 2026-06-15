/**
 * Ad Creative Console — LLM-generated "This Week's Ideas" rail (Phase 5b, spec
 * §5 `weekly_ideas`).
 *
 * The competitor + organic rails queue REAL scraped creatives. This rail is
 * different: it asks the model to invent FRESH ad concepts for the brand,
 * grounded in (a) the brand's niche + extracted keyword signal and (b) the
 * top-ranked competitor ads / trending organic posts it just pulled — i.e. the
 * proven mechanics in this market right now. One generation run shares a
 * `batchId`; the Console shows the newest batch and lets the operator
 * select / skip each idea like any other feed card.
 *
 * Synchronous (one LLM call, like competitor discovery) — the route awaits it.
 * Spends NO Apify credits; it only reads what's already been pulled + ranked.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { generateText } from "./anthropic.js";
import { db, schema } from "./db.js";
import { extractJsonObject } from "./jsonExtract.js";
import { loadPrompt } from "./prompts.js";
import { listBrandFeed, type FeedCard } from "./adConsoleFeed.js";
import { listBrandKeywordSets } from "./adConsoleKeywords.js";
import type { AdConsoleIdea } from "../db/schema.js";

const IDEAS_ACTION = "weekly_ideas";
const DEFAULT_IDEA_COUNT = 8;
const MAX_IDEA_COUNT = 16;
// How many proven cards per rail to hand the model as grounding. Keeps the
// context tight (the patterns matter, not an exhaustive dump).
const GROUNDING_ADS = 8;
const GROUNDING_ORGANIC = 8;
const GUIDELINES_EXCERPT_CHARS = 2000;
const COPY_EXCERPT_CHARS = 280;
const KEYWORDS_PER_SECTION = 25;

export type WeeklyIdeasSummary = {
  brandId: string;
  batchId: string;
  generated: number;
  grounding: { ads: number; organic: number };
};

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function cleanString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s.length > 0 ? s : null;
}

/** Normalize the model's free-form format string to our three buckets. */
function normalizeFormat(raw: unknown): string | null {
  const s = cleanString(raw)?.toLowerCase();
  if (!s) return null;
  if (s.includes("ugc")) return "ugc";
  if (s.includes("video") || s.includes("reel") || s.includes("tiktok")) return "video";
  if (s.includes("static") || s.includes("image")) return "static";
  return s;
}

/** All ideas for a brand, newest first. Optionally filter by status / batch. */
export async function listBrandIdeas(
  brandId: string,
  opts?: { status?: string; batchId?: string },
): Promise<AdConsoleIdea[]> {
  const conds = [eq(schema.adConsoleIdeas.brandId, brandId)];
  if (opts?.status) conds.push(eq(schema.adConsoleIdeas.status, opts.status));
  if (opts?.batchId) conds.push(eq(schema.adConsoleIdeas.batchId, opts.batchId));
  return db
    .select()
    .from(schema.adConsoleIdeas)
    .where(and(...conds))
    .orderBy(desc(schema.adConsoleIdeas.createdAt));
}

/**
 * The brand's most recent idea batch (what the Console rail shows). Returns []
 * when no ideas have been generated yet. Defaults to the not-yet-actioned
 * ("new") ideas; pass `includeActioned` for the whole batch.
 */
export async function getLatestIdeaBatch(
  brandId: string,
  opts?: { includeActioned?: boolean },
): Promise<AdConsoleIdea[]> {
  const [newest] = await db
    .select({ batchId: schema.adConsoleIdeas.batchId })
    .from(schema.adConsoleIdeas)
    .where(eq(schema.adConsoleIdeas.brandId, brandId))
    .orderBy(desc(schema.adConsoleIdeas.createdAt))
    .limit(1);
  if (!newest) return [];
  const rows = await listBrandIdeas(brandId, { batchId: newest.batchId });
  return opts?.includeActioned ? rows : rows.filter((r) => r.status === "new");
}

/** Flip one idea's swipe status (select / skip). Null if not found for brand. */
export async function setIdeaStatus(
  brandId: string,
  ideaId: string,
  status: "new" | "selected" | "skipped",
): Promise<AdConsoleIdea | null> {
  const [row] = await db
    .update(schema.adConsoleIdeas)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(schema.adConsoleIdeas.id, ideaId), eq(schema.adConsoleIdeas.brandId, brandId)))
    .returning();
  return row ?? null;
}

// ── Context builders ─────────────────────────────────────────────────────────

async function buildBrandContext(
  brandId: string,
): Promise<{ name: string; niche: string | null; text: string }> {
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

  const lines: string[] = [`BRAND: ${brand.name}`];
  if (brand.nicheType) lines.push(`NICHE: ${brand.nicheType}`);
  if (brand.brandUrl) lines.push(`WEBSITE: ${brand.brandUrl}`);
  const md = (brand.guidelinesMarkdown ?? "").trim();
  if (md) {
    lines.push(
      "",
      "BRAND GUIDELINES (excerpt):",
      md.slice(0, GUIDELINES_EXCERPT_CHARS) + (md.length > GUIDELINES_EXCERPT_CHARS ? "…" : ""),
    );
  }
  return { name: brand.name, niche: brand.nicheType, text: lines.join("\n") };
}

async function buildKeywordContext(brandId: string): Promise<string> {
  const sets = (await listBrandKeywordSets(brandId)).filter((s) => s.status === "complete");
  if (sets.length === 0) return "(no keyword sets extracted yet — lean on the brand context + grounding)";

  const problem = new Set<string>();
  const outcome = new Set<string>();
  const product = new Set<string>();
  for (const s of sets) {
    asStringArray(s.problemKeywords).forEach((k) => problem.add(k));
    asStringArray(s.outcomeKeywords).forEach((k) => outcome.add(k));
    asStringArray(s.productKeywords).forEach((k) => product.add(k));
  }
  const fmt = (label: string, set: Set<string>): string =>
    `${label}: ${Array.from(set).slice(0, KEYWORDS_PER_SECTION).join(", ") || "—"}`;
  return [
    fmt("PROBLEM", problem),
    fmt("DESIRED OUTCOME", outcome),
    fmt("PRODUCT / SOLUTION", product),
  ].join("\n");
}

function describeAdCard(card: FeedCard): string | null {
  const ad = card.ad;
  if (!ad) return null;
  const bits: string[] = [`AD — ${ad.advertiserName ?? "unknown advertiser"}`];
  if (typeof ad.runtimeDays === "number") bits.push(`ran ${ad.runtimeDays}d${ad.isActive ? ", active" : ""}`);
  if (typeof ad.variationCount === "number" && ad.variationCount > 1) bits.push(`${ad.variationCount} variations`);
  if (ad.format) bits.push(ad.format);
  const copy = (ad.hook ?? ad.copy ?? "").trim().slice(0, COPY_EXCERPT_CHARS);
  return `- ${bits.join(" · ")}${copy ? `\n  copy: ${copy}` : ""}`;
}

function describeOrganicCard(card: FeedCard): string | null {
  const post = card.organic;
  if (!post) return null;
  const who = post.profileName ?? (post.handle ? `@${post.handle}` : "unknown creator");
  const bits: string[] = [`ORGANIC — ${who} (${post.source})`];
  if (typeof post.views === "number" && post.views > 0) bits.push(`${post.views.toLocaleString("en-US")} views`);
  if (typeof post.likes === "number" && post.likes > 0) bits.push(`${post.likes.toLocaleString("en-US")} likes`);
  const txt = (post.hook ?? post.transcript ?? post.caption ?? "").trim().slice(0, COPY_EXCERPT_CHARS);
  return `- ${bits.join(" · ")}${txt ? `\n  copy: ${txt}` : ""}`;
}

async function buildGroundingContext(
  brandId: string,
): Promise<{ text: string; ads: number; organic: number }> {
  const [adCards, organicCards] = await Promise.all([
    listBrandFeed(brandId, { rail: "competitor_ads", limit: GROUNDING_ADS }),
    listBrandFeed(brandId, { rail: "trending_organic", limit: GROUNDING_ORGANIC }),
  ]);
  const adLines = adCards.map(describeAdCard).filter((l): l is string => l !== null);
  const orgLines = organicCards.map(describeOrganicCard).filter((l): l is string => l !== null);

  if (adLines.length === 0 && orgLines.length === 0) {
    return {
      text:
        "(no proven competitor ads or trending organic pulled yet — invent ideas from the brand + keyword signal alone)",
      ads: 0,
      organic: 0,
    };
  }
  const blocks: string[] = [];
  if (adLines.length) blocks.push(`WINNING COMPETITOR ADS (by longevity):\n${adLines.join("\n")}`);
  if (orgLines.length) blocks.push(`TRENDING ORGANIC POSTS (by traction):\n${orgLines.join("\n")}`);
  return { text: blocks.join("\n\n"), ads: adLines.length, organic: orgLines.length };
}

// ── Generate ─────────────────────────────────────────────────────────────────

type ParsedIdea = {
  title: string | null;
  hook: string | null;
  concept: string | null;
  format: string | null;
  angle: string | null;
  rationale: string | null;
  sourceRefs: Array<{ type: string | null; ref: string | null; note: string | null }>;
};

function parseIdea(raw: Record<string, unknown>): ParsedIdea | null {
  const hook = cleanString(raw.hook);
  const concept = cleanString(raw.concept);
  // An idea with neither a hook nor a concept is noise — drop it.
  if (!hook && !concept) return null;
  const refsRaw = Array.isArray(raw.sourceRefs) ? (raw.sourceRefs as Record<string, unknown>[]) : [];
  const sourceRefs = refsRaw
    .map((r) => ({
      type: cleanString(r.type),
      ref: cleanString(r.ref),
      note: cleanString(r.note),
    }))
    .filter((r) => r.ref || r.note);
  return {
    title: cleanString(raw.title),
    hook,
    concept,
    format: normalizeFormat(raw.format),
    angle: cleanString(raw.angle),
    rationale: cleanString(raw.rationale),
    sourceRefs,
  };
}

/**
 * Generate one fresh batch of weekly ideas for a brand and persist it. Returns
 * the summary + the inserted rows. Throws PromptNotConfiguredError (→ 424 at the
 * route) when the prompt isn't configured, or a parse error when the model
 * returns nothing usable.
 */
export async function generateWeeklyIdeas(
  brandId: string,
  opts?: { count?: number },
): Promise<{ summary: WeeklyIdeasSummary; ideas: AdConsoleIdea[] }> {
  const count = Math.min(Math.max(opts?.count ?? DEFAULT_IDEA_COUNT, 1), MAX_IDEA_COUNT);

  const [{ text: brandContext }, keywordContext, grounding] = await Promise.all([
    buildBrandContext(brandId),
    buildKeywordContext(brandId),
    buildGroundingContext(brandId),
  ]);

  const prompt = loadPrompt(IDEAS_ACTION, {
    brandContext,
    keywordContext,
    groundingContext: grounding.text,
    ideaCount: String(count),
  });
  const result = await generateText({
    systemPrompt: prompt.rendered,
    userMessage: `Generate exactly ${count} fresh ad-concept ideas for this brand now. Output only the JSON object specified.`,
    model: prompt.config.model,
    maxTokens: prompt.config.maxTokens ?? 6000,
    thinking: prompt.config.thinking,
  });

  let parsed: { ideas?: unknown } = {};
  try {
    parsed = extractJsonObject(result.text, { stopReason: result.stopReason, action: "Weekly ideas" });
  } catch (err) {
    console.error(
      `[ad-console] weekly ideas parse failed for brand ${brandId}.\n` +
        `stop_reason=${result.stopReason} tokensOut=${result.tokensOut}\nRAW:\n${result.text}`,
    );
    throw err;
  }

  const rawList = Array.isArray(parsed.ideas) ? (parsed.ideas as Record<string, unknown>[]) : [];
  const ideas = rawList.map(parseIdea).filter((i): i is ParsedIdea => i !== null);
  if (ideas.length === 0) {
    throw new Error("Weekly ideas generation returned no usable ideas");
  }

  const batchId = randomUUID();
  const inserted = await db
    .insert(schema.adConsoleIdeas)
    .values(
      ideas.map((i) => ({
        brandId,
        batchId,
        title: i.title,
        hook: i.hook,
        concept: i.concept,
        format: i.format,
        angle: i.angle,
        rationale: i.rationale,
        sourceRefs: i.sourceRefs,
        status: "new",
        model: result.model,
        promptVersion: prompt.version,
      })),
    )
    .returning();

  await db.insert(schema.generations).values({
    action: IDEAS_ACTION,
    kind: "text",
    inputs: { brandId, count, grounding: { ads: grounding.ads, organic: grounding.organic } },
    output: { generated: inserted.length, batchId },
    model: result.model,
    promptVersion: prompt.version,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: String(result.costUsd),
    durationMs: result.durationMs,
  });

  console.log(
    `[ad-console] weekly ideas for ${brandId}: ${inserted.length} ideas ` +
      `(grounding ${grounding.ads} ads / ${grounding.organic} organic, ${result.durationMs}ms)`,
  );

  return {
    summary: {
      brandId,
      batchId,
      generated: inserted.length,
      grounding: { ads: grounding.ads, organic: grounding.organic },
    },
    ideas: inserted,
  };
}
