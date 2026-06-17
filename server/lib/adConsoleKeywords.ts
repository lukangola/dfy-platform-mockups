/**
 * Ad Creative Console — per-angle keyword extraction (Phase 2).
 *
 * Turns one of a product's strategic angles into three 20-keyword research sets
 * (Problem / Desired-outcome / Product-solution) via the `keyword_extract`
 * action. Those keyword sets are the Console's relevance backbone (spec §6.1):
 *   - Section 3 (product/solution) → ad-library search queries.
 *   - Sections 1+2 (problem + outcome) → organic search queries + the relevance
 *     match later used to rank the shared pools against THIS brand's angles.
 *
 * One row per (brand, angle) in `brand_keyword_sets`, regenerated in place. The
 * LLM emits three plain numbered lists (not JSON) so we keep the operator's
 * tuned master-prompt output verbatim; `parseKeywordSections` is the tolerant
 * reader that turns that text back into three string[].
 *
 * Generated async (status lifecycle pending → running → complete | failed),
 * mirroring the other LLM-action tables so the Console can poll.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { generateText } from "./anthropic.js";
import { db, schema } from "./db.js";
import { loadPrompt } from "./prompts.js";
import type { StoredAngle } from "./angle-artifacts.js";
import type { BrandKeywordSet } from "../db/schema.js";

const KEYWORD_ACTION = "keyword_extract";

// How much research markdown to hand the extractor as context. Keywords come
// from the ANGLE's psychology; the research is supporting colour, so a generous
// excerpt is plenty without paying for a 20KB diagnosis.
const RESEARCH_EXCERPT_CHARS = 4000;
// Each section is specified as exactly 20 keywords; clamp defensively in case
// the model over-produces.
const MAX_KEYWORDS_PER_SECTION = 20;

/** One angle reduced to just what the extractor needs. */
export type KeywordAngle = { id: string; name: string; block: string };

/** Strip leading bullet/number residue + trailing punctuation; lowercase. */
function cleanKeyword(raw: string): string {
  return raw
    .replace(/^[\s\-*•]+/, "")
    .replace(/[.,;:!?]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** A numbered list line like "1. gut health" or "12) low energy". */
const NUMBERED_RE = /^\s*(\d{1,2})[.)]\s+(.*\S)\s*$/;

/**
 * Map a non-list line to a section index by its keyword, else by an explicit
 * "Section N", else null. Keyword pinning is preferred over order so a reordered
 * or relabeled header still lands in the right bucket.
 */
function sectionIndexFromHeader(line: string): number | null {
  if (NUMBERED_RE.test(line)) return null; // a list item, not a header
  const l = line.toLowerCase();
  if (/\bproblem\b/.test(l)) return 0;
  if (/\b(outcome|desire|desired)\b/.test(l)) return 1;
  if (/\b(product|solution)\b/.test(l)) return 2;
  const m = l.match(/\bsection\s*([123])\b/);
  if (m) return Number(m[1]) - 1;
  return null;
}

function dedupeInOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (!it || seen.has(it)) continue;
    seen.add(it);
    out.push(it);
  }
  return out;
}

/**
 * Parse the extractor's three numbered lists into three keyword arrays.
 *
 * Primary strategy: header-driven — walk lines, switch the active section on a
 * recognised header, push numbered items into it. Fallback (when headers are
 * missing/garbled): reset-driven — treat every "1." after we've already
 * collected items as the start of the next section.
 */
