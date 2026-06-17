# Keyword Extraction Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Ad Console's auto-extracted search keywords high-yield for *finding* relevant competitor ads and viral organic content, instead of buyer-psychology terms that search poorly.

**Architecture:** Three coordinated changes. (1) `selectQueries` is rewritten so shared short category anchors ("sunscreen", "spf") always survive the per-lane cap. (2) `prompts/keyword_extract.md` is rewritten to demand search-yield terms and reject jargon/abstractions. (3) A force-regeneration path (lib fn + endpoint + client + "Regenerate" button) lets existing brands re-extract with the improved prompt and reset their curated terms.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Express, Drizzle ORM, React + Vite, vitest. Type check: `pnpm check`. Tests: `pnpm exec vitest run --root . <file>`.

---

### Task 1: Fix `selectQueries` so category anchors survive the cap

**Files:**
- Modify: `server/lib/adConsoleKeywords.ts` (the `selectQueries` function, ~lines 443–463; export it and add a `categoryAnchors` helper)
- Create: `server/lib/adConsoleKeywords.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/lib/adConsoleKeywords.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selectQueries } from "./adConsoleKeywords.js";

describe("selectQueries", () => {
  it("surfaces shared one-word category anchors despite the cap", () => {
    // Each angle shares the one-word anchors "sunscreen"/"spf" plus many two-word
    // phrases. The old impl front-loaded phrases and sliced to 12, dropping the
    // anchors — the exact bug where "sunscreen" was in the data but never searched.
    const phrasesA = [
      "mineral sunscreen", "zinc sunscreen", "tinted sunscreen", "daily sunscreen",
      "face sunscreen", "clean sunscreen", "reef safe", "broad spectrum",
      "non greasy", "lightweight cream", "pore blurring", "satin finish", "spf moisturizer",
    ];
    const phrasesB = [
      "korean sunscreen", "japanese sunscreen", "gel sunscreen", "spray sunscreen",
      "kids sunscreen", "sport sunscreen", "matte sunscreen", "hydrating spf",
      "invisible spf", "no white cast", "glowy sunscreen", "everyday spf", "spf primer",
    ];
    const angleA = ["sunscreen", "spf", ...phrasesA];
    const angleB = ["sunscreen", "spf", ...phrasesB];
    const result = selectQueries([angleA, angleB], 12);
    expect(result).toContain("sunscreen");
    expect(result).toContain("spf");
    expect(result).toHaveLength(12);
  });

  it("dedupes case-insensitively and respects the limit", () => {
    const result = selectQueries([["Sunscreen", "sunscreen", "mineral sunscreen"]], 12);
    expect(result.filter((t) => t.toLowerCase() === "sunscreen")).toHaveLength(1);
    expect(result.length).toBeLessThanOrEqual(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --root . server/lib/adConsoleKeywords.test.ts`
Expected: FAIL — `selectQueries` is not exported (import error), or the first assertion fails because "sunscreen"/"spf" are sliced out.

- [ ] **Step 3: Replace `selectQueries` and add `categoryAnchors`**

In `server/lib/adConsoleKeywords.ts`, find the current `selectQueries` (the function whose body is `const phrases: string[] = []; const singles: string[] = []; ... return dedupeCI([...phrases, ...singles]).slice(0, limit);`) and replace the whole function with:

