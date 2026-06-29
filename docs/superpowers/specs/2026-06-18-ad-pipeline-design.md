# Ad Pipeline — Design Spec

**Date:** 2026-06-18
**Status:** Approved for planning

## 1. Summary

A new **Ad Pipeline** feature: a three-column Kanban (**Idea → In Production → Ready**) that captures ad ideas from the Ad Inspo Console and carries them through recreation into a finished, saved brand asset.

The pipeline is a thin orchestration layer. **All recreation logic already exists** and is reused unchanged:

- **Copy rewriting** — `POST /api/generate/text/copy_rewrite` (Copy Engine).
- **Static ad recreation** — `POST /api/static-ads/recreate` (Static Ads Recreator).
- **Video transcription** — `transcribeAudio()` (fal/whisper) in `server/lib/fal.ts:109`, already used by the listicle builder.
- **Static ad deconstruction** — `runDeconstruction()` in `server/routes/staticAdReferences.ts:370`.

The work in this spec is: a new card data model, the "Make it mine" entry dialog, background enrichment (transcribe/deconstruct), deep-links that prefill the existing apps, output linkage back onto cards, and the Kanban view itself.

## 2. Goals / Non-Goals

**Goals**
- Capture an inspo ad as a durable pipeline card with one click.
- Run transcription (video) / deconstruction (static) in the background on capture.
- Let the user recreate via the existing apps with inputs prefilled (deep-link), or just park the idea for later.
- Surface, on each card: original reference link, original script/image, the rewritten script / recreated image, and the inputs the user gave.
- Move cards through Idea → In Production → Ready with sensible auto-advance plus manual drag.

**Non-Goals**
- No changes to the recreation/generation/prompt logic itself.
- No new transcription or deconstruction engine — reuse existing.
- No scheduling, publishing, or analytics on the pipeline (out of scope).
- Not built on `feed_items` (those are ephemeral and re-ranked each pull).

## 3. Data Model

### 3.1 New table: `ad_pipeline_cards`

The durable home for a card. Snapshots the `CreativeBrief` so the card survives feed re-ranking.

```
ad_pipeline_cards
  id                uuid pk
  brandId           uuid not null          -- brand scoping (existing pattern)
  createdAt         timestamptz not null default now()
  updatedAt         timestamptz not null default now()
  stage             text not null default 'idea'   -- 'idea' | 'in_production' | 'ready'
  sourceType        text not null          -- 'ad' | 'organic'
  format            text not null          -- 'video' | 'static'
  brief             jsonb not null         -- full CreativeBrief snapshot
  sourceUrl         text                   -- original reference (the card's link)
  originalScript    text                   -- transcript (from brief, or filled by background job)
  referenceImageUrl text                   -- static: creative image to recreate from
  staticReferenceId uuid                   -- static: the static_ad_reference created + deconstructed
  productId         uuid                   -- chosen at recreate time (null while in Idea)
  angleName         text                   -- chosen at recreate time
  language          text default 'en'
  bgJobStatus       text default 'pending' -- 'pending' | 'running' | 'complete' | 'failed'
  bgJobError        text
```

Card order within a column: ordered by `updatedAt desc` (no explicit position column in v1).

### 3.2 Output linkage (no new outputs table)

Outputs live where they already do. We add a single linking field in two places:

1. **`generations.inputs.pipelineCardId`** — stamped automatically on every rewrite/recreate launched from a card. Always present, gives the card a *live draft* to show immediately.
2. **`brand_assets.metadata.pipelineCardId`** — stamped when the user clicks "Save to Brand Assets" (existing save flow, one extra metadata field). This is the *curated keeper*.

**Card display rule:** show the saved brand asset if one exists for the card; otherwise fall back to the latest matching generation. The card is therefore never blank while work is in progress, and reflects the curated version once saved.

## 4. "Make it mine" — Ad Inspo Console sub-task

Clicking **Make it mine** opens a dialog with two choices.

### 4.1 Add to pipeline
- Creates a card in **Idea**. No product/angle yet.
- Still runs the existing `selectFeedItem()` (flips feed item to `selected`, logs the `select` event).
- Kicks off the background enrichment job (§4.3).

### 4.2 Recreate now
- Opens the product + angle picker (same inline pattern every app uses: `product.research.angles[]`).
- On confirm: creates a card **directly in In Production**, stores `productId` / `angleName` / `language`, runs background enrichment, then deep-links to the right app (§5).

### 4.3 Background enrichment job
Reuses the existing in-memory fire-and-forget + 2.5s client-poll pattern. Sets `bgJobStatus`.

- **Video:** if `brief.transcript` exists (free for IG organic), use it as `originalScript`. Otherwise call `transcribeAudio({ audioUrl })` on the video media URL and store the result. Whisper failure is non-fatal: set `bgJobStatus = failed`, leave `originalScript` null, card remains usable.
- **Static:** create a `static_ad_reference` row from the creative's image URL, then call `runDeconstruction()` on it. Store the new id as `staticReferenceId`. This is the bridge that makes an inspo static ad (an `ad_creative` with image URLs) usable by the recreator, which only accepts `static_ad_references`.

