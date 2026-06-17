# Keyword Extraction Quality — Design

**Goal:** Make the Ad Console's auto-extracted search keywords high-yield for *finding* relevant competitor ads (AdSpy) and viral organic content (IG/TikTok), instead of buyer-psychology terms that search poorly.

## Problem (diagnosed from live Minori data)

The keyword sets serve two jobs from one extraction: **relevance scoring** (rank how on-message a pulled item is) and **search queries** (the terms actually sent to AdSpy / Apify). They're tuned for the first and fail the second. Evidence from Minori's "No White Cast" angle:

- **Selection bug.** `selectQueries` lists all two-word phrases before one-word terms and caps each lane at 12, so one-word category anchors that ARE in the data — `"sunscreen"` (the #1 problem keyword), `"spf"`, `"mineral"` — never survive the slice. That's why "sunscreen" is absent from the panel despite being extracted.
- **Jargon nobody searches.** `banana base`, `iron oxides`, `cushiony texture`, `satin finish` — Minori's internal mechanism/poetry. Near-zero matches in competitor ad copy or creator captions.
- **Un-searchable abstractions.** Organic lane is full of `excluded shoppers`, `ignored buyer`, `invisible afterthought`, `couple friendly`, `family approved`, and the prompt's "platform-browse word" instruction literally produced `tiktok` as a query.
- **Over-broad terms.** `oil free`, `non greasy`, `shiny face`, `burning eyes`, `watery eyes` match oceans of unrelated content.
- **Missing adjacents.** `sunburn`, `spf review`, `sunscreen routine`, `sunscreen for dark skin` were never generated.

## Decisions (locked)

1. **Relax the rigid format.** Drop the "exactly 5 one-word + 15 two-word, no three-word" rule. Allow 1–3 word terms; prioritize searchability over a fixed shape. Keep: all lowercase, no brand names, no punctuation/emoji.
2. **One improved keyword set.** Keep a single set serving both search and relevance — do NOT split into separate search-vs-relevance sets. The better terms serve both well enough; revisit only if ranking regresses.

## Design — three coordinated changes

### 1. Rewrite `prompts/keyword_extract.md` around search yield

- **Core directive:** every keyword must be something that, pasted into an ad-library or TikTok/IG search, returns results that are (a) on-topic for THIS product's category and (b) plentiful. The model is generating *search queries*, not describing the angle.
- **Reject patterns (explicit):** mechanism/ingredient jargon and internal product poetry; emotional/identity/behavioral abstractions nobody writes in ad copy or captions; platform names (`tiktok`, `instagram`); ultra-generic descriptors that match unrelated content.
- **Require:** the bare product category + common qualifiers (e.g. `sunscreen`, `spf`, `mineral sunscreen`, `sunscreen for face`); real adjacent topic/problem terms creators actually use (e.g. `sunburn`, `white cast`, `spf review`, `sunscreen routine`).
- **Keep the three sections** (problem / outcome / product) — they still feed relevance — but reframe each toward *searchable* language. Remove the "platform-browse word" instruction.
- **Relax format:** ~12–20 terms per section, 1–3 words each; drop the one-word/two-word split.
- **Add a calibrated GOOD vs BAD few-shot** for a sunscreen so the model learns the bar (good: `sunscreen`, `mineral sunscreen`, `white cast`, `spf review`; bad: `banana base`, `iron oxides`, `oil free`, `excluded shoppers`, `tiktok`).

### 2. Category-anchor floor + `selectQueries` fix (`server/lib/adConsoleKeywords.ts`)

- **Anchor floor:** derive the product's category head terms from product name/niche (e.g. `sunscreen`, `spf`) and ensure they appear in BOTH the ad and organic search lanes — injected as a guaranteed floor before the 12-cap slice, so they can never be omitted.
- **Fix `selectQueries`:** stop dumping all one-word terms after phrases. Reserve a few slots (or interleave) so a handful of high-value one-word anchors always survive the cap instead of being buried under phrases.

### 3. "Regenerate keywords" action in the manager (`AdConsolePage` + `adConsole.ts` + `api.ts`)

- The prompt change only affects NEW extractions; existing brands' keyword sets are cached (`ensureBrandKeywords` skips `complete` angles). Add a **force re-extraction** path: re-run extraction for all of a brand's angles ignoring `complete`, then reset `brands.search_terms` to the fresh derivation so the improved terms materialize.
- Surfaced as a **"Regenerate"** button in the keyword manager (shown when keywords already exist), with a confirm noting it replaces the current auto-derived list. Operator manual edits made after regeneration remain the final layer (regenerate resets the base; the operator re-tunes from the improved starting point).

## Out of scope

Splitting search vs relevance keyword sets; per-product keyword scoping; editing the shared niche seed terms.

## Testing

- **Unit:** a `selectQueries` test asserting one-word anchors survive the 12-cap (currently they don't).
- **Eval (manual):** regenerate Minori on dev, inspect the new ad + organic terms against the target — `sunscreen` / `spf` / `mineral sunscreen` present in both lanes; `banana base` / `iron oxides` / `oil free` / `excluded shoppers` / `tiktok` gone.
- `pnpm check` + production build green.
