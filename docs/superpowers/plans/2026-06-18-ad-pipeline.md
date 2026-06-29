# Ad Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an "Ad Pipeline" Kanban (Idea → In Production → Ready) that captures inspo ads via "Make it mine", enriches them in the background (transcribe video / deconstruct static), deep-links into the existing Copy Engine and Static Ads Recreator with inputs prefilled, and surfaces the resulting rewritten script / recreated image back on each card.

**Architecture:** A thin orchestration layer over existing features. One new table `ad_pipeline_cards` snapshots the `CreativeBrief`. Background enrichment reuses `transcribeAudio()` (fal/whisper) and `runDeconstruction()`. Recreation is unchanged — we deep-link into Copy Engine / Static Ads via URL params and thread a `pipelineCardId` into the generation log and saved brand assets so each card can resolve its output (prefers the saved asset, falls back to the latest generation). A card only reaches **Ready** when a brand asset is saved for it.

**Tech Stack:** TypeScript, Express, Drizzle ORM (Postgres), React + Wouter, Vitest (colocated `*.test.ts`, pure-logic unit tests), Tailwind. Spec: `docs/superpowers/specs/2026-06-18-ad-pipeline-design.md`.

---

## Conventions for this plan

- **Run a single test file:** `pnpm exec vitest run server/lib/<file>.test.ts`
- **Typecheck (used as the verification gate for DB/route/UI tasks, mirroring the repo, which has no DB/route/UI tests):** `pnpm exec tsc --noEmit`
- **Migrations:** `pnpm db:generate` then `pnpm db:migrate`
- **Server route imports use the `.js` extension** (ESM/NodeNext) even though files are `.ts` — follow the existing files exactly.
- Stage values are the strings `"idea" | "in_production" | "ready"` everywhere.

## File Structure

**Create:**
- `server/lib/adPipeline.ts` — pure helpers (`resolveCardOutput`, `canEnterReady`, `briefToCardFields`, `pickVideoUrl`) + DB store functions (`createCardFromFeedItem`, `listCardsWithOutputs`, `getCardWithOutput`, `updateCardStage`, `advanceCardOnAssetSaved`).
- `server/lib/adPipeline.test.ts` — unit tests for the pure helpers.
- `server/lib/adPipelineEnrich.ts` — in-memory background-job runner (transcribe / create-ref + deconstruct) mirroring `adConsolePull.ts`.
- `server/lib/adPipelineEnrich.test.ts` — unit test for `enrichmentPlan`.
- `server/routes/adPipeline.ts` — REST routes (`/api/ad-pipeline`).
- `client/src/pages/workspace/AdPipelineKanbanAppPage.tsx` — the Kanban UI.

**Modify:**
- `server/db/schema.ts` — add `adPipelineCards` table + inferred types.
- `server/index.ts` — mount the new router.
- `server/routes/generate.ts` — accept optional `meta.pipelineCardId`, log it into `inputs` (no prompt change).
- `server/routes/staticAds.ts` — accept `pipelineCardId` in the recreate body, log it into `inputs`.
- `server/routes/brandAssets.ts` — when a saved asset carries `metadata.pipelineCardId`, advance that card to `ready`.
- `client/src/lib/api.ts` — types + wrappers for ad-pipeline; extend `generateText` to pass `meta`.
- `client/src/pages/workspace/AdConsolePage.tsx` — "Add to pipeline" vs "Recreate now" + product/angle picker + deep-link.
- `client/src/pages/workspace/CopyEngineAppPage.tsx` — URL-param prefill + stamp `pipelineCardId`.
- `client/src/pages/workspace/StaticAdsAppPage.tsx` — URL-param prefill + stamp `pipelineCardId`.
- `client/src/App.tsx` — route for the Kanban page.
- `client/src/components/WorkspaceLayout.tsx` — gated nav entry.

---

## Task 1: Add the `ad_pipeline_cards` table

**Files:**
- Modify: `server/db/schema.ts` (add table near the other ad-console tables, after `feedEvents` ~line 746; add inferred types in the type-export block)

- [ ] **Step 1: Add the table definition**

In `server/db/schema.ts`, after the `feedEvents` table definition (~line 746), add:

```ts
/**
 * Ad Pipeline — durable Kanban card. Snapshots the CreativeBrief on "Make it
 * mine" so the card survives feed re-ranking (feed_items are ephemeral). Outputs
 * are NOT stored here: they live in `generations` (live draft, tagged with
 * pipelineCardId in inputs) and `brand_assets` (curated keeper, tagged in
 * metadata). A card reaches `ready` only once a brand asset is saved for it.
 */
export const adPipelineCards = pgTable("ad_pipeline_cards", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  brandId: uuid("brand_id").notNull(),
  stage: text("stage").notNull().default("idea"), // "idea" | "in_production" | "ready"
  sourceType: text("source_type").notNull(), // "ad" | "organic"
  format: text("format").notNull(), // "video" | "static"
  brief: jsonb("brief").notNull(), // full CreativeBrief snapshot
  sourceUrl: text("source_url"), // original reference (the card's link)
  originalScript: text("original_script"), // transcript (from brief, or filled by enrichment)
  referenceImageUrl: text("reference_image_url"), // static: creative image to recreate from
  staticReferenceId: uuid("static_reference_id"), // static: the created static_ad_reference
  productId: uuid("product_id"), // chosen at recreate time (null while in Idea)
  angleName: text("angle_name"), // chosen at recreate time
  language: text("language").default("en"),
  bgJobStatus: text("bg_job_status").notNull().default("pending"), // pending|running|complete|failed
  bgJobError: text("bg_job_error"),
});
```

- [ ] **Step 2: Add inferred types**

In the type-export block (next to `export type Generation = ...` ~line 216), add:

```ts
export type AdPipelineCard = typeof adPipelineCards.$inferSelect;
export type NewAdPipelineCard = typeof adPipelineCards.$inferInsert;
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new SQL file appears under `drizzle/` containing `CREATE TABLE "ad_pipeline_cards"`.

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Expected: migration runs without error; `ad_pipeline_cards` exists.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/db/schema.ts drizzle/
git commit -m "feat(ad-pipeline): add ad_pipeline_cards table"
```

---

## Task 2: Pure helpers — output resolution, ready gate, brief mapping