export function parseKeywordSections(text: string): {
  problemKeywords: string[];
  outcomeKeywords: string[];
  productKeywords: string[];
} {
  // ── header-driven pass ──
  const byHeader: string[][] = [[], [], []];
  let current = -1;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const sIdx = sectionIndexFromHeader(line);
    if (sIdx !== null) {
      current = sIdx;
      continue;
    }
    const m = line.match(NUMBERED_RE);
    if (m && current >= 0) {
      const kw = cleanKeyword(m[2]);
      if (kw) byHeader[current].push(kw);
    }
  }

  let sections = byHeader;
  const headerOk = byHeader.every((s) => s.length > 0);

  // ── reset-driven fallback ──
  if (!headerOk) {
    const byReset: string[][] = [[], [], []];
    let b = 0;
    let lastNum = 0;
    for (const raw of text.split("\n")) {
      const m = raw.match(NUMBERED_RE);
      if (!m) continue;
      const num = Number(m[1]);
      // A drop back to 1 (or any number ≤ the last) after collecting items
      // marks a new section.
      if (num <= lastNum && byReset[b].length > 0) b = Math.min(b + 1, 2);
      const kw = cleanKeyword(m[2]);
      if (kw) byReset[b].push(kw);
      lastNum = num;
    }
    // Prefer whichever interpretation filled more sections.
    const headerFilled = byHeader.filter((s) => s.length > 0).length;
    const resetFilled = byReset.filter((s) => s.length > 0).length;
    if (resetFilled > headerFilled) sections = byReset;
  }

  return {
    problemKeywords: dedupeInOrder(sections[0]).slice(0, MAX_KEYWORDS_PER_SECTION),
    outcomeKeywords: dedupeInOrder(sections[1]).slice(0, MAX_KEYWORDS_PER_SECTION),
    productKeywords: dedupeInOrder(sections[2]).slice(0, MAX_KEYWORDS_PER_SECTION),
  };
}

/** Build the product-research context block fed to the extractor. */
async function buildKeywordContext(productId: string | null): Promise<string> {
  if (!productId) return "(no product research available)";
  const [p] = await db
    .select({
      name: schema.products.name,
      category: schema.products.category,
      research: schema.products.research,
    })
    .from(schema.products)
    .where(eq(schema.products.id, productId))
    .limit(1);
  if (!p) return "(no product research available)";

  const research = (p.research ?? {}) as { markdown?: unknown };
  const md = typeof research.markdown === "string" ? research.markdown.trim() : "";
  const lines: string[] = [`PRODUCT: ${p.name}`];
  if (p.category) lines.push(`CATEGORY: ${p.category}`);
  if (md) {
    lines.push("", md.slice(0, RESEARCH_EXCERPT_CHARS) + (md.length > RESEARCH_EXCERPT_CHARS ? "…" : ""));
  }
  return lines.join("\n");
}

function formatAngle(angle: KeywordAngle): string {
  return `${angle.name}\n\n${angle.block}`.trim();
}

/** All keyword sets for a brand, oldest first — the Console's poll source. */
export async function listBrandKeywordSets(brandId: string): Promise<BrandKeywordSet[]> {
  return db
    .select()
    .from(schema.brandKeywordSets)
    .where(eq(schema.brandKeywordSets.brandId, brandId))
    .orderBy(asc(schema.brandKeywordSets.createdAt));
}

/**
 * Find one angle (by id) inside a product's research. Returns null if the
 * product or angle can't be found. The angle id is the stable randomUUID
 * backfilled by the products route, so callers pass an already-resolved id.
 */
export async function findProductAngle(productId: string, angleId: string): Promise<KeywordAngle | null> {
  const [p] = await db
    .select({ research: schema.products.research })
    .from(schema.products)
    .where(eq(schema.products.id, productId))
    .limit(1);
  if (!p) return null;
  const research = (p.research ?? {}) as { angles?: unknown };
  const angles = Array.isArray(research.angles) ? (research.angles as StoredAngle[]) : [];
  const a = angles.find((x) => x.id === angleId);
  if (!a) return null;
  return { id: a.id ?? angleId, name: a.name, block: a.block };
}

/**
 * Upsert the (brand, angle) row into `running` so the Console can poll a row
 * immediately. Idempotent on the (brandId, angleId) unique index — a
 * regeneration flips the existing row back to running and clears its error.
 */