```ts
/**
 * Category anchors: short (1–2 word) terms SHARED across angles — the
 * category-defining queries (e.g. "sunscreen", "spf"). A term shared by ≥2
 * angles is a strong category signal; for a single-angle brand we treat its
 * own 1–2 word terms as anchors. Sorted by frequency, then brevity.
 */
function categoryAnchors(perAngle: string[][]): string[] {
  const freq = new Map<string, number>();
  for (const angle of perAngle) {
    const seen = new Set<string>();
    for (const kw of angle) {
      const k = kw.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
  }
  const minAngles = perAngle.length >= 2 ? 2 : 1;
  return Array.from(freq.entries())
    .filter(([k, n]) => n >= minAngles && k.split(/\s+/).length <= 2)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .map(([k]) => k);
}

/**
 * Round-robin across angles (one keyword from each in turn) for a DIVERSE query
 * set, but FIRST guarantee the category anchors (shared short terms like
 * "sunscreen") so the per-lane cap can never slice them out — that was the bug
 * where "sunscreen" lived in the data yet never reached the search. Multi-word
 * phrases are preferred over bare single words among the non-anchor remainder.
 *
 * Exported for unit testing.
 */
export function selectQueries(perAngle: string[][], limit: number): string[] {
  const anchors = categoryAnchors(perAngle).slice(0, Math.max(3, Math.ceil(limit / 2)));
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
  return dedupeCI([...anchors, ...phrases, ...singles]).slice(0, limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --root . server/lib/adConsoleKeywords.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Type check**

Run: `pnpm check`
Expected: exits 0, no output.

- [ ] **Step 6: Commit**

```bash
git add server/lib/adConsoleKeywords.ts server/lib/adConsoleKeywords.test.ts
git commit -m "fix(ad-console): keep shared category anchors in search queries"
```

---

### Task 2: Rewrite the keyword-extraction prompt for search yield

**Files:**
- Modify: `prompts/keyword_extract.md` (full replacement of the body; keep the frontmatter)

- [ ] **Step 1: Replace the prompt file contents**

Overwrite `prompts/keyword_extract.md` with exactly:

```markdown
---
model: claude-opus-4-7
maxTokens: 2500
thinking: false
expectsJson: false
---

# SYSTEM ROLE

You are a competitive ad-research strategist. Your job is to turn ONE advertising angle into SEARCH QUERIES that surface high-performing competitor ads (ad libraries) and viral organic videos (TikTok, Instagram Reels) in THIS product's category.

You are NOT describing the angle's psychology. You are NOT writing ad copy. Every keyword you output is a literal search query someone will paste into an ad library or a TikTok / Instagram search bar.

# INPUT

PRODUCT RESEARCH:
{{productContext}}

ADVERTISING ANGLE:
{{angle}}

# THE ONE TEST EVERY KEYWORD MUST PASS

For each keyword, ask: "If I paste this into an ad-library or TikTok search, will the results be (a) ON-TOPIC for this product's category, and (b) PLENTIFUL?"

Keep it ONLY if both are true. That means real words that appear in competitor ad copy and in creator captions / hashtags — not the way a strategist would label the underlying psychology.

# REJECT these patterns — they search badly

- **Jargon / mechanism / ingredient names** the brand invented or that only insiders use — e.g. "banana base", "iron oxides", "rejuva complex". Nobody searches these.
- **Internal product poetry** — "cushiony texture", "satin finish", "pillowy feel". Not how people search.
- **Emotional / identity / behavioral abstractions** nobody writes in copy or captions — "excluded shoppers", "ignored buyer", "invisible afterthought", "couple friendly", "forgetting spf", "skipping sunscreen".
- **Platform names** as queries — "tiktok", "instagram", "reels".
- **Ultra-generic descriptors** that return mostly UNRELATED content — "oil free", "non greasy", "lightweight", "burning eyes", "shiny face". (A sunscreen ad and a thousand unrelated ads all say "oil free".)

# REQUIRE these