**Files:**
- Create: `server/lib/adPipeline.ts`
- Test: `server/lib/adPipeline.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/lib/adPipeline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveCardOutput, canEnterReady, pickVideoUrl } from "./adPipeline.js";

describe("resolveCardOutput", () => {
  it("prefers the saved asset over a generation (text/video card)", () => {
    const out = resolveCardOutput(
      "video",
      { id: "a1", url: "document:rewrite", metadata: { content: "REWRITTEN" }, createdAt: "2026-06-18T00:00:00Z" },
      { output: { text: "DRAFT" }, createdAt: "2026-06-17T00:00:00Z" },
    );
    expect(out).toEqual({
      source: "asset", kind: "text", text: "REWRITTEN", imageUrl: null,
      savedAssetId: "a1", generatedAt: "2026-06-18T00:00:00Z",
    });
  });

  it("falls back to the latest generation when no asset is saved (text)", () => {
    const out = resolveCardOutput("video", null, { output: { text: "DRAFT" }, createdAt: "2026-06-17T00:00:00Z" });
    expect(out).toEqual({
      source: "generation", kind: "text", text: "DRAFT", imageUrl: null,
      savedAssetId: null, generatedAt: "2026-06-17T00:00:00Z",
    });
  });

  it("reads the image url for a static card from a saved asset", () => {
    const out = resolveCardOutput(
      "static",
      { id: "a2", url: "https://cdn/out.png", metadata: {}, createdAt: "2026-06-18T00:00:00Z" },
      null,
    );
    expect(out).toEqual({
      source: "asset", kind: "image", text: null, imageUrl: "https://cdn/out.png",
      savedAssetId: "a2", generatedAt: "2026-06-18T00:00:00Z",
    });
  });

  it("reads the image url for a static card from a generation output", () => {
    const out = resolveCardOutput("static", null, { output: { url: "https://cdn/g.png" }, createdAt: "2026-06-17T00:00:00Z" });
    expect(out?.imageUrl).toBe("https://cdn/g.png");
    expect(out?.source).toBe("generation");
  });

  it("returns null when there is no asset and no generation", () => {
    expect(resolveCardOutput("video", null, null)).toBeNull();
  });
});

describe("canEnterReady", () => {
  it("requires a saved brand asset", () => {
    expect(canEnterReady(true)).toBe(true);
    expect(canEnterReady(false)).toBe(false);
  });
});

describe("pickVideoUrl", () => {
  it("picks the first video-extension url", () => {
    expect(pickVideoUrl(["https://x/cover.jpg", "https://x/clip.mp4"])).toBe("https://x/clip.mp4");
  });
  it("falls back to the first url when none look like video", () => {
    expect(pickVideoUrl(["https://x/a", "https://x/b"])).toBe("https://x/a");
  });
  it("returns null for an empty list", () => {
    expect(pickVideoUrl([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run server/lib/adPipeline.test.ts`
Expected: FAIL — `Cannot find module './adPipeline.js'`.

- [ ] **Step 3: Implement the pure helpers**

Create `server/lib/adPipeline.ts` with ONLY the pure helpers for now (DB functions are added in Task 5):

```ts
/**
 * Ad Pipeline — card model helpers + DB store.
 *
 * A card snapshots the CreativeBrief on "Make it mine". Outputs are resolved at
 * read time from `brand_assets` (curated keeper, preferred) falling back to the
 * latest `generations` row (live draft). Both are tagged with `pipelineCardId`.
 */
import type { AdConsoleCreativeBriefLike } from "./adPipelineTypes.js";

export type CardOutput = {
  source: "asset" | "generation";
  kind: "text" | "image";
  text: string | null;
  imageUrl: string | null;
  savedAssetId: string | null;
  generatedAt: string;
};

type SavedAsset = { id: string; url: string; metadata: unknown; createdAt: string };
type LatestGen = { output: unknown; createdAt: string };

/** Resolve the output shown on a card: saved asset wins, else latest generation. */
export function resolveCardOutput(
  format: "video" | "static" | string,
  savedAsset: SavedAsset | null,
  latestGeneration: LatestGen | null,
): CardOutput | null {
  const kind: "text" | "image" = format === "static" ? "image" : "text";
  if (savedAsset) {
    const meta = (savedAsset.metadata ?? {}) as { content?: string };
    return {
      source: "asset",
      kind,
      text: kind === "text" ? meta.content ?? null : null,
      imageUrl: kind === "image" ? savedAsset.url : null,
      savedAssetId: savedAsset.id,
      generatedAt: savedAsset.createdAt,
    };
  }
  if (latestGeneration) {
    const out = (latestGeneration.output ?? {}) as { text?: string; url?: string };
    return {
      source: "generation",
      kind,
      text: kind === "text" ? out.text ?? null : null,
      imageUrl: kind === "image" ? out.url ?? null : null,
      savedAssetId: null,
      generatedAt: latestGeneration.createdAt,
    };
  }
  return null;
}

/** A card may enter `ready` only once a brand asset has been saved for it. */
export function canEnterReady(hasSavedAsset: boolean): boolean {
  return hasSavedAsset;
}

const VIDEO_EXT = /\.(mp4|mov|m3u8|webm|m4v)(\?|$)/i;

/** Pick the most likely video URL from a brief's referenceMediaUrls. */
export function pickVideoUrl(urls: string[]): string | null {
  if (!urls.length) return null;
  return urls.find((u) => VIDEO_EXT.test(u)) ?? urls[0];
}
```

Also create a tiny shared-types file `server/lib/adPipelineTypes.ts` so the brief type isn't duplicated:

```ts
/** The fields of a CreativeBrief that the pipeline reads. Mirrors adConsoleBrief.ts. */
export type AdConsoleCreativeBriefLike = {
  feedItemId: string;
  sourceType: "ad" | "organic";
  format: string;
  referenceMediaUrls: string[];
  thumbnailUrl: string | null;
  transcript: string | null;
  sourceCopy: string | null;
  sourceUrl: string | null;
  niche: string | null;
  advertiserName: string | null;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run server/lib/adPipeline.test.ts`