export async function startKeywordExtract(
  brandId: string,
  productId: string | null,
  angle: KeywordAngle,
): Promise<BrandKeywordSet> {
  const [row] = await db
    .insert(schema.brandKeywordSets)
    .values({
      brandId,
      productId,
      angleId: angle.id,
      angleName: angle.name,
      status: "running",
    })
    .onConflictDoUpdate({
      target: [schema.brandKeywordSets.brandId, schema.brandKeywordSets.angleId],
      set: {
        status: "running",
        error: null,
        angleName: angle.name,
        productId,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

/**
 * Background worker: run the extractor for one angle and write the terminal
 * state (complete with keywords, or failed with an error) onto the existing
 * `brand_keyword_sets` row. Never throws — failures are recorded on the row.
 * Call `startKeywordExtract` first so a `running` row exists to land on.
 */
export async function runKeywordExtract(
  brandId: string,
  productId: string | null,
  angle: KeywordAngle,
): Promise<void> {
  const started = Date.now();
  const where = and(
    eq(schema.brandKeywordSets.brandId, brandId),
    eq(schema.brandKeywordSets.angleId, angle.id),
  );
  try {
    const productContext = await buildKeywordContext(productId);
    const prompt = loadPrompt(KEYWORD_ACTION, { productContext, angle: formatAngle(angle) });
    const result = await generateText({
      systemPrompt: prompt.rendered,
      userMessage:
        "Extract the three keyword sections for this angle now. Output only the three numbered lists.",
      model: prompt.config.model,
      maxTokens: prompt.config.maxTokens ?? 2500,
      thinking: prompt.config.thinking,
    });

    const { problemKeywords, outcomeKeywords, productKeywords } = parseKeywordSections(result.text);
    if (problemKeywords.length === 0 && outcomeKeywords.length === 0 && productKeywords.length === 0) {
      console.error(
        `[ad-console] keyword parse produced nothing for brand ${brandId} angle ${angle.id}.\n` +
          `stop_reason=${result.stopReason}\nRAW:\n${result.text}`,
      );
      throw new Error("Keyword extraction returned no parseable keywords");
    }

    await db
      .update(schema.brandKeywordSets)
      .set({
        problemKeywords,
        outcomeKeywords,
        productKeywords,
        status: "complete",
        error: null,
        model: result.model,
        promptVersion: prompt.version,
        updatedAt: new Date(),
      })
      .where(where);

    await db.insert(schema.generations).values({
      action: KEYWORD_ACTION,
      kind: "text",
      inputs: { brandId, productId, angleId: angle.id, angleName: angle.name },
      output: {
        problem: problemKeywords.length,
        outcome: outcomeKeywords.length,
        product: productKeywords.length,
      },
      model: result.model,
      promptVersion: prompt.version,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: String(result.costUsd),
      durationMs: result.durationMs,
    });

    console.log(
      `[ad-console] keyword extract for ${brandId}/${angle.id}: ` +
        `${problemKeywords.length}/${outcomeKeywords.length}/${productKeywords.length} (${Date.now() - started}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.brandKeywordSets)
      .set({ status: "failed", error: msg, updatedAt: new Date() })
      .where(where);
    console.error(`[ad-console] keyword extract failed for ${brandId}/${angle.id}:`, err);
  }
}

// ── Auto-extraction across a brand's angles + search-query builders (Phase 2 #137) ──
//
// The Console's relevance backbone (spec §6.1): rather than searching the ad
// library + TikTok with the niche's GENERIC seed terms ("supplements", "gut
// health"), we drive the pulls from THIS brand's angle psychology. Each angle's
// keyword_extract output yields product/solution phrases (→ ad-library queries)
// and problem/outcome phrases (→ organic queries). `ensureBrandKeywords` makes
// sure every angle has a set (auto-running the LLM extractor once, idempotently),
// and `buildBrandSearchQueries` turns the completed sets into the actual queries.

/** Max angles we auto-extract per brand, to bound first-pull LLM spend. */
const MAX_ANGLES_TO_EXTRACT = 12;
/** How many angle extractions to run concurrently. */
const EXTRACT_CONCURRENCY = 3;
/** Max search queries built per surface (the ingest caps apply the final slice). */
const MAX_BRAND_QUERIES = 12;

type BrandAnglePair = { productId: string; angle: KeywordAngle };

/** Every (product, angle) pair for a brand, flattened from each product's research.angles. */
async function listBrandAngles(brandId: string): Promise<BrandAnglePair[]> {
  const products = await db
    .select({ id: schema.products.id, research: schema.products.research })
    .from(schema.products)
    .where(eq(schema.products.brandId, brandId));
  const pairs: BrandAnglePair[] = [];
  for (const p of products) {
    const research = (p.research ?? {}) as Record<string, unknown> & { angles?: unknown };
    const angles = Array.isArray(research.angles) ? (research.angles as StoredAngle[]) : [];

    // Self-heal: stamp a stable id onto any angle missing one, and persist it.
    // The keyword set is keyed on the angle id, and the products-route backfill
    // (ensureAngleIds) only fires on the operator's product-detail GET — so an
    // angle that's never been opened there arrives here id-less and would be
    // silently dropped. Healing in place means the pull path can always extract.
    let changed = false;
    const healed = angles.map((a) => {
      if (a && typeof a === "object" && (typeof a.id !== "string" || !a.id.trim())) {
        changed = true;
        return { ...a, id: randomUUID() };
      }
      return a;
    });
    if (changed) {
      await db
        .update(schema.products)
        .set({ research: { ...research, angles: healed } })
        .where(eq(schema.products.id, p.id));
    }

    for (const a of healed) {
      // Need a stable id (the keyword set is keyed on it) and a name.
      if (!a || typeof a.id !== "string" || !a.id.trim() || typeof a.name !== "string" || !a.name.trim()) continue;
      pairs.push({
        productId: p.id,
        angle: { id: a.id, name: a.name, block: typeof a.block === "string" ? a.block : "" },
      });
    }
  }
  return pairs;
}

export type EnsureKeywordsResult = {
  totalAngles: number;
  alreadyComplete: number;
  extracted: number;
  failed: number;
};

/**
 * Auto-run keyword extraction across ALL of a brand's product angles, skipping
 * angles that already have a `complete` keyword set. Idempotent + bounded: only
 * missing/failed angles are (re)extracted, capped at MAX_ANGLES_TO_EXTRACT and
 * run EXTRACT_CONCURRENCY at a time.
 *
 * LLM-only (no Apify), so it's safe to call from the manual pull/ingest paths —
 * the FIRST pull pays for extraction, later pulls are a cheap no-op query. Never
 * throws: per-angle failures are recorded on the row and counted here.
 */
export async function ensureBrandKeywords(brandId: string): Promise<EnsureKeywordsResult> {
  const pairs = await listBrandAngles(brandId);
  const existing = await db
    .select({ angleId: schema.brandKeywordSets.angleId, status: schema.brandKeywordSets.status })
    .from(schema.brandKeywordSets)
    .where(eq(schema.brandKeywordSets.brandId, brandId));
  const complete = new Set(existing.filter((s) => s.status === "complete").map((s) => s.angleId));

  const todo = pairs.filter((p) => !complete.has(p.angle.id)).slice(0, MAX_ANGLES_TO_EXTRACT);
  let extracted = 0;
  let failed = 0;

  for (let i = 0; i < todo.length; i += EXTRACT_CONCURRENCY) {
    const chunk = todo.slice(i, i + EXTRACT_CONCURRENCY);
    const outcomes = await Promise.all(
      chunk.map(async ({ productId, angle }) => {
        await startKeywordExtract(brandId, productId, angle);
        await runKeywordExtract(brandId, productId, angle); // never throws — records terminal state
        const [row] = await db
          .select({ status: schema.brandKeywordSets.status })
          .from(schema.brandKeywordSets)
          .where(and(eq(schema.brandKeywordSets.brandId, brandId), eq(schema.brandKeywordSets.angleId, angle.id)))
          .limit(1);
        return row?.status === "complete";
      }),
    );
    for (const ok of outcomes) if (ok) extracted++; else failed++;
  }

  console.log(
    `[ad-console] ensureBrandKeywords(${brandId}): ${pairs.length} angles, ` +
      `${complete.size} already complete, extracted ${extracted}, failed ${failed}`,
  );
  return { totalAngles: pairs.length, alreadyComplete: complete.size, extracted, failed };
}

/** Case-insensitive dedupe, preserving first occurrence + original casing. */
function dedupeCI(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

/**
 * Round-robin across angles (one keyword from each in turn) so the query set is
 * diverse rather than 12 keywords from a single angle, and put multi-word phrases
 * before bare single words. A phrase like "mushroom coffee" is a far better
 * ad-library search than "coffee" — that's the whole point of #137: angle-
 * specific phrases, NOT a generic one-word "supplements" search.
 */
function selectQueries(perAngle: string[][], limit: number): string[] {
  const phrases: string[] = [];
  const singles: string[] = [];
  const maxLen = perAngle.reduce((m, a) => Math.max(m, a.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const angle of perAngle) {
      const kw = angle[i];
      if (!kw) continue;
      if (kw.trim().includes(" ")) phrases.push(kw);
      else singles.push(kw);
    }
  }
  return dedupeCI([...phrases, ...singles]).slice(0, limit);
}

export type BrandSearchQueries = {
  /** Ad-library keyword queries (product/solution keywords — specific phrases first). */
  adQueries: string[];
  /** Organic search queries (problem + outcome keywords — the pains/desires). */
  organicQueries: string[];
};

/**
 * DERIVE the brand's ad + organic search queries from its completed angle keyword
 * sets (the auto-extraction result):
 *   - adQueries      ← product/solution keywords (Section 3)
 *   - organicQueries ← problem + outcome keywords (Sections 1+2)
 * Returns empty arrays when no set is complete yet. This is the SEED for the
 * operator-curated `brands.search_terms`; prefer `buildBrandSearchQueries` /
 * `getBrandSearchTerms` which honour operator edits over this derivation.
 */
async function deriveBrandSearchQueries(brandId: string): Promise<BrandSearchQueries> {
  const sets = await db
    .select({
      problem: schema.brandKeywordSets.problemKeywords,
      outcome: schema.brandKeywordSets.outcomeKeywords,
      product: schema.brandKeywordSets.productKeywords,
      status: schema.brandKeywordSets.status,
    })
    .from(schema.brandKeywordSets)
    .where(eq(schema.brandKeywordSets.brandId, brandId));

  const asArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];

  const productPerAngle: string[][] = [];
  const painPerAngle: string[][] = [];
  for (const s of sets) {
    if (s.status !== "complete") continue;
    productPerAngle.push(asArr(s.product));
    // Problem + outcome both describe the organic search surface.
    painPerAngle.push([...asArr(s.problem), ...asArr(s.outcome)]);
  }

  return {
    adQueries: selectQueries(productPerAngle, MAX_BRAND_QUERIES),
    organicQueries: selectQueries(painPerAngle, MAX_BRAND_QUERIES),
  };
}

// ── Operator-curated search terms (brands.search_terms) ──────────────────────
//
// The Console exposes the brand's actual search queries for transparency + edit.
// `search_terms` is materialized once from the auto-derived queries, then becomes
// the SOURCE OF TRUTH — operator adds/removes win, and a re-extraction never wipes
// them (the operator owns the list once it exists).

/** The two search lanes the operator can curate. */
export type SearchLane = "ad" | "organic";
export type BrandSearchTerms = { ad: string[]; organic: string[] };

/** Read `brands.search_terms`, or null when not yet materialized / malformed. */
async function readStoredSearchTerms(brandId: string): Promise<BrandSearchTerms | null> {
  const [b] = await db
    .select({ searchTerms: schema.brands.searchTerms })
    .from(schema.brands)
    .where(eq(schema.brands.id, brandId))
    .limit(1);
  const st = b?.searchTerms as unknown;
  if (st && typeof st === "object" && Array.isArray((st as BrandSearchTerms).ad) && Array.isArray((st as BrandSearchTerms).organic)) {
    return st as BrandSearchTerms;
  }
  return null;
}

async function writeStoredSearchTerms(brandId: string, terms: BrandSearchTerms): Promise<void> {
  await db.update(schema.brands).set({ searchTerms: terms }).where(eq(schema.brands.id, brandId));
}

/**
 * The brand's effective search terms: the stored operator-curated list if it
 * exists, else the derivation from keyword sets — materialized (persisted) so the
 * operator has a stable editable list. Empty derivations are NOT persisted, so a
 * later keyword extraction can still seed the list.
 */
async function materializeSearchTerms(brandId: string): Promise<BrandSearchTerms> {
  const stored = await readStoredSearchTerms(brandId);
  if (stored) return stored;
  const derived = await deriveBrandSearchQueries(brandId);
  const terms: BrandSearchTerms = { ad: derived.adQueries, organic: derived.organicQueries };
  if (terms.ad.length > 0 || terms.organic.length > 0) await writeStoredSearchTerms(brandId, terms);
  return terms;
}

/** Console read: the effective terms + whether any keyword set exists (for the empty-state affordance). */
export async function getBrandSearchTerms(
  brandId: string,
): Promise<BrandSearchTerms & { hasKeywordSets: boolean }> {
  const [terms, sets] = await Promise.all([materializeSearchTerms(brandId), listBrandKeywordSets(brandId)]);
  return { ...terms, hasKeywordSets: sets.some((s) => s.status === "complete") };
}

/** Add an operator term to one lane (case-insensitive dedupe). Returns the updated list. */
export async function addBrandSearchTerm(brandId: string, lane: SearchLane, keyword: string): Promise<BrandSearchTerms> {
  const kw = keyword.trim();
  if (!kw) throw new Error("Keyword cannot be empty");
  const cur = await materializeSearchTerms(brandId);
  const terms: BrandSearchTerms = { ad: [...cur.ad], organic: [...cur.organic] };
  const lc = kw.toLowerCase();
  if (!terms[lane].some((t) => t.toLowerCase() === lc)) terms[lane].push(kw);
  await writeStoredSearchTerms(brandId, terms);
  return terms;
}

/** Remove an operator term from one lane (case-insensitive). Persists the removal. Returns the updated list. */
export async function removeBrandSearchTerm(brandId: string, lane: SearchLane, keyword: string): Promise<BrandSearchTerms> {
  const cur = await materializeSearchTerms(brandId);
  const lc = keyword.trim().toLowerCase();
  const terms: BrandSearchTerms = {
    ad: lane === "ad" ? cur.ad.filter((t) => t.toLowerCase() !== lc) : [...cur.ad],
    organic: lane === "organic" ? cur.organic.filter((t) => t.toLowerCase() !== lc) : [...cur.organic],
  };
  await writeStoredSearchTerms(brandId, terms);
  return terms;
}

/**
 * Build the brand's ad + organic SEARCH queries that DRIVE the pulls. Prefers the
 * operator-curated `search_terms`; falls back to deriving from keyword sets when
 * the operator has never opened the keyword manager. Empty arrays ⇒ callers fall
 * back to the niche seed terms.
 */
export async function buildBrandSearchQueries(brandId: string): Promise<BrandSearchQueries> {
  const stored = await readStoredSearchTerms(brandId);
  if (stored) return { adQueries: stored.ad, organicQueries: stored.organic };
  return deriveBrandSearchQueries(brandId);
}