- **The bare product category, always** — the plain category noun AND its common qualifiers. For a sunscreen: "sunscreen", "spf", "mineral sunscreen", "sunscreen for face", "sunscreen for dark skin".
- **Real adjacent topics & problems people actually search**, tied to this angle — e.g. "white cast", "sunburn", "spf review", "sunscreen routine", "best sunscreen".
- A spread from broad (category) to specific (category + this angle's qualifier). Lead each section with the broadest, most-searched terms.

# OUTPUT FORMAT

- Output THREE sections (Problem, Desired Outcome, Product / Solution). They still organise the angle, but EVERY term in every section must pass the search test above.
- 12–18 keywords per section. Each keyword is 1–3 words.
- All lowercase. No brand names. No punctuation, emojis, or quotes (only the list number).
- Order each section broad → specific (most-searchable category terms first).

# GOOD vs BAD (sunscreen example)

GOOD — searchable, on-topic, plentiful:
sunscreen, spf, mineral sunscreen, tinted sunscreen, sunscreen for face, sunscreen for dark skin, white cast, spf review, sunscreen routine, reef safe sunscreen, no white cast, best sunscreen, sunburn

BAD — jargon / abstraction / too broad — NEVER output these:
banana base, iron oxides, oil free, non comedogenic, cushiony texture, excluded shoppers, ignored buyer, forgetting spf, burning eyes, tiktok

# FINAL OUTPUT RULE

Do not explain. Do not comment. Do not show reasoning. Output ONLY the three numbered lists, each under its exact header:

SECTION 1 — PROBLEM KEYWORDS
1. ...
2. ...

SECTION 2 — DESIRED OUTCOME KEYWORDS
1. ...
2. ...

SECTION 3 — PRODUCT / SOLUTION KEYWORDS
1. ...
2. ...
```

- [ ] **Step 2: Verify the parser still recognises the section headers**

The reader is `parseKeywordSections` in `server/lib/adConsoleKeywords.ts`; it keys on `/\bproblem\b/`, `/\b(outcome|desire|desired)\b/`, `/\b(product|solution)\b/` and numbered lines `^\s*\d{1,2}[.)]\s+`. The new headers ("PROBLEM KEYWORDS", "DESIRED OUTCOME KEYWORDS", "PRODUCT / SOLUTION KEYWORDS") and numbered lists match all of these, so no parser change is needed. Confirm by reading those regexes.

Run: `pnpm check`
Expected: exits 0 (prompt is a markdown file; this just confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add prompts/keyword_extract.md
git commit -m "feat(ad-console): rewrite keyword_extract prompt for search yield"
```

---

### Task 3: Force-regeneration path (lib + endpoint + client + UI button)

**Files:**
- Modify: `server/lib/adConsoleKeywords.ts` (add `force` to `ensureBrandKeywords`; add `regenerateBrandKeywords`)
- Modify: `server/routes/adConsole.ts` (import `regenerateBrandKeywords`; add `POST /keywords/regenerate`)
- Modify: `client/src/lib/api.ts` (add `regenerateAdConsoleKeywords`)
- Modify: `client/src/pages/workspace/AdConsolePage.tsx` (import the fn; add Regenerate button + confirm + handler to `KeywordManager`)

- [ ] **Step 1: Add a `force` option to `ensureBrandKeywords`**

In `server/lib/adConsoleKeywords.ts`, change the signature and the `todo` filter. Replace:

```ts
export async function ensureBrandKeywords(brandId: string): Promise<EnsureKeywordsResult> {
  const pairs = await listBrandAngles(brandId);
  const existing = await db
    .select({ angleId: schema.brandKeywordSets.angleId, status: schema.brandKeywordSets.status })
    .from(schema.brandKeywordSets)
    .where(eq(schema.brandKeywordSets.brandId, brandId));
  const complete = new Set(existing.filter((s) => s.status === "complete").map((s) => s.angleId));

  const todo = pairs.filter((p) => !complete.has(p.angle.id)).slice(0, MAX_ANGLES_TO_EXTRACT);
```

with:

```ts
export async function ensureBrandKeywords(
  brandId: string,
  opts?: { force?: boolean },
): Promise<EnsureKeywordsResult> {
  const pairs = await listBrandAngles(brandId);
  const existing = await db
    .select({ angleId: schema.brandKeywordSets.angleId, status: schema.brandKeywordSets.status })
    .from(schema.brandKeywordSets)
    .where(eq(schema.brandKeywordSets.brandId, brandId));
  const complete = new Set(existing.filter((s) => s.status === "complete").map((s) => s.angleId));

  // force ⇒ re-extract EVERY angle (used by "Regenerate" after the prompt
  // improves); otherwise skip angles that already have a complete set.
  const todo = pairs
    .filter((p) => opts?.force || !complete.has(p.angle.id))
    .slice(0, MAX_ANGLES_TO_EXTRACT);
```

(The rest of the function body — the extraction loop, the `console.log`, and the `return` — is unchanged.)

- [ ] **Step 2: Add `regenerateBrandKeywords`**

In `server/lib/adConsoleKeywords.ts`, immediately AFTER the `ensureBrandKeywords` function (after its closing `}`), add:

```ts
/**
 * Force a full re-extraction of every angle (e.g. after the extraction prompt
 * improves) and RESET the operator-curated search terms to the fresh derivation.
 * Clears `search_terms` FIRST so the Console shows the rebuild in progress, then
 * re-extracts, then re-materializes. Discards prior manual edits by design — the
 * operator re-tunes from the improved base.
 */
export async function regenerateBrandKeywords(brandId: string): Promise<EnsureKeywordsResult> {
  await db.update(schema.brands).set({ searchTerms: null }).where(eq(schema.brands.id, brandId));
  const result = await ensureBrandKeywords(brandId, { force: true });
  await materializeSearchTerms(brandId);
  return result;
}
```

`materializeSearchTerms` already exists in this file (it derives + persists `search_terms`); `eq` and `schema` are already imported.

- [ ] **Step 3: Type check**

Run: `pnpm check`
Expected: exits 0.

- [ ] **Step 4: Add the regenerate endpoint**

In `server/routes/adConsole.ts`, add `regenerateBrandKeywords` to the existing import from `../lib/adConsoleKeywords.js` (the block that already imports `ensureBrandKeywords, getBrandSearchTerms, addBrandSearchTerm, removeBrandSearchTerm, type SearchLane`):

```ts
  ensureBrandKeywords,
  regenerateBrandKeywords,
  getBrandSearchTerms,
```

Then, immediately AFTER the existing `POST /brands/:brandId/keywords/generate` handler (the one whose body calls `ensureBrandKeywords(brandId)`), add:

```ts
/**
 * POST /api/ad-console/brands/:brandId/keywords/regenerate — force re-extract
 * every angle's keywords (uses the improved prompt) and RESET the curated search
 * terms to the fresh derivation. Discards manual edits. Fire-and-forget; the
 * Console polls GET /keywords. 424 when the extractor prompt isn't configured.
 */
adConsoleRouter.post("/brands/:brandId/keywords/regenerate", async (req: Request, res: Response) => {
  const brandId = req.params.brandId;
  try {
    void (async () => {
      try {
        await regenerateBrandKeywords(brandId);
      } catch (err) {
        console.error("[ad-console] keyword regenerate worker crashed:", err);
      }
    })();
    res.status(202).json({ started: true });
  } catch (err) {
    if (err instanceof PromptNotConfiguredError) return sendError(res, 424, err.message);
    console.error("[ad-console] start keyword regenerate failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});
```

- [ ] **Step 5: Add the client API function**

In `client/src/lib/api.ts`, immediately AFTER the existing `generateAdConsoleKeywords` function, add:

```ts
/** Force re-extraction from angles (improved prompt) + reset to the fresh terms. Discards manual edits. Poll getAdConsoleKeywords. */
export function regenerateAdConsoleKeywords(brandId: string): Promise<{ started: true }> {
  return post<{ started: true }>(`${AD_CONSOLE}/brands/${brandId}/keywords/regenerate`, {});
}
```

- [ ] **Step 6: Import the client fn in the page**

In `client/src/pages/workspace/AdConsolePage.tsx`, find the import line `getAdConsoleKeywords, addAdConsoleKeyword, removeAdConsoleKeyword, generateAdConsoleKeywords,` and replace it with:

```ts
  getAdConsoleKeywords, addAdConsoleKeyword, removeAdConsoleKeyword, generateAdConsoleKeywords, regenerateAdConsoleKeywords,
```

- [ ] **Step 7: Add regenerate state + handler to `KeywordManager`**

In `client/src/pages/workspace/AdConsolePage.tsx`, inside the `KeywordManager` component, find the state declarations (the block ending with `const [organicInput, setOrganicInput] = useState("");`) and add two lines after it:

```ts
  const [regenerating, setRegenerating] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
```

Then find the `handleGenerate` function and add this handler immediately AFTER it:

```ts
  async function handleRegenerate() {
    if (regenerating) return;
    setConfirmRegen(false);
    setRegenerating(true);
    try {
      await regenerateAdConsoleKeywords(brandId);
      // Re-extraction runs server-side (~25s for 5 angles). Terms stay non-empty
      // throughout (old → new), so poll a fixed window and refresh live — no
      // early break.
      for (let i = 0; i < 14; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        setTerms(await getAdConsoleKeywords(brandId));
      }
      onNotice({ kind: "success", text: "Keywords regenerated from your angles." });
    } catch (err) {
      onNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setRegenerating(false);
    }
  }
```