Expected: PASS (all 9 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/lib/adPipeline.ts server/lib/adPipelineTypes.ts server/lib/adPipeline.test.ts
git commit -m "feat(ad-pipeline): pure card-output + ready-gate helpers"
```

---

## Task 3: Enrichment plan helper

Decides what background work a card needs the moment it's created.

**Files:**
- Create: `server/lib/adPipelineEnrich.test.ts`
- Create (partial): `server/lib/adPipelineEnrich.ts` (only `enrichmentPlan` for now)

- [ ] **Step 1: Write the failing test**

Create `server/lib/adPipelineEnrich.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { enrichmentPlan } from "./adPipelineEnrich.js";

describe("enrichmentPlan", () => {
  it("uses an existing transcript for a video card without transcribing", () => {
    const plan = enrichmentPlan({
      format: "video", transcript: "already here", referenceMediaUrls: ["https://x/clip.mp4"],
    });
    expect(plan).toEqual({ kind: "use_existing_transcript", transcript: "already here" });
  });

  it("transcribes a video card that has no transcript", () => {
    const plan = enrichmentPlan({
      format: "video", transcript: null, referenceMediaUrls: ["https://x/cover.jpg", "https://x/clip.mp4"],
    });
    expect(plan).toEqual({ kind: "transcribe", audioUrl: "https://x/clip.mp4" });
  });

  it("deconstructs a static card from its first media url", () => {
    const plan = enrichmentPlan({
      format: "static", transcript: null, referenceMediaUrls: ["https://x/ad.png"],
    });
    expect(plan).toEqual({ kind: "deconstruct", imageUrl: "https://x/ad.png" });
  });

  it("returns a noop when a video card has neither transcript nor media", () => {
    expect(enrichmentPlan({ format: "video", transcript: null, referenceMediaUrls: [] }))
      .toEqual({ kind: "noop" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run server/lib/adPipelineEnrich.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `enrichmentPlan`**

Create `server/lib/adPipelineEnrich.ts` (the runner is added in Task 4 — for now just the pure planner and its imports):

```ts
/**
 * Ad Pipeline background enrichment. On card creation we either transcribe the
 * video (reusing fal/whisper) or create a static_ad_reference + deconstruct it
 * (reusing runDeconstruction). Run state is kept in-memory per card, mirroring
 * adConsolePull.ts — transient progress for a single-instance tool.
 */
import { pickVideoUrl } from "./adPipeline.js";

export type EnrichmentPlan =
  | { kind: "use_existing_transcript"; transcript: string }
  | { kind: "transcribe"; audioUrl: string }
  | { kind: "deconstruct"; imageUrl: string }
  | { kind: "noop" };

/** Decide what enrichment a freshly-created card needs (pure). */
export function enrichmentPlan(card: {
  format: string;
  transcript: string | null;
  referenceMediaUrls: string[];
}): EnrichmentPlan {
  if (card.format === "static") {
    const imageUrl = card.referenceMediaUrls[0];
    return imageUrl ? { kind: "deconstruct", imageUrl } : { kind: "noop" };
  }
  // video / organic
  if (card.transcript && card.transcript.trim()) {
    return { kind: "use_existing_transcript", transcript: card.transcript.trim() };
  }
  const audioUrl = pickVideoUrl(card.referenceMediaUrls);
  return audioUrl ? { kind: "transcribe", audioUrl } : { kind: "noop" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run server/lib/adPipelineEnrich.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/lib/adPipelineEnrich.ts server/lib/adPipelineEnrich.test.ts
git commit -m "feat(ad-pipeline): enrichment planner"
```

---

## Task 4: Enrichment runner (in-memory jobs)

**Files:**
- Modify: `server/lib/adPipelineEnrich.ts` (add the runner below `enrichmentPlan`)

- [ ] **Step 1: Add the runner**

Append to `server/lib/adPipelineEnrich.ts`:

```ts
import { db, schema } from "./db.js";
import { eq } from "drizzle-orm";
import { transcribeAudio } from "./fal.js";
import { runDeconstruction } from "../routes/staticAdReferences.js";

export type EnrichJobStatus = "pending" | "running" | "complete" | "failed";

type EnrichJob = { cardId: string; status: EnrichJobStatus; error: string | null };
const jobs = new Map<string, EnrichJob>();

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Current enrichment job snapshot for a card (null if none ran this process). */
export function getEnrichJob(cardId: string): EnrichJob | null {
  return jobs.get(cardId) ?? null;
}

/**
 * Fire-and-forget enrichment for a card. Reads the card, runs the planned work,
 * and writes the result (originalScript / staticReferenceId) + bgJobStatus back
 * onto the card row. Safe to call once per card creation.
 */
export function startEnrichment(cardId: string): void {
  const existing = jobs.get(cardId);
  if (existing && existing.status === "running") return;
  const job: EnrichJob = { cardId, status: "running", error: null };
  jobs.set(cardId, job);
  void runEnrichment(job).catch((err) => {
    job.status = "failed";
    job.error = msg(err);
  });
}

async function setCard(cardId: string, patch: Partial<typeof schema.adPipelineCards.$inferInsert>): Promise<void> {
  await db
    .update(schema.adPipelineCards)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.adPipelineCards.id, cardId));
}

async function runEnrichment(job: EnrichJob): Promise<void> {
  const { cardId } = job;
  await setCard(cardId, { bgJobStatus: "running", bgJobError: null });

  const [card] = await db
    .select()
    .from(schema.adPipelineCards)
    .where(eq(schema.adPipelineCards.id, cardId))
    .limit(1);
  if (!card) {
    job.status = "failed";
    job.error = "card not found";
    return;
  }

  const brief = (card.brief ?? {}) as { referenceMediaUrls?: string[]; transcript?: string | null; niche?: string | null };
  const plan = enrichmentPlan({
    format: card.format,
    transcript: brief.transcript ?? card.originalScript ?? null,
    referenceMediaUrls: brief.referenceMediaUrls ?? [],
  });

  try {
    if (plan.kind === "use_existing_transcript") {
      await setCard(cardId, { originalScript: plan.transcript, bgJobStatus: "complete" });
    } else if (plan.kind === "transcribe") {
      const t = await transcribeAudio({ audioUrl: plan.audioUrl });
      await setCard(cardId, { originalScript: t.text || null, bgJobStatus: "complete" });
    } else if (plan.kind === "deconstruct") {
      const [ref] = await db
        .insert(schema.staticAdReferences)
        .values({
          title: `${brief.niche ?? "ad"} — pipeline ${cardId.slice(0, 8)}`,
          niche: brief.niche || "other",
          imageUrl: plan.imageUrl,
          deconstructionStatus: "pending",
        })
        .returning();
      if (!ref) throw new Error("failed to create static_ad_reference");
      await setCard(cardId, { staticReferenceId: ref.id });
      // Await so the card's bgJobStatus reflects deconstruction completion.
      await runDeconstruction(ref.id);
      await setCard(cardId, { bgJobStatus: "complete" });
    } else {
      // noop — nothing to enrich (e.g. video with no media). Mark complete so the
      // card isn't stuck "pending"; it remains usable with whatever copy exists.
      await setCard(cardId, { bgJobStatus: "complete" });
    }
    job.status = "complete";
  } catch (err) {
    // Non-fatal: card stays usable (whisper/vision failure shouldn't block recreation).
    job.status = "failed";
    job.error = msg(err);
    await setCard(cardId, { bgJobStatus: "failed", bgJobError: msg(err) });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (If `runDeconstruction` is not exported from `staticAdReferences.ts`, confirm the export at `server/routes/staticAdReferences.ts:370` — it is exported in the current code.)

- [ ] **Step 3: Re-run the planner test (guard against regressions)**

Run: `pnpm exec vitest run server/lib/adPipelineEnrich.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/lib/adPipelineEnrich.ts
git commit -m "feat(ad-pipeline): in-memory enrichment runner (transcribe / deconstruct)"
```

---

## Task 5: Card store (DB functions)

**Files:**
- Modify: `server/lib/adPipeline.ts` (append store functions below the pure helpers)

- [ ] **Step 1: Append the store functions**

Add to the bottom of `server/lib/adPipeline.ts`:

```ts
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "./db.js";
import { selectFeedItem } from "./adConsoleBrief.js";
import { startEnrichment } from "./adPipelineEnrich.js";
import type { AdPipelineCard } from "../db/schema.js";

export type AdPipelineStage = "idea" | "in_production" | "ready";

export type AdPipelineCardWithOutput = AdPipelineCard & { output: CardOutput | null };

/**
 * "Make it mine": flip the feed item to selected (existing selectFeedItem), then
 * snapshot the brief into a new card. `mode: "recreate"` lands the card directly
 * in In Production with the chosen product/angle; `mode: "idea"` lands it in
 * Idea. Kicks off background enrichment. Returns null if the feed item is gone.
 */
export async function createCardFromFeedItem(args: {
  brandId: string;
  feedItemId: string;
  mode: "idea" | "recreate";
  productId?: string | null;
  angleName?: string | null;
  language?: string | null;
  userId: string | null;
}): Promise<AdPipelineCard | null> {
  const selected = await selectFeedItem(args.brandId, args.feedItemId, args.userId);
  if (!selected) return null;
  const brief = selected.brief;

  const [card] = await db
    .insert(schema.adPipelineCards)
    .values({
      brandId: args.brandId,
      stage: args.mode === "recreate" ? "in_production" : "idea",
      sourceType: brief.sourceType,
      format: brief.format,
      brief,
      sourceUrl: brief.sourceUrl ?? null,
      originalScript: brief.transcript ?? null,
      referenceImageUrl: brief.format === "static" ? brief.referenceMediaUrls[0] ?? brief.thumbnailUrl ?? null : null,
      productId: args.productId ?? null,
      angleName: args.angleName ?? null,
      language: args.language ?? "en",
      bgJobStatus: "pending",
    })
    .returning();
  if (!card) return null;

  startEnrichment(card.id);
  return card;
}

/** Latest saved brand asset tagged with this card id (or null). */
async function latestSavedAsset(cardId: string): Promise<SavedAsset | null> {
  const [row] = await db
    .select({
      id: schema.brandAssets.id,
      url: schema.brandAssets.url,
      metadata: schema.brandAssets.metadata,
      createdAt: schema.brandAssets.createdAt,
    })
    .from(schema.brandAssets)
    .where(sql`${schema.brandAssets.metadata}->>'pipelineCardId' = ${cardId}`)
    .orderBy(desc(schema.brandAssets.createdAt))
    .limit(1);
  return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
}

/** Latest rewrite/recreate generation tagged with this card id (or null). */
async function latestGeneration(cardId: string): Promise<LatestGen | null> {
  const [row] = await db
    .select({ output: schema.generations.output, createdAt: schema.generations.createdAt })
    .from(schema.generations)
    .where(sql`${schema.generations.inputs}->>'pipelineCardId' = ${cardId}`)
    .orderBy(desc(schema.generations.createdAt))
    .limit(1);
  return row ? { output: row.output, createdAt: row.createdAt.toISOString() } : null;
}

async function withOutput(card: AdPipelineCard): Promise<AdPipelineCardWithOutput> {
  const [asset, gen] = await Promise.all([latestSavedAsset(card.id), latestGeneration(card.id)]);
  return { ...card, output: resolveCardOutput(card.format, asset, gen) };
}

/** All cards for a brand, newest-updated first, each with its resolved output. */
export async function listCardsWithOutputs(brandId: string): Promise<AdPipelineCardWithOutput[]> {
  const cards = await db
    .select()
    .from(schema.adPipelineCards)
    .where(eq(schema.adPipelineCards.brandId, brandId))
    .orderBy(desc(schema.adPipelineCards.updatedAt));
  return Promise.all(cards.map(withOutput));
}

/** One card with its resolved output (or null if not found / wrong brand). */
export async function getCardWithOutput(brandId: string, cardId: string): Promise<AdPipelineCardWithOutput | null> {
  const [card] = await db
    .select()
    .from(schema.adPipelineCards)
    .where(and(eq(schema.adPipelineCards.id, cardId), eq(schema.adPipelineCards.brandId, brandId)))
    .limit(1);
  return card ? withOutput(card) : null;
}

/** Update mutable fields (stage drag, recreate launch sets product/angle). */
export async function updateCard(
  brandId: string,
  cardId: string,
  patch: { stage?: AdPipelineStage; productId?: string | null; angleName?: string | null; language?: string | null },
): Promise<AdPipelineCard | null> {
  const [card] = await db
    .update(schema.adPipelineCards)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.adPipelineCards.id, cardId), eq(schema.adPipelineCards.brandId, brandId)))
    .returning();
  return card ?? null;
}

/**
 * Auto-advance a card to `ready` when a brand asset is saved for it — unless it's
 * been manually dragged elsewhere already at `ready`. Idempotent. Called from the
 * brand-assets save route.
 */
export async function advanceCardOnAssetSaved(cardId: string): Promise<void> {
  await db
    .update(schema.adPipelineCards)
    .set({ stage: "ready", updatedAt: new Date() })
    .where(eq(schema.adPipelineCards.id, cardId));
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Re-run the pure-helper tests (no regressions)**

Run: `pnpm exec vitest run server/lib/adPipeline.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/lib/adPipeline.ts
git commit -m "feat(ad-pipeline): card store (create/list/get/update/advance)"
```

---

## Task 6: REST routes + mount

**Files:**
- Create: `server/routes/adPipeline.ts`
- Modify: `server/index.ts` (import + `app.use`)

- [ ] **Step 1: Create the router**

Create `server/routes/adPipeline.ts` (mirrors `adConsole.ts` auth + error style):

```ts
/**
 * Ad Pipeline routes (managers + admins).
 *
 *   GET  /api/ad-pipeline/brands/:brandId/cards                — list cards + outputs
 *   POST /api/ad-pipeline/brands/:brandId/cards               — create from a feed item
 *   GET  /api/ad-pipeline/cards/:cardId                       — one card + output
 *   PUT  /api/ad-pipeline/cards/:cardId                       — update stage / product / angle
 *   GET  /api/ad-pipeline/cards/:cardId/job-status           — enrichment job snapshot
 */
import { type Request, type Response, Router } from "express";
import { requireAuth, requireManager } from "../lib/authMiddleware.js";
import {
  createCardFromFeedItem,
  getCardWithOutput,
  listCardsWithOutputs,
  updateCard,
  type AdPipelineStage,
} from "../lib/adPipeline.js";
import { getEnrichJob } from "../lib/adPipelineEnrich.js";

export const adPipelineRouter: Router = Router();

adPipelineRouter.use(requireAuth, requireManager);

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

adPipelineRouter.get("/brands/:brandId/cards", async (req: Request, res: Response) => {
  try {
    const cards = await listCardsWithOutputs(req.params.brandId);
    res.json({ cards });
  } catch (err) {
    console.error("[ad-pipeline] list cards failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

adPipelineRouter.post("/brands/:brandId/cards", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      feedItemId?: string;
      mode?: "idea" | "recreate";
      productId?: string | null;
      angleName?: string | null;
      language?: string | null;
    };
    if (!body.feedItemId) return sendError(res, 400, "feedItemId is required");
    const mode = body.mode === "recreate" ? "recreate" : "idea";
    const card = await createCardFromFeedItem({
      brandId: req.params.brandId,
      feedItemId: body.feedItemId,
      mode,
      productId: body.productId ?? null,
      angleName: body.angleName ?? null,
      language: body.language ?? null,
      userId: req.auth?.user.id ?? null,
    });
    if (!card) return sendError(res, 404, "Feed item not found");
    res.status(201).json({ card });
  } catch (err) {
    console.error("[ad-pipeline] create card failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

adPipelineRouter.get("/cards/:cardId", async (req: Request, res: Response) => {
  try {
    const brandId = String(req.query.brandId ?? "");
    if (!brandId) return sendError(res, 400, "brandId query param is required");
    const card = await getCardWithOutput(brandId, req.params.cardId);
    if (!card) return sendError(res, 404, "Card not found");
    res.json({ card });
  } catch (err) {
    console.error("[ad-pipeline] get card failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

adPipelineRouter.put("/cards/:cardId", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      brandId?: string;
      stage?: AdPipelineStage;
      productId?: string | null;
      angleName?: string | null;
      language?: string | null;
    };
    if (!body.brandId) return sendError(res, 400, "brandId is required");
    const card = await updateCard(body.brandId, req.params.cardId, {
      stage: body.stage,
      productId: body.productId,
      angleName: body.angleName,
      language: body.language,
    });
    if (!card) return sendError(res, 404, "Card not found");
    res.json({ card });
  } catch (err) {
    console.error("[ad-pipeline] update card failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

adPipelineRouter.get("/cards/:cardId/job-status", async (req: Request, res: Response) => {
  try {
    res.json({ job: getEnrichJob(req.params.cardId) });
  } catch (err) {
    console.error("[ad-pipeline] job status failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});
```

> Note: confirm the exact import path/names for `requireAuth, requireManager` — `adConsole.ts:50` imports them; copy that import line verbatim if `../lib/authMiddleware.js` differs.

- [ ] **Step 2: Mount the router in `server/index.ts`**

Add the import next to the other route imports (~line 30):

```ts
import { adPipelineRouter } from "./routes/adPipeline.js";
```

Add the mount next to `app.use("/api/ad-console", adConsoleRouter);` (~line 135):

```ts
  app.use("/api/ad-pipeline", adPipelineRouter);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. Fix the auth-middleware import path if tsc reports it missing (match `adConsole.ts`).

- [ ] **Step 4: Manual smoke test**

Run the dev server: `pnpm dev`. With an authenticated manager session and a DFY brand that has feed items, in the browser devtools console:

```js
await fetch(`/api/ad-pipeline/brands/${BRAND_ID}/cards`).then(r => r.json())
```

Expected: `{ cards: [] }` (empty before any card is created), HTTP 200. A 401 means auth middleware mounted correctly but you're not logged in as a manager.

- [ ] **Step 5: Commit**

```bash
git add server/routes/adPipeline.ts server/index.ts
git commit -m "feat(ad-pipeline): REST routes + mount"
```

---

## Task 7: Thread `pipelineCardId` through the text-generate log (no prompt change)

**Files:**
- Modify: `server/routes/generate.ts:57-110` (the `/text/:action` handler)

- [ ] **Step 1: Accept and log `meta.pipelineCardId`**

In `server/routes/generate.ts`, change the body parse + persist in the `/text/:action` handler. Replace:

```ts
  const body = (req.body ?? {}) as { vars?: Record<string, unknown>; model?: string; maxTokens?: number };
  const vars = body.vars ?? {};
```

with:

```ts
  const body = (req.body ?? {}) as {
    vars?: Record<string, unknown>;
    model?: string;
    maxTokens?: number;
    meta?: { pipelineCardId?: string };
  };
  const vars = body.vars ?? {};
  // pipelineCardId is logged into generations.inputs (top-level) so an Ad
  // Pipeline card can resolve its latest draft — but it is NOT passed to the
  // prompt template (kept out of `vars`), so it never pollutes the rendered prompt.
  const loggedInputs = body.meta?.pipelineCardId
    ? { ...vars, pipelineCardId: body.meta.pipelineCardId }
    : vars;
```

Then in the success `persist({ ... })` call, change `inputs: vars,` to `inputs: loggedInputs,`. Leave the error-path `persist({ ..., inputs: vars, ... })` as-is (a failed draft needs no card linkage).

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify the prompt is unaffected**

Confirm `loadPrompt(action, vars)` is still called with `vars` (not `loggedInputs`) and `userMessage` still serializes `vars`. The rendered prompt must not contain `pipelineCardId`.

- [ ] **Step 4: Commit**

```bash
git add server/routes/generate.ts
git commit -m "feat(ad-pipeline): log pipelineCardId into text-generation inputs"
```

---

## Task 8: Thread `pipelineCardId` through the static recreate log

**Files:**
- Modify: `server/routes/staticAds.ts` (`RecreateBody` ~line 57; the recreate `inputs` object ~line 529)

- [ ] **Step 1: Add `pipelineCardId` to `RecreateBody`**

In the `RecreateBody` type (~line 57), add:

```ts
  pipelineCardId?: string;
```

- [ ] **Step 2: Log it into the recreate generation `inputs`**

In the `db.insert(schema.generations).values({ ... inputs: { ... } })` block (~line 529), add a line inside the `inputs` object:

```ts
        pipelineCardId: body.pipelineCardId ?? null,
```

(Add it to the feedback-edit `inputs` block ~line 576 too, for symmetry.)

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/routes/staticAds.ts
git commit -m "feat(ad-pipeline): log pipelineCardId into static-recreate inputs"
```

---

## Task 9: Auto-advance the card to Ready when an asset is saved

**Files:**
- Modify: `server/routes/brandAssets.ts` (the POST `/` save handler ~line 108-150)

- [ ] **Step 1: Call `advanceCardOnAssetSaved` for tagged assets**

In `server/routes/brandAssets.ts`, import the helper at the top:

```ts
import { advanceCardOnAssetSaved } from "../lib/adPipeline.js";
```

In the POST handler, after the assets are inserted and before the response is sent, add:

```ts
  // Ad Pipeline linkage: any saved asset tagged with a pipelineCardId advances
  // its card to "ready" (a card needs a saved asset, not just a generation).
  for (const asset of inserted) {
    const cardId = (asset.metadata as { pipelineCardId?: string } | null)?.pipelineCardId;
    if (cardId) await advanceCardOnAssetSaved(cardId);
  }
```

> Adjust `inserted` to the actual variable name holding the inserted rows in that handler (read the file; it returns the created assets). If the handler returns `assets`, iterate that.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/routes/brandAssets.ts
git commit -m "feat(ad-pipeline): advance card to ready when a tagged asset is saved"
```

---

## Task 10: Client API — types + wrappers

**Files:**
- Modify: `client/src/lib/api.ts` (extend `generateText`; add an Ad Pipeline section near the ad-console wrappers)

- [ ] **Step 1: Extend `generateText` to pass `meta`**

Replace the `generateText` function (~line 64-70) with:

```ts
export function generateText(
  action: string,
  vars: Record<string, unknown> = {},
  opts: { model?: string; maxTokens?: number; meta?: { pipelineCardId?: string } } = {},
): Promise<TextGenResponse> {
  return post<TextGenResponse>(`/api/generate/text/${action}`, { vars, ...opts });
}
```

- [ ] **Step 2: Add Ad Pipeline types + wrappers**

At the end of `client/src/lib/api.ts`, add:

```ts
// ---------- Ad Pipeline ----------

export type AdPipelineStage = "idea" | "in_production" | "ready";

export type AdPipelineCardOutput = {
  source: "asset" | "generation";
  kind: "text" | "image";
  text: string | null;
  imageUrl: string | null;
  savedAssetId: string | null;
  generatedAt: string;
};

export type AdPipelineCard = {
  id: string;
  createdAt: string;
  updatedAt: string;
  brandId: string;
  stage: AdPipelineStage;
  sourceType: "ad" | "organic";
  format: "video" | "static" | string;
  brief: AdConsoleCreativeBrief;
  sourceUrl: string | null;
  originalScript: string | null;
  referenceImageUrl: string | null;
  staticReferenceId: string | null;
  productId: string | null;
  angleName: string | null;
  language: string | null;
  bgJobStatus: "pending" | "running" | "complete" | "failed";
  bgJobError: string | null;
  output: AdPipelineCardOutput | null;
};

const AD_PIPELINE = "/api/ad-pipeline";

export function listAdPipelineCards(brandId: string): Promise<{ cards: AdPipelineCard[] }> {
  return get<{ cards: AdPipelineCard[] }>(`${AD_PIPELINE}/brands/${brandId}/cards`);
}

export function getAdPipelineCard(brandId: string, cardId: string): Promise<{ card: AdPipelineCard }> {
  return get<{ card: AdPipelineCard }>(`${AD_PIPELINE}/cards/${cardId}?brandId=${encodeURIComponent(brandId)}`);
}

export function createAdPipelineCard(
  brandId: string,
  args: { feedItemId: string; mode: "idea" | "recreate"; productId?: string | null; angleName?: string | null; language?: string | null },
): Promise<{ card: AdPipelineCard }> {
  return post<{ card: AdPipelineCard }>(`${AD_PIPELINE}/brands/${brandId}/cards`, args);
}

export function updateAdPipelineCard(
  brandId: string,
  cardId: string,
  patch: { stage?: AdPipelineStage; productId?: string | null; angleName?: string | null; language?: string | null },
): Promise<{ card: AdPipelineCard }> {
  return put<{ card: AdPipelineCard }>(`${AD_PIPELINE}/cards/${cardId}`, { brandId, ...patch });
}

export type AdPipelineJob = { cardId: string; status: "pending" | "running" | "complete" | "failed"; error: string | null };

export function getAdPipelineCardJobStatus(cardId: string): Promise<{ job: AdPipelineJob | null }> {
  return get<{ job: AdPipelineJob | null }>(`${AD_PIPELINE}/cards/${cardId}/job-status`);
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (`AdConsoleCreativeBrief` and `put` are already defined earlier in the file.)

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat(ad-pipeline): client api types + wrappers"
```

---

## Task 11: Ad Console — "Add to pipeline" vs "Recreate now" + deep-link

**Files:**
- Modify: `client/src/pages/workspace/AdConsolePage.tsx` (the `handleMakeItMine` flow + `BriefModal`)

The current flow: `handleMakeItMine` (line 394) calls `selectAdConsoleFeedItem` and shows `BriefModal` (line 1328), which has an "open app" button (line 1432) calling `onOpenApp(app.path)` (navigates to a bare app path). We change this so "Make it mine" creates a pipeline card, and the modal offers two explicit choices, with "Recreate now" collecting product+angle and deep-linking with params.

- [ ] **Step 1: Import the new API + product loading**

Add to the imports from `../lib/api` in `AdConsolePage.tsx`:

```ts
  createAdPipelineCard, listProducts, type Product,
```

Add product state near the other `useState` hooks in the page component (~line 157):

```ts
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    if (!activeBrandId) return;
    listProducts(activeBrandId).then(({ products }) => setProducts(products)).catch(() => setProducts([]));
  }, [activeBrandId]);
```

- [ ] **Step 2: Replace `handleMakeItMine` to keep the brief but not auto-route**

Replace the body of `handleMakeItMine` (line 394-406) with:

```ts
  async function handleMakeItMine(card: AdConsoleFeedCard) {
    if (!activeBrandId || actioningId) return;
    setActioningId(card.item.id);
    try {
      const { brief: b } = await selectAdConsoleFeedItem(activeBrandId, card.item.id);
      setFeedCards((prev) => prev.filter((c) => c.item.id !== card.item.id));
      setBrief(b); // BriefModal now drives the two-choice flow (add-to-pipeline / recreate-now)
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setActioningId(null);
    }
  }
```

(Unchanged from current — the new behavior lives in the modal.)

- [ ] **Step 3: Rewrite `BriefModal` to offer the two choices**

Replace the `BriefModal` component's footer action (the single button at line ~1432) and signature so it supports the two flows. Change the component props and the action region:

```tsx
function BriefModal({
  brief,
  products,
  brandId,
  onClose,
  flash,
}: {
  brief: AdConsoleCreativeBrief;
  products: Product[];
  brandId: string;
  onClose: () => void;
  flash: (m: { kind: "error" | "success"; text: string }) => void;
}) {
  const [, navigate] = useLocation();
  const isStatic = brief.sourceType === "ad" && brief.format === "static";
  const [recreateOpen, setRecreateOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [angleName, setAngleName] = useState("");
  const [busy, setBusy] = useState(false);

  const researched = products.filter((p) => p.researchStatus === "complete" && p.research?.markdown);
  const angles = researched.find((p) => p.id === productId)?.research?.angles ?? [];

  async function addToPipeline() {
    setBusy(true);
    try {
      await createAdPipelineCard(brandId, { feedItemId: brief.feedItemId, mode: "idea" });
      flash({ kind: "success", text: "Added to Ad Pipeline." });
      onClose();
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function recreateNow() {
    if (!productId || !angleName) return;
    setBusy(true);
    try {
      const { card } = await createAdPipelineCard(brandId, {
        feedItemId: brief.feedItemId, mode: "recreate", productId, angleName, language: "en",
      });
      if (isStatic) {
        // Static recreator needs the deconstructed reference id, produced by the
        // background job. We pass the card id; the Static Ads page resolves the
        // reference from the card if not yet ready.
        const params = new URLSearchParams({
          productId, angle: angleName, language: "en", pipelineCardId: card.id,
        });
        if (card.staticReferenceId) params.set("referenceId", card.staticReferenceId);
        navigate(`/workspace/apps/static-ads?${params.toString()}`);
      } else {
        const params = new URLSearchParams({
          mode: "rewrite", product: productId, angle: angleName, language: "en",
          source: brief.transcript ?? brief.sourceCopy ?? "", pipelineCardId: card.id,
        });
        navigate(`/workspace/apps/copy-engine?${params.toString()}`);
      }
      onClose();
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    /* ...keep the existing modal shell (overlay, header, thumbnail, copy preview)...
       replace ONLY the footer action area with the block below... */
    <div className="px-5 py-4 border-t border-white/[0.06] space-y-3">
      {!recreateOpen ? (
        <div className="flex gap-3">
          <button
            disabled={busy}
            onClick={addToPipeline}
            className="flex-1 rounded-lg border border-white/10 py-2.5 text-sm text-white/80 hover:bg-white/5 disabled:opacity-50"
          >
            Add to pipeline
          </button>
          <button
            disabled={busy}
            onClick={() => setRecreateOpen(true)}
            className="flex-1 rounded-lg bg-cyan-500 py-2.5 text-sm font-semibold text-black hover:bg-cyan-400 disabled:opacity-50"
          >
            Recreate now
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <select
            value={productId}
            onChange={(e) => { setProductId(e.target.value); setAngleName(""); }}
            className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white/90"
          >
            <option value="">Select product…</option>
            {researched.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select
            value={angleName}
            onChange={(e) => setAngleName(e.target.value)}
            disabled={!productId}
            className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white/90 disabled:opacity-50"
          >
            <option value="">Select angle…</option>
            {angles.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
          </select>
          <button
            disabled={busy || !productId || !angleName}
            onClick={recreateNow}
            className="w-full rounded-lg bg-cyan-500 py-2.5 text-sm font-semibold text-black hover:bg-cyan-400 disabled:opacity-50"
          >
            {isStatic ? "Open Static Ads Recreator" : "Open Copy Engine"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update the `BriefModal` call site**

At the render site (~line 789), replace the `<BriefModal .../>` props with:

```tsx
        {brief && activeBrandId && (
          <BriefModal
            brief={brief}
            products={products}
            brandId={activeBrandId}
            onClose={() => setBrief(null)}
            flash={flash}
          />
        )}
```

Remove the now-unused `RECREATION_APP` map and `onOpenApp` prop if nothing else references them (check with a search; if `RECREATION_APP` is referenced elsewhere, leave it).

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (`useLocation` is already imported at line 21; `useState`/`useEffect` are imported; `Product` type comes from api.)

- [ ] **Step 6: Manual verification**

`pnpm dev`, open the Ad Inspo Console for a DFY brand with feed items. Click **Make it mine** on a card → modal shows **Add to pipeline** and **Recreate now**. "Add to pipeline" flashes success and closes. "Recreate now" reveals product/angle selects; picking both and confirming navigates to the right app with query params in the URL.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/workspace/AdConsolePage.tsx
git commit -m "feat(ad-pipeline): make-it-mine two-choice flow + deep-link"
```

---

## Task 12: Copy Engine — URL-param prefill + stamp `pipelineCardId`

**Files:**
- Modify: `client/src/pages/workspace/CopyEngineAppPage.tsx`

- [ ] **Step 1: Read a `pipelineCardId` from the URL and prefill on mount**

Near the top of the component (after the existing `useState` declarations, ~line 167), add:

```ts
  const [pipelineCardId, setPipelineCardId] = useState<string | null>(null);

  // Deep-link prefill from the Ad Pipeline ("Recreate now"). Runs once on mount.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("mode") === "rewrite") setMode("rewrite");
    const product = p.get("product");
    const angle = p.get("angle");
    const language = p.get("language");
    const source = p.get("source");
    const card = p.get("pipelineCardId");
    if (product) setSelectedProductId(product);
    if (angle) setSelectedAngleName(angle);
    if (language) setSelectedLanguage(language);
    if (source) setSourceCopy(source);
    if (card) setPipelineCardId(card);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

> `product` here is the product **id** (the deep-link sends an id). Confirm `setSelectedProductId` expects an id — it does (line 138 / 751 set it to `product.id`). The product dropdown will reflect the selection once `products` load; if the prefill runs before products load, the id is retained and the label renders when the list arrives.

- [ ] **Step 2: Stamp `pipelineCardId` into the generation call**

In `runGeneration`, change the `generateText` call (line ~325):

```ts
      const res = await generateText(action, vars, {
        maxTokens: 8000,
        ...(pipelineCardId ? { meta: { pipelineCardId } } : {}),
      });
```

- [ ] **Step 3: Stamp `pipelineCardId` into the saved brand asset**

In `handleSaveToAssets` (the `saveBrandAssets(...)` call ~line 400), add `pipelineCardId` into the asset's `metadata` object:

```ts
        metadata: {
          // ...existing metadata fields (content, copyType, mode, angleName, language, ...)...
          ...(pipelineCardId ? { pipelineCardId } : {}),
        },
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Navigate directly to `/workspace/apps/copy-engine?mode=rewrite&product=<realProductId>&angle=<realAngle>&source=hello&pipelineCardId=test-card`. Confirm: mode is "rewrite", the product/angle are selected, and the source copy textarea contains "hello". (Generation itself still needs an Offer — expected.)

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/workspace/CopyEngineAppPage.tsx
git commit -m "feat(ad-pipeline): copy engine deep-link prefill + pipelineCardId stamp"
```

---

## Task 13: Static Ads — URL-param prefill + stamp `pipelineCardId`

**Files:**
- Modify: `client/src/pages/workspace/StaticAdsAppPage.tsx`

- [ ] **Step 1: Prefill from URL params on mount**

After the existing `useState` declarations, add (names match the existing state: `selectedProductId`, `selectedAngle`, `selectedLanguage`, `selectedRefs`):

```ts
  const [pipelineCardId, setPipelineCardId] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const productId = p.get("productId");
    const angle = p.get("angle");
    const language = p.get("language");
    const referenceId = p.get("referenceId");
    const card = p.get("pipelineCardId");
    if (productId) setSelectedProductId(productId);
    if (angle) setSelectedAngle(angle);
    if (language) setSelectedLanguage(language);
    if (referenceId) setSelectedRefs(new Set([referenceId]));
    if (card) setPipelineCardId(card);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

> Confirm the exact setter names against the file (the explore notes: `selectedProductId`, `selectedAngle`/`customAngle`, `selectedLanguage`, `selectedRefs: Set<string>`). If the angle setter is `setSelectedAngle`, the deep-linked angle (a predefined name) goes there.

- [ ] **Step 2: Resolve the reference id from the card when the deep-link lacked one**

If the static reference wasn't ready at deep-link time (`referenceId` absent but `pipelineCardId` present), fetch the card and pick up `staticReferenceId` once enrichment finishes. Add:

```ts
  useEffect(() => {
    if (!pipelineCardId || !activeBrandId || selectedRefs.size > 0) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { card } = await getAdPipelineCard(activeBrandId, pipelineCardId);
        if (!cancelled && card.staticReferenceId) setSelectedRefs(new Set([card.staticReferenceId]));
      } catch { /* ignore — user can pick a reference manually */ }
    };
    void tick();
    const iv = setInterval(tick, 2500);
    return () => { cancelled = true; clearInterval(iv); };
  }, [pipelineCardId, activeBrandId, selectedRefs.size]);
```

Add `getAdPipelineCard` to the `../lib/api` import.

- [ ] **Step 3: Stamp `pipelineCardId` into the recreate request and saved asset**

In the recreate call (the `fetch`/api call posting to `/api/static-ads/recreate`, ~line 416-447), add `pipelineCardId` to the body when present:

```ts
        ...(pipelineCardId ? { pipelineCardId } : {}),
```

In the save-to-assets call (the `saveBrandAssets(...)` metadata block, ~line 462-516), add to `metadata`:

```ts
          ...(pipelineCardId ? { pipelineCardId } : {}),
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Navigate to `/workspace/apps/static-ads?productId=<realId>&angle=<realAngle>&referenceId=<realRefId>&pipelineCardId=test`. Confirm product, angle, language prefill and the reference is preselected.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/workspace/StaticAdsAppPage.tsx
git commit -m "feat(ad-pipeline): static ads deep-link prefill + pipelineCardId stamp"
```

---

## Task 14: The Kanban page

**Files:**
- Create: `client/src/pages/workspace/AdPipelineKanbanAppPage.tsx`

- [ ] **Step 1: Build the page**

Create `client/src/pages/workspace/AdPipelineKanbanAppPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useBrand } from "../../contexts/BrandContext"; // confirm hook path against other pages
import {
  listAdPipelineCards, updateAdPipelineCard, listProducts,
  type AdPipelineCard, type AdPipelineStage, type Product,
} from "../../lib/api";

const COLUMNS: { stage: AdPipelineStage; label: string }[] = [
  { stage: "idea", label: "Idea" },
  { stage: "in_production", label: "In Production" },
  { stage: "ready", label: "Ready" },
];

export default function AdPipelineKanbanAppPage() {
  const { activeBrand } = useBrand();
  const activeBrandId = activeBrand?.id ?? null;
  const [, navigate] = useLocation();
  const [cards, setCards] = useState<AdPipelineCard[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);

  async function refresh() {
    if (!activeBrandId) return;
    const { cards } = await listAdPipelineCards(activeBrandId);
    setCards(cards);
  }

  useEffect(() => {
    if (!activeBrandId) return;
    setLoading(true);
    Promise.all([
      listAdPipelineCards(activeBrandId),
      listProducts(activeBrandId),
    ]).then(([c, p]) => { setCards(c.cards); setProducts(p.products); }).finally(() => setLoading(false));
  }, [activeBrandId]);

  // Poll while any card is still enriching.
  useEffect(() => {
    if (!cards.some((c) => c.bgJobStatus === "pending" || c.bgJobStatus === "running")) return;
    const iv = setInterval(refresh, 2500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  const byStage = useMemo(() => {
    const map: Record<AdPipelineStage, AdPipelineCard[]> = { idea: [], in_production: [], ready: [] };
    for (const c of cards) map[c.stage]?.push(c);
    return map;
  }, [cards]);

  async function moveCard(card: AdPipelineCard, stage: AdPipelineStage) {
    if (!activeBrandId || card.stage === stage) return;
    setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, stage } : c)));
    try {
      await updateAdPipelineCard(activeBrandId, card.id, { stage });
    } catch {
      void refresh();
    }
  }

  function recreate(card: AdPipelineCard) {
    // Idea cards have no product/angle yet → send to the app; the user picks there.
    // (For a richer flow, reuse the Ad Console product/angle picker. v1 keeps it simple.)
    const isStatic = card.format === "static";
    const base = isStatic ? "/workspace/apps/static-ads" : "/workspace/apps/copy-engine";
    const params = new URLSearchParams({ pipelineCardId: card.id });
    if (card.productId) params.set(isStatic ? "productId" : "product", card.productId);
    if (card.angleName) params.set("angle", card.angleName);
    if (!isStatic) { params.set("mode", "rewrite"); params.set("source", card.originalScript ?? card.brief.sourceCopy ?? ""); }
    if (isStatic && card.staticReferenceId) params.set("referenceId", card.staticReferenceId);
    navigate(`${base}?${params.toString()}`);
  }

  if (!activeBrandId) return <div className="p-8 text-white/60">Select a brand to view its Ad Pipeline.</div>;

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-white/90 mb-4">Ad Pipeline</h1>
      {loading ? (
        <div className="text-white/50">Loading…</div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {COLUMNS.map((col) => (
            <div
              key={col.stage}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { const c = cards.find((x) => x.id === dragId); if (c) void moveCard(c, col.stage); setDragId(null); }}
              className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 min-h-[60vh]"
            >
              <div className="flex items-center gap-2 mb-3 text-sm font-medium text-white/80">
                {col.label}
                <span className="text-xs text-white/40">{byStage[col.stage].length}</span>
              </div>
              <div className="space-y-3">
                {byStage[col.stage].map((card) => (
                  <PipelineCard key={card.id} card={card} onDragStart={() => setDragId(card.id)} onRecreate={() => recreate(card)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineCard({ card, onDragStart, onRecreate }: { card: AdPipelineCard; onDragStart: () => void; onRecreate: () => void }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="rounded-lg bg-[#0D0F12] border border-white/10 p-3 space-y-2 cursor-grab"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-white/40">{card.format}</span>
        {card.bgJobStatus === "running" || card.bgJobStatus === "pending" ? (
          <span className="text-[10px] text-cyan-400">enriching…</span>
        ) : card.bgJobStatus === "failed" ? (
          <span className="text-[10px] text-red-400" title={card.bgJobError ?? ""}>enrich failed</span>
        ) : null}
      </div>

      {card.sourceUrl && (
        <a href={card.sourceUrl} target="_blank" rel="noreferrer" className="block text-xs text-cyan-400 hover:underline truncate">
          Original reference ↗
        </a>
      )}

      {card.format === "static" ? (
        card.referenceImageUrl && <img src={card.referenceImageUrl} alt="reference" className="w-full rounded-md" />
      ) : (
        card.originalScript && <p className="text-xs text-white/60 line-clamp-3 whitespace-pre-wrap">{card.originalScript}</p>
      )}

      {(card.productId || card.angleName) && (
        <p className="text-[11px] text-white/40">{card.angleName ?? ""}{card.language ? ` · ${card.language}` : ""}</p>
      )}

      {card.output ? (
        card.output.kind === "image" && card.output.imageUrl ? (
          <img src={card.output.imageUrl} alt="recreated" className="w-full rounded-md border border-cyan-500/30" />
        ) : (
          <p className="text-xs text-white/80 line-clamp-4 whitespace-pre-wrap border-l-2 border-cyan-500/40 pl-2">{card.output.text}</p>
        )
      ) : (
        <button onClick={onRecreate} className="w-full rounded-md bg-cyan-500 py-1.5 text-xs font-semibold text-black hover:bg-cyan-400">
          Recreate
        </button>
      )}
    </div>
  );
}
```

> Confirm the brand hook (`useBrand`) import path against another workspace page (e.g. `CopyEngineAppPage.tsx` uses `activeBrandId` from a context — copy that exact import). `line-clamp-*` requires the `@tailwindcss/line-clamp` plugin or Tailwind ≥3.3; if unavailable, drop those classes.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/workspace/AdPipelineKanbanAppPage.tsx
git commit -m "feat(ad-pipeline): kanban page"
```

---

## Task 15: Route + nav entry

**Files:**
- Modify: `client/src/App.tsx` (import + route)
- Modify: `client/src/components/WorkspaceLayout.tsx` (gated nav item)

- [ ] **Step 1: Register the route**

In `client/src/App.tsx`, add the import near the other page imports (~line 30):

```ts
import AdPipelineKanbanAppPage from "./pages/workspace/AdPipelineKanbanAppPage";
```

Add the route next to the ad-console route (~line 106):

```tsx
      <Route path="/workspace/apps/ad-pipeline">
        <RequireAuth><WorkspaceLayout><AdPipelineKanbanAppPage /></WorkspaceLayout></RequireAuth>
      </Route>
```

- [ ] **Step 2: Add the gated nav item**

In `client/src/components/WorkspaceLayout.tsx`, add a nav item constant next to `AD_CONSOLE_ITEM` (~line 50). Reuse an existing imported icon (e.g. `Workflow` or `Kanban` if available from lucide-react; otherwise reuse `LayoutGrid` which is already imported):

```ts
const AD_PIPELINE_ITEM = {
  id: "ad-pipeline",
  label: "Ad Pipeline",
  icon: LayoutGrid,
  path: "/workspace/apps/ad-pipeline",
  description: "Capture → recreate → ready",
};
```

Insert it into `navItems` right after the Ad Console entry (line ~64):

```ts
  const navItems = [
    ...(showDfyConsoles ? [AD_CONSOLE_ITEM, AD_PIPELINE_ITEM] : []),
    NAV_ITEMS[0], // Products
    ...(showDfyConsoles ? [CLIENT_CONSOLE_ITEM] : []),
    NAV_ITEMS[1], // Brand Info
    NAV_ITEMS[2], // Apps
    ...NAV_ITEMS.slice(3), // Assets, Workflows
  ];
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Full manual end-to-end verification**

`pnpm dev`. As a manager on a DFY brand:
1. **Ad Pipeline** appears in the sidebar; clicking it shows three empty columns.
2. In **Ad Inspo Console**, click **Make it mine** on a **video/organic** card → **Add to pipeline**. Open Ad Pipeline → a card sits in **Idea**; after a moment its "enriching…" badge clears and the original script appears (transcript).
3. On that Idea card click **Recreate** → lands in Copy Engine prefilled (mode rewrite + source). Add an Offer, click Rewrite → draft appears. Return to Ad Pipeline → the card now shows the draft (from the generation). It is still **In Production** (no asset saved yet).
4. Back in Copy Engine, **Save to Brand Assets** → return to Ad Pipeline → the card is now in **Ready** and shows the saved text.
5. Repeat for a **static ad**: Make it mine → Recreate now (pick product+angle) → lands in Static Ads with the reference selected (after deconstruction completes) → Recreate → Save → card moves to Ready showing the image.
6. Drag a card between columns → it stays after refresh.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx client/src/components/WorkspaceLayout.tsx
git commit -m "feat(ad-pipeline): route + gated nav entry"
```

---

## Self-Review (completed)

**Spec coverage** — every spec section maps to a task:
- §3.1 table → Task 1. §3.2 output linkage (generations + brand_assets, prefer asset) → Tasks 2, 5, 7, 8, 9, 12, 13.
- §4 Make-it-mine (two choices, background job, static-reference bridge) → Tasks 4, 5, 11.
- §4.3 transcription reuse / deconstruction reuse → Tasks 3, 4.
- §5 deep-links (video→Copy Engine, static→Static Ads, additive app changes) → Tasks 11, 12, 13.
- §6 Kanban (columns, auto-advance + drag, Ready needs saved asset, card contents) → Tasks 9, 14, 15.
- §7 API & routing → Tasks 6, 10, 15. §8 errors (non-fatal enrichment, degraded prefill) → Tasks 4, 12, 13, 14. §9 testing → Tasks 2, 3 (unit) + manual steps throughout.

**Placeholder scan** — no TBD/TODO; every code step has concrete code. Inline `> Note:` callouts flag the few spots where the implementer must confirm an exact local symbol name (auth middleware import, brand hook path, the inserted-rows variable in brandAssets, static-ads setter names) — these are verification instructions, not missing content.

**Type consistency** — `AdPipelineStage`/`stage` strings, `CardOutput`, `pipelineCardId`, and the wrapper names (`listAdPipelineCards`, `createAdPipelineCard`, `updateAdPipelineCard`, `getAdPipelineCard`, `getAdPipelineCardJobStatus`) are used identically across server and client tasks. The server resolver returns `CardOutput`; the client mirrors it as `AdPipelineCardOutput` with the same fields.