## 5. Recreate flows (deep-link, zero new generation logic)

### 5.1 Video → Copy Engine
Deep-link:
```
/workspace/apps/copy-engine?mode=rewrite&product=<productId>&angle=<angleName>&source=<urlEncodedTranscript>&language=<code>&pipelineCardId=<cardId>
```
Copy Engine parses these on mount (new small `useEffect`), prefills mode/product/angle/source/language. The user supplies the **Offer** (required field, not collected in the modal) and clicks **Rewrite** — the normal manual flow. The resulting `copy_rewrite` generation is stamped with `pipelineCardId`.

### 5.2 Static → Static Ads Recreator
Deep-link:
```
/workspace/apps/static-ads?productId=<productId>&angle=<angleName>&referenceId=<staticReferenceId>&language=<code>&pipelineCardId=<cardId>
```
Page parses params, prefills product/angle/language, selects the reference, and jumps to the recreate step. The user clicks **Recreate**. The `static_ad_recreate` generation is stamped with `pipelineCardId`.

### 5.3 Changes to existing apps (minimal, additive)
- Parse URL params to prefill state (`CopyEngineAppPage.tsx`, `StaticAdsAppPage.tsx`).
- Thread `pipelineCardId` into the existing generate call's `inputs`/`vars`, and into `brand_assets.metadata` on save.
- No changes to prompts, models, or generation logic.

## 6. Kanban view

New top-level **Ad Pipeline** nav item, gated the same as the Ad Console (manager/admin + DFY). New page `AdPipelineKanbanAppPage.tsx`, route `/workspace/apps/ad-pipeline`.

### 6.1 Columns & movement
- **Idea** — landing spot for "Add to pipeline"; background enrichment runs here.
- **In Production** — "Recreate now" lands here; cards advance here when a recreate is launched.
- **Ready** — a card enters Ready **only when a saved brand asset exists for it** (`brand_assets.metadata.pipelineCardId`). A produced-but-unsaved generation is *not* enough.

Movement = auto-advance + manual drag:
- Auto: Idea → In Production when recreate launched; In Production → Ready when first linked brand asset is saved.
- Manual drag between any columns is always allowed (overrides auto state).

### 6.2 Card contents
- Original reference as a clickable link (`sourceUrl`).
- Video: original script/transcript. Static: reference image.
- Rewritten script (video) / recreated image (static) once it exists — from the saved brand asset, falling back to the latest generation.
- Inputs the user gave: product, angle, language.
- Background-job state (running/failed with retry).
- Primary action: **Recreate** on Idea cards → opens product/angle picker → deep-links (§5). On In Production cards, a link back into the relevant app deep-link to continue.

## 7. API & Routing

New `server/routes/adPipeline.ts` + entries in `client/src/lib/api.ts`, following existing `post/get/put` conventions:

- `GET /api/ad-pipeline-cards?brandId=<id>` → list cards (with resolved outputs: saved asset or latest generation per card).
- `GET /api/ad-pipeline-cards/:id` → single card with outputs.
- `POST /api/ad-pipeline-cards` → create from a feed item (`{ brandId, feedItemId, mode: 'idea' | 'recreate', productId?, angleName?, language? }`); creates the row, runs `selectFeedItem()`, starts background enrichment.
- `PUT /api/ad-pipeline-cards/:id` → update stage / product / angle / language (drag, recreate launch).
- `GET /api/ad-pipeline-cards/:id/job-status` → background enrichment status (2.5s poll).

One Drizzle migration via `pnpm db:generate` → `pnpm db:migrate`.

## 8. Error Handling

- Background transcribe/deconstruct failure → `bgJobStatus = failed` + `bgJobError`; card shows a retry control; card stays usable (degrades like the listicle whisper path).
- Deep-link with stale/missing prefill (e.g. product deleted) → the target app degrades to its normal empty state; no crash.
- Static reference creation failure → surfaced as a failed background job with retry.

## 9. Testing

- Unit: brief → card mapping; card lifecycle (create → background job → stage transitions); output resolution rule (saved asset vs latest generation); Ready gate requires a saved asset.
- Integration: `POST /api/ad-pipeline-cards` runs `selectFeedItem()` + starts enrichment; `pipelineCardId` round-trips into `generations` and `brand_assets`.
- Manual: each deep-link prefills correctly; rewrite/recreate output appears on the card; saving to brand assets advances the card to Ready and files the asset in Assets.

## 10. Decisions (locked)

- Kanban states: **Idea → In Production → Ready**.
- Recreation runs by **deep-linking into the existing apps**, not inline.
- Copy-rewrite **Offer** is supplied in Copy Engine after the deep-link; the modal collects only product + angle (+ language).
- Outputs are linked via **both** `generations` (live draft) **and** `brand_assets` (curated keeper); the card prefers the saved asset.
- **Ready requires a saved brand asset**, not merely a produced output.
- Pipeline is a **new top-level nav item** (not a card in the Apps gallery).
- Stage movement is **auto-advance + manual drag**.