- [ ] **Step 8: Add the Regenerate button + confirm to the header**

Still in `KeywordManager`, replace the header block:

```tsx
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">Search keywords</span>
        {!loading && <span className="text-[10px] font-mono text-white/25">{total} term{total === 1 ? "" : "s"}</span>}
      </div>
```

with:

```tsx
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">Search keywords</span>
        <div className="flex items-center gap-2">
          {!loading && <span className="text-[10px] font-mono text-white/25">{total} term{total === 1 ? "" : "s"}</span>}
          {!loading && total > 0 && !confirmRegen && (
            <button
              onClick={() => setConfirmRegen(true)}
              disabled={regenerating}
              title="Re-extract all keywords with the latest prompt (discards manual edits)"
              className="flex items-center gap-1 text-[10px] font-mono text-white/40 hover:text-white/70 disabled:opacity-50"
            >
              {regenerating ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              Regenerate
            </button>
          )}
        </div>
      </div>
      {confirmRegen && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-2 py-1.5">
          <span className="text-[10px] font-mono text-amber-200/80">Replace all keywords with a fresh extraction?</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void handleRegenerate()}
              className="px-2 py-0.5 rounded text-[10px] font-mono text-amber-100 bg-amber-500/15 hover:bg-amber-500/25"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmRegen(false)}
              className="px-2 py-0.5 rounded text-[10px] font-mono text-white/50 hover:text-white/80"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
```

(`RefreshCw` and `Loader2` are already imported in this file.)

- [ ] **Step 9: Type check + production build**

Run: `pnpm check`
Expected: exits 0.

Run: `pnpm build`
Expected: ends with `✓ built` and `dist/index.js` — no errors.

- [ ] **Step 10: Commit**

```bash
git add server/lib/adConsoleKeywords.ts server/routes/adConsole.ts client/src/lib/api.ts client/src/pages/workspace/AdConsolePage.tsx
git commit -m "feat(ad-console): regenerate keywords with the improved extraction prompt"
```

---

### Task 4: Verify on dev, then ship

**Files:** none (verification + deploy)

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm exec vitest run --root . server/lib/adConsoleKeywords.test.ts server/lib/adspy.test.ts`
Expected: all PASS.

- [ ] **Step 2: Eval the new prompt on a dev brand with angles**

Write a throwaway script `tmp_eval_keywords.ts` in the project root:

```ts
import pg from "pg";
import { regenerateBrandKeywords, getBrandSearchTerms } from "./server/lib/adConsoleKeywords.js";
async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  // Pick a dev brand that has product angles (e.g. one healed earlier).
  const { rows } = await pool.query(
    `select distinct b.id, b.name from brands b
       join products p on p.brand_id = b.id
      where p.research -> 'angles' is not null
      order by b.name limit 1`);
  if (!rows.length) { console.log("no brand with angles on dev"); await pool.end(); return; }
  console.log(`Regenerating: ${rows[0].name} (${rows[0].id})`);
  await regenerateBrandKeywords(rows[0].id);
  const terms = await getBrandSearchTerms(rows[0].id);
  console.log("AD:", JSON.stringify(terms.ad));
  console.log("ORGANIC:", JSON.stringify(terms.organic));
  await pool.end();
}
main().catch((e) => { console.error("ERR", e instanceof Error ? e.stack : e); process.exit(1); });
```

Run: `pnpm exec tsx --env-file=.env.local ./tmp_eval_keywords.ts`
Expected: AD + ORGANIC lists that (a) include the brand's plain category term and common qualifiers, and (b) contain NO ingredient/mechanism jargon, emotional abstractions, or platform names. Then delete the script: `rm -f tmp_eval_keywords.ts`.

- [ ] **Step 3: Ship**

```bash
git push origin main
```

(No migration in this plan — `brands.search_terms` already exists from migration 0024. After deploy, regenerating an existing brand like Minori from the Console's "Regenerate" button applies the improved prompt to live data.)
