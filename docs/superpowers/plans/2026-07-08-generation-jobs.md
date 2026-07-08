# Durable Generation Jobs + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generation batches become durable server-side jobs (survive tab close + deploys) with a top-level Dashboard for progress, resume, badge, and toasts — piloted on the B-roll app.

**Architecture:** New `jobs` + `job_items` tables hold a full session snapshot and per-item state. An in-process runner (registry of type → executor) claims jobs with a guarded UPDATE, processes items with a small pool, persists every transition, retries transient provider errors, and falls back Seedance→Kling on likeness refusals. A boot sweep resumes interrupted jobs (prod) — the established sweep idiom. Apps create jobs and poll them; the Dashboard lists the active brand's jobs and deep-links back into apps with `?job=<id>` for full state restore.

**Tech Stack:** Express + Drizzle (node-postgres) + Vite/React (wouter) + vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-08-generation-jobs-design.md`

## File map

- Create: `server/lib/jobRunner.ts` — registry, claiming, run loop, retry/fallback policy, boot sweep
- Create: `server/lib/jobRunner.test.ts` — pure-logic tests (error classification, kling fallback mapping)
- Create: `server/lib/jobExecutors/broll.ts` — executors for `broll_images` / `broll_videos` (side-effect registration)
- Create: `server/routes/jobs.ts` — jobs REST API
- Create: `client/src/hooks/useJobsPulse.ts` — running-count badge + completion toast poller
- Create: `client/src/pages/workspace/DashboardPage.tsx` — jobs overview
- Modify: `server/db/schema.ts` — `jobs`, `jobItems` tables
- Modify: `server/index.ts` — mount router, import executors, boot sweep
- Modify: `client/src/lib/api.ts` — Job types + createJob/listJobs/getJob/retryJobItem
- Modify: `client/src/App.tsx` — `/workspace/dashboard` route
- Modify: `client/src/components/WorkspaceLayout.tsx` — Dashboard nav item + badge
- Modify: `client/src/pages/workspace/BrollAppPage.tsx` — batch buttons create jobs; poll; resume

Conventions to follow everywhere: local `sendError(res, status, message)` helper per route file (copy from `server/routes/team.ts:36`), `requireAuth` from `server/lib/auth.js`, `canSeeBrand` from `server/lib/brandAccess.js`, `req.auth!.{user,team,role}`, client `get<T>()`/`post<T>()` helpers already in `api.ts`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Never `git add -A` — always explicit paths. NEVER stage `server/data/reference-style.json`.

---

### Task 1: Schema — `jobs` + `job_items`

**Files:**
- Modify: `server/db/schema.ts` (append after the `brandAssets` table)
- Generated: `drizzle/00XX_*.sql` + `drizzle/meta/*` (number assigned by drizzle-kit)

- [ ] **Step 1: Add tables to schema.ts**

```ts
/**
 * Durable generation jobs. One row per user-triggered batch ("Generate all
 * images" = one job). The runner (server/lib/jobRunner.ts) processes items
 * server-side so batches survive tab closes and deploys; payload snapshots
 * the app session at trigger time so the app can restore full working state.
 * Spec: docs/superpowers/specs/2026-07-08-generation-jobs-design.md
 */
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  brandId: uuid("brand_id").notNull(),
  userId: uuid("user_id"), // creator, from req.auth
  productId: uuid("product_id"), // soft ref
  app: text("app").notNull(), // "broll" | "character_broll" | "single_scene" | "message_testing" | "listicle" | "copy_engine"
  type: text("type").notNull(), // runner registry key: "broll_images" | "broll_videos" | ...
  status: text("status").notNull().default("queued"), // queued | running | complete | complete_with_errors | failed
  title: text("title").notNull(),
  payload: jsonb("payload").notNull(), // full session snapshot at trigger time
  totalCount: integer("total_count").notNull().default(0),
  doneCount: integer("done_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  error: text("error"), // job-fatal error only
}, (t) => ({
  brandStatusIdx: index("jobs_brand_status_idx").on(t.brandId, t.status, t.createdAt),
}));

export const jobItems = pgTable("job_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: uuid("job_id").notNull(),
  idx: integer("idx").notNull(), // stable ordering
  label: text("label").notNull(), // shot title
  status: text("status").notNull().default("pending"), // pending | running | complete | failed
  attempts: integer("attempts").notNull().default(0),
  input: jsonb("input").notNull(), // { shotId, kind: "image"|"video", model, falInput }
  output: jsonb("output"), // { url, model, durationMs }
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => ({
  jobIdx: index("job_items_job_idx").on(t.jobId),
}));

export type Job = typeof jobs.$inferSelect;
export type JobItem = typeof jobItems.$inferSelect;
```

Check the top of schema.ts imports include `index` from drizzle (`import { pgTable, text, uuid, timestamp, jsonb, integer, index, uniqueIndex } from "drizzle-orm/pg-core";`) — add `index` if missing.

- [ ] **Step 2: Generate + apply migration (dev)**

Run: `pnpm db:generate` then `pnpm db:migrate`
Expected: new `drizzle/00XX_....sql` creating both tables; migrate applies cleanly on dev.

- [ ] **Step 3: Typecheck**

Run: `pnpm check` — Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add server/db/schema.ts drizzle/
git commit -m "feat(jobs): jobs + job_items schema for durable generation jobs"
```

---

### Task 2: Runner pure logic (TDD) — error classification + kling fallback mapping

**Files:**
- Create: `server/lib/jobRunner.ts` (pure parts only in this task)
- Test: `server/lib/jobRunner.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { classifyJobError, seedanceToKlingFallback } from "./jobRunner.js";

describe("classifyJobError", () => {
  it("marks 5xx / gateway / timeout / 429 as transient", () => {
    expect(classifyJobError(502, "Bad Gateway")).toBe("transient");
    expect(classifyJobError(undefined, "Gateway Timeout - Downstream service unavailable")).toBe("transient");
    expect(classifyJobError(429, "Too Many Requests")).toBe("transient");
    expect(classifyJobError(undefined, "fetch failed")).toBe("transient");
  });
  it("marks Seedance likeness/content-checker 422s as likeness", () => {
    expect(classifyJobError(422, "image_urls: The images or videos provided may contain likenesses of real people or other private information that cannot be processed.")).toBe("likeness");
    expect(classifyJobError(422, "prompt: The content could not be processed because it contained material flagged by a content checker.")).toBe("likeness");
  });
  it("marks other 4xx as hard", () => {
    expect(classifyJobError(422, "resolution: invalid value")).toBe("hard");
    expect(classifyJobError(400, "prompt required")).toBe("hard");
  });
});

describe("seedanceToKlingFallback", () => {
  it("maps seedance reference-to-video input to kling image-to-video", () => {
    const out = seedanceToKlingFallback({
      prompt: "Slide the mailer open @Image1",
      image_urls: ["https://img/start.jpg", "https://img/ref.jpg"],
      duration: "5",
      aspect_ratio: "9:16",
      resolution: "720p",
      generate_audio: false,
    });
    expect(out.model).toBe("fal-ai/kling-video/v3/standard/image-to-video");
    expect(out.input).toEqual({
      prompt: "Slide the mailer open @Image1",
      image_url: "https://img/start.jpg",
      duration: "5",
      aspect_ratio: "9:16",
    });
  });
  it("returns null when there is no starting frame", () => {
    expect(seedanceToKlingFallback({ prompt: "x", image_urls: [] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm exec vitest run --root . server/lib/jobRunner.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement the pure functions** (create `server/lib/jobRunner.ts`)

```ts
/**
 * Durable generation job runner.
 * Spec: docs/superpowers/specs/2026-07-08-generation-jobs-design.md
 *
 * Jobs are DB rows (schema.jobs / schema.jobItems). Apps create a job via
 * POST /api/jobs; kickJob() claims it and processes items in-process with a
 * small pool, persisting EVERY transition so a deploy/crash can resume from
 * the DB (sweepOrphanedJobs at boot). Executors are registered per job type
 * and perform exactly ONE item.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db.js";
import { formatError } from "./formatError.js";

export type JobErrorClass = "transient" | "likeness" | "hard";

/**
 * transient → provider hiccup (retry with backoff)
 * likeness  → Seedance content policy refusing real-person likenesses /
 *             content-checker flags (fallback to Kling for video items)
 * hard      → real validation/permanent error (fail the item)
 */
export function classifyJobError(status: number | undefined, message: string): JobErrorClass {
  if (status !== undefined && (status >= 500 || status === 429)) return "transient";
  if (/gateway|timeout|unavailable|econnreset|econnrefused|fetch failed|socket hang up/i.test(message)) {
    return "transient";
  }
  if (
    status === 422 &&
    /likeness|real people|private information|content checker|flagged by a content/i.test(message)
  ) {
    return "likeness";
  }
  return "hard";
}

/**
 * Map a Seedance reference-to-video input to Kling v3 image-to-video for the
 * likeness fallback. Kling takes ONE image_url (the starting frame — always
 * the first Seedance reference) and has no generate_audio/resolution knobs.
 * The @ImageN references in the prompt are Seedance syntax; Kling ignores
 * them harmlessly. Returns null when no starting frame exists.
 */
export function seedanceToKlingFallback(
  falInput: Record<string, unknown>,
): { model: string; input: Record<string, unknown> } | null {
  const urls = Array.isArray(falInput.image_urls) ? (falInput.image_urls as string[]) : [];
  const first = urls[0];
  if (!first) return null;
  return {
    model: "fal-ai/kling-video/v3/standard/image-to-video",
    input: {
      prompt: falInput.prompt,
      image_url: first,
      duration: falInput.duration ?? "5",
      aspect_ratio: falInput.aspect_ratio ?? "9:16",
    },
  };
}
```

- [ ] **Step 4: Run tests** — `pnpm exec vitest run --root . server/lib/jobRunner.test.ts` → PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/jobRunner.ts server/lib/jobRunner.test.ts
git commit -m "feat(jobs): runner error classification + seedance->kling fallback mapping (TDD)"
```

---

### Task 3: Runner core — registry, claiming, run loop, sweep

**Files:**
- Modify: `server/lib/jobRunner.ts` (append to Task 2's file)

- [ ] **Step 1: Append registry + runner + sweep**

```ts
// ── Registry ────────────────────────────────────────────────────────────────

export type JobExecutor = (args: {
  item: typeof schema.jobItems.$inferSelect;
  payload: Record<string, unknown>;
}) => Promise<Record<string, unknown>>; // resolved output jsonb (e.g. { url, model, durationMs })

const registry = new Map<string, JobExecutor>();

export function registerJobType(type: string, executor: JobExecutor): void {
  registry.set(type, executor);
}

export function isRegisteredJobType(type: string): boolean {
  return registry.has(type);
}

// ── Runner ──────────────────────────────────────────────────────────────────

const ITEM_CONCURRENCY = 3;
const MAX_TRANSIENT_ATTEMPTS = 3; // first try + 2 retries
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** In-process guard so the same node doesn't run one job twice concurrently. */
const inFlight = new Set<string>();

/** Fire-and-forget: claim the job and process it in the background. */
export function kickJob(jobId: string): void {
  if (inFlight.has(jobId)) return;
  inFlight.add(jobId);
  void runJob(jobId).finally(() => inFlight.delete(jobId));
}

async function runJob(jobId: string): Promise<void> {
  // Guarded claim — safe if a second instance ever runs this code.
  const claimed = await db
    .update(schema.jobs)
    .set({ status: "running", updatedAt: new Date() })
    .where(and(eq(schema.jobs.id, jobId), inArray(schema.jobs.status, ["queued", "running"])))
    .returning({ id: schema.jobs.id, type: schema.jobs.type, payload: schema.jobs.payload });
  const job = claimed[0];
  if (!job) return; // already terminal or gone
  const executor = registry.get(job.type);
  if (!executor) {
    await db
      .update(schema.jobs)
      .set({ status: "failed", error: `No executor registered for job type "${job.type}"`, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.jobs.id, jobId));
    return;
  }
  const payload = (job.payload ?? {}) as Record<string, unknown>;

  const pending = await db
    .select()
    .from(schema.jobItems)
    .where(and(eq(schema.jobItems.jobId, jobId), inArray(schema.jobItems.status, ["pending", "running"])))
    .orderBy(asc(schema.jobItems.idx));

  // Small pool — chunked like the codebase's mapPool idiom.
  for (let i = 0; i < pending.length; i += ITEM_CONCURRENCY) {
    await Promise.all(pending.slice(i, i + ITEM_CONCURRENCY).map((item) => runItem(item, payload, executor)));
  }

  // Finalize from authoritative item states.
  const items = await db.select().from(schema.jobItems).where(eq(schema.jobItems.jobId, jobId));
  const done = items.filter((it) => it.status === "complete").length;
  const errs = items.filter((it) => it.status === "failed").length;
  await db
    .update(schema.jobs)
    .set({
      status: errs === 0 ? "complete" : done > 0 ? "complete_with_errors" : "failed",
      doneCount: done,
      errorCount: errs,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, jobId));
  console.log(`[jobs] ${jobId} finished: ${done} ok, ${errs} failed of ${items.length}`);
}

async function runItem(
  item: typeof schema.jobItems.$inferSelect,
  payload: Record<string, unknown>,
  executor: JobExecutor,
): Promise<void> {
  let attempts = item.attempts;
  for (;;) {
    attempts++;
    await db
      .update(schema.jobItems)
      .set({ status: "running", attempts, startedAt: item.startedAt ?? new Date(), error: null })
      .where(eq(schema.jobItems.id, item.id));
    try {
      const output = await executor({ item: { ...item, attempts }, payload });
      await db
        .update(schema.jobItems)
        .set({ status: "complete", output, finishedAt: new Date() })
        .where(eq(schema.jobItems.id, item.id));
      await bumpJobCounters(item.jobId);
      return;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const msg = formatError(err);
      const cls = classifyJobError(status, msg);
      if (cls === "transient" && attempts < MAX_TRANSIENT_ATTEMPTS) {
        console.warn(`[jobs] item ${item.id} transient error (attempt ${attempts}/${MAX_TRANSIENT_ATTEMPTS}), retrying: ${msg.slice(0, 120)}`);
        await sleep(2000 * attempts);
        continue;
      }
      // "likeness" is handled INSIDE the video executor (model fallback);
      // if it still reaches here the fallback also failed → fail the item.
      await db
        .update(schema.jobItems)
        .set({ status: "failed", error: msg, finishedAt: new Date() })
        .where(eq(schema.jobItems.id, item.id));
      await bumpJobCounters(item.jobId);
      return;
    }
  }
}

/** Denormalized progress so the dashboard/badge query never joins items. */
async function bumpJobCounters(jobId: string): Promise<void> {
  const items = await db
    .select({ status: schema.jobItems.status })
    .from(schema.jobItems)
    .where(eq(schema.jobItems.jobId, jobId));
  await db
    .update(schema.jobs)
    .set({
      doneCount: items.filter((it) => it.status === "complete").length,
      errorCount: items.filter((it) => it.status === "failed").length,
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, jobId));
}

// ── Boot sweep ──────────────────────────────────────────────────────────────

/**
 * Resume jobs orphaned by a restart. Production resumes (items already
 * complete are skipped — idempotent); dev marks them failed (tsx watch
 * restarts on every save — same precedent as the research sweep).
 */
export async function sweepOrphanedJobs(opts: { resume: boolean }): Promise<{ resumed: number; failed: number }> {
  const orphans = await db
    .select({ id: schema.jobs.id, title: schema.jobs.title })
    .from(schema.jobs)
    .where(inArray(schema.jobs.status, ["queued", "running"]));
  if (orphans.length === 0) return { resumed: 0, failed: 0 };
  if (!opts.resume) {
    for (const j of orphans) {
      await db
        .update(schema.jobs)
        .set({ status: "failed", error: "Interrupted by a dev server restart.", finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.jobs.id, j.id));
    }
    return { resumed: 0, failed: orphans.length };
  }
  for (const j of orphans) {
    console.log(`[jobs] boot sweep: resuming "${j.title}" (${j.id})`);
    kickJob(j.id);
  }
  return { resumed: orphans.length, failed: 0 };
}
```

- [ ] **Step 2: Typecheck + full tests** — `pnpm check` → exit 0; `pnpm exec vitest run --root .` → all pass.

- [ ] **Step 3: Commit**

```bash
git add server/lib/jobRunner.ts
git commit -m "feat(jobs): registry, guarded claim, run loop with retries, boot sweep"
```

---

### Task 4: B-roll executors (`broll_images`, `broll_videos`)

**Files:**
- Create: `server/lib/jobExecutors/broll.ts`

- [ ] **Step 1: Create the executor module**

```ts
/**
 * Executors for the standard B-roll app's two batch job types. Each executes
 * ONE item: item.input = { shotId, kind: "image"|"video", model, falInput }.
 * The generic media call goes through server/lib/fal.js so the generations
 * table keeps logging via the /api/generate route's accounting… — NOTE: jobs
 * call fal directly (generateImage/generateVideo) and write their own
 * generations rows here, mirroring server/routes/generate.ts persistence, so
 * cost accounting stays complete without HTTP self-calls.
 *
 * Likeness policy (spec): a Seedance 422 likeness/content refusal on a video
 * item triggers ONE same-input fallback attempt on Kling v3; output.model
 * records what actually rendered.
 */
import { db, schema } from "../db.js";
import { generateImage, generateVideo } from "../fal.js";
import { formatError } from "../formatError.js";
import { classifyJobError, registerJobType, seedanceToKlingFallback, type JobExecutor } from "../jobRunner.js";

async function logGeneration(args: {
  action: string;
  kind: "image" | "video";
  inputs: Record<string, unknown>;
  output: Record<string, unknown> | null;
  model: string;
  durationMs: number;
  error?: string;
}): Promise<void> {
  await db.insert(schema.generations).values({
    action: args.action,
    kind: args.kind,
    inputs: args.inputs,
    output: args.output,
    model: args.model,
    error: args.error ?? null,
    durationMs: args.durationMs,
  });
}

const runImageItem: JobExecutor = async ({ item }) => {
  const input = (item.input ?? {}) as { model?: string; falInput?: Record<string, unknown> };
  if (!input.falInput) throw new Error("item.input.falInput missing");
  const result = await generateImage({ model: input.model, input: input.falInput });
  const url = result.urls[0];
  await logGeneration({
    action: "broll_image",
    kind: "image",
    inputs: { jobItemId: item.id, input: input.falInput },
    output: { urls: result.urls },
    model: result.model,
    durationMs: result.durationMs,
  });
  if (!url) throw new Error("No image URL returned");
  return { url, model: result.model, durationMs: result.durationMs };
};

const runVideoItem: JobExecutor = async ({ item }) => {
  const input = (item.input ?? {}) as { model?: string; falInput?: Record<string, unknown> };
  if (!input.falInput) throw new Error("item.input.falInput missing");
  const primaryModel = input.model ?? "bytedance/seedance-2.0/fast/reference-to-video";
  try {
    const result = await generateVideo({ model: primaryModel, input: input.falInput });
    const url = result.urls[0];
    await logGeneration({
      action: "broll_video", kind: "video",
      inputs: { jobItemId: item.id, input: input.falInput },
      output: { urls: result.urls }, model: result.model, durationMs: result.durationMs,
    });
    if (!url) throw new Error("No video URL returned");
    return { url, model: result.model, durationMs: result.durationMs };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const msg = formatError(err);
    if (classifyJobError(status, msg) !== "likeness") throw err;
    const fallback = seedanceToKlingFallback(input.falInput);
    if (!fallback) throw err;
    console.warn(`[jobs] item ${item.id}: seedance likeness refusal — falling back to kling`);
    const result = await generateVideo({ model: fallback.model, input: fallback.input });
    const url = result.urls[0];
    await logGeneration({
      action: "broll_video", kind: "video",
      inputs: { jobItemId: item.id, input: fallback.input, fallbackFrom: primaryModel },
      output: { urls: result.urls }, model: result.model, durationMs: result.durationMs,
    });
    if (!url) throw new Error("No video URL returned (kling fallback)");
    return { url, model: result.model, durationMs: result.durationMs, fallbackFrom: primaryModel };
  }
};

registerJobType("broll_images", runImageItem);
registerJobType("broll_videos", runVideoItem);
```

- [ ] **Step 2: Typecheck** — `pnpm check` → exit 0. (Check `schema.generations` column names against `server/db/schema.ts` — `inputs/output/model/error/durationMs` exist; adjust if the insert complains.)

- [ ] **Step 3: Commit**

```bash
git add server/lib/jobExecutors/broll.ts
git commit -m "feat(jobs): b-roll image/video executors with kling likeness fallback"
```

---

### Task 5: Jobs REST API

**Files:**
- Create: `server/routes/jobs.ts`

- [ ] **Step 1: Create the router**

```ts
/**
 * Durable generation jobs API.
 *   POST /api/jobs                       → create + start a job
 *   GET  /api/jobs?brandId=<id>          → { jobs: [...], runningCount } for the dashboard/badge
 *   GET  /api/jobs/:id                   → { job, items } — poll target
 *   POST /api/jobs/:id/items/:itemId/retry → reset one failed item + re-kick
 * All brand-gated via canSeeBrand. Spec: docs/superpowers/specs/2026-07-08-generation-jobs-design.md
 */
import { and, desc, eq, inArray, asc, sql as sqlTag } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { db, schema } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { canSeeBrand } from "../lib/brandAccess.js";
import { isRegisteredJobType, kickJob } from "../lib/jobRunner.js";

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

const JOB_APPS = ["broll", "character_broll", "single_scene", "message_testing", "listicle", "copy_engine"] as const;

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

jobsRouter.post("/", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      app?: string; type?: string; brandId?: string; productId?: string | null;
      title?: string; payload?: Record<string, unknown>;
      items?: Array<{ label?: string; input?: Record<string, unknown> }>;
    };
    if (!body.app || !(JOB_APPS as readonly string[]).includes(body.app)) {
      return sendError(res, 400, `app must be one of: ${JOB_APPS.join(", ")}`);
    }
    if (!body.type || !isRegisteredJobType(body.type)) {
      return sendError(res, 400, `Unknown job type "${body.type ?? ""}"`);
    }
    if (!body.brandId) return sendError(res, 400, "brandId is required");
    if (!body.title?.trim()) return sendError(res, 400, "title is required");
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return sendError(res, 400, "items must be a non-empty array");
    }
    const { user, role } = req.auth!;
    if (!(await canSeeBrand(user.id, role, body.brandId))) return sendError(res, 403, "No access to this brand");

    const [job] = await db
      .insert(schema.jobs)
      .values({
        brandId: body.brandId,
        userId: user.id,
        productId: body.productId ?? null,
        app: body.app,
        type: body.type,
        title: body.title.trim(),
        payload: body.payload ?? {},
        totalCount: body.items.length,
      })
      .returning();
    await db.insert(schema.jobItems).values(
      body.items.map((it, idx) => ({
        jobId: job.id,
        idx,
        label: (it.label ?? `Item ${idx + 1}`).slice(0, 200),
        input: it.input ?? {},
      })),
    );
    kickJob(job.id);
    res.json({ job });
  } catch (err) {
    console.error("[jobs] create failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

jobsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const brandId = String(req.query.brandId ?? "");
    if (!brandId) return sendError(res, 400, "brandId is required");
    const { user, role } = req.auth!;
    if (!(await canSeeBrand(user.id, role, brandId))) return sendError(res, 403, "No access to this brand");
    const rows = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.brandId, brandId))
      .orderBy(
        // running/queued first, then newest
        sqlTag`case when ${schema.jobs.status} in ('queued','running') then 0 else 1 end`,
        desc(schema.jobs.createdAt),
      )
      .limit(50);
    const runningCount = rows.filter((j) => j.status === "queued" || j.status === "running").length;
    res.json({ jobs: rows, runningCount });
  } catch (err) {
    console.error("[jobs] list failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

jobsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, req.params.id)).limit(1);
    if (!job) return sendError(res, 404, "Job not found");
    const { user, role } = req.auth!;
    if (!(await canSeeBrand(user.id, role, job.brandId))) return sendError(res, 403, "No access to this brand");
    const items = await db
      .select()
      .from(schema.jobItems)
      .where(eq(schema.jobItems.jobId, job.id))
      .orderBy(asc(schema.jobItems.idx));
    res.json({ job, items });
  } catch (err) {
    console.error("[jobs] get failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

jobsRouter.post("/:id/items/:itemId/retry", async (req: Request, res: Response) => {
  try {
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, req.params.id)).limit(1);
    if (!job) return sendError(res, 404, "Job not found");
    const { user, role } = req.auth!;
    if (!(await canSeeBrand(user.id, role, job.brandId))) return sendError(res, 403, "No access to this brand");
    const [item] = await db
      .select()
      .from(schema.jobItems)
      .where(and(eq(schema.jobItems.id, req.params.itemId), eq(schema.jobItems.jobId, job.id)))
      .limit(1);
    if (!item) return sendError(res, 404, "Item not found");
    if (item.status !== "failed") return sendError(res, 400, "Only failed items can be retried");
    await db
      .update(schema.jobItems)
      .set({ status: "pending", error: null, finishedAt: null })
      .where(eq(schema.jobItems.id, item.id));
    await db
      .update(schema.jobs)
      .set({ status: "queued", finishedAt: null, updatedAt: new Date() })
      .where(eq(schema.jobs.id, job.id));
    kickJob(job.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[jobs] retry failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});
```

- [ ] **Step 2: Mount + boot wiring in `server/index.ts`**

Add imports (with the other route imports):
```ts
import { jobsRouter } from "./routes/jobs.js";
import { sweepOrphanedJobs } from "./lib/jobRunner.js";
import "./lib/jobExecutors/broll.js"; // side-effect: registers broll_images / broll_videos
```
Mount (next to the other `app.use` lines): `app.use("/api/jobs", jobsRouter);`
Boot sweep (next to the research sweep block):
```ts
  // Durable-jobs rescue sweep — resume batches orphaned by a restart (prod),
  // mark them failed in dev (tsx watch restarts per save). Same idiom as the
  // research/mechanism sweeps above.
  void (async () => {
    try {
      const r = await sweepOrphanedJobs({ resume: !isDev });
      if (r.resumed > 0 || r.failed > 0) {
        console.log(`[jobs] boot sweep: resumed ${r.resumed}, failed ${r.failed}`);
      }
    } catch (err) {
      console.error("[jobs] boot sweep failed (non-fatal):", err);
    }
  })();
```

- [ ] **Step 3: Typecheck + build** — `pnpm check` → 0; `pnpm build` → succeeds.

- [ ] **Step 4: Dev smoke (API level)** — with `pnpm dev` running and a logged-in session cookie, POST a 1-item job of a registered type with a trivially-valid falInput and confirm `GET /api/jobs/:id` shows it complete. (Fastest: temporary `registerJobType("smoke", async () => ({ ok: true }))` in `jobExecutors/broll.ts`, create via curl, verify, then delete the line before commit.)

- [ ] **Step 5: Commit**

```bash
git add server/routes/jobs.ts server/index.ts
git commit -m "feat(jobs): REST API, router mount, boot sweep wiring"
```

---

### Task 6: Client API types + functions

**Files:**
- Modify: `client/src/lib/api.ts` (append a "---------- Jobs ----------" section)

- [ ] **Step 1: Add types + fns**

```ts
// ---------- Jobs (durable generation jobs) ----------

export type JobStatus = "queued" | "running" | "complete" | "complete_with_errors" | "failed";
export type JobItemStatus = "pending" | "running" | "complete" | "failed";

export type Job = {
  id: string; createdAt: string; updatedAt: string; finishedAt: string | null;
  brandId: string; userId: string | null; productId: string | null;
  app: string; type: string; status: JobStatus; title: string;
  payload: Record<string, unknown>;
  totalCount: number; doneCount: number; errorCount: number; error: string | null;
};

export type JobItem = {
  id: string; jobId: string; idx: number; label: string; status: JobItemStatus;
  attempts: number; input: Record<string, unknown>;
  output: { url?: string; model?: string; durationMs?: number } | null;
  error: string | null; startedAt: string | null; finishedAt: string | null;
};

export function createJob(args: {
  app: string; type: string; brandId: string; productId?: string | null; title: string;
  payload: Record<string, unknown>; items: Array<{ label: string; input: Record<string, unknown> }>;
}): Promise<{ job: Job }> {
  return post<{ job: Job }>("/api/jobs", args);
}

export function listJobs(brandId: string): Promise<{ jobs: Job[]; runningCount: number }> {
  return get<{ jobs: Job[]; runningCount: number }>(`/api/jobs?brandId=${encodeURIComponent(brandId)}`);
}

export function getJob(id: string): Promise<{ job: Job; items: JobItem[] }> {
  return get<{ job: Job; items: JobItem[] }>(`/api/jobs/${id}`);
}

export function retryJobItem(jobId: string, itemId: string): Promise<{ ok: true }> {
  return post<{ ok: true }>(`/api/jobs/${jobId}/items/${itemId}/retry`, {});
}
```

- [ ] **Step 2: Typecheck** — `pnpm check` → 0.
- [ ] **Step 3: Commit** — `git add client/src/lib/api.ts && git commit -m "feat(jobs): client api types + fns"`

---

### Task 7: Dashboard page + route + nav item

**Files:**
- Create: `client/src/pages/workspace/DashboardPage.tsx`
- Modify: `client/src/App.tsx` (route), `client/src/components/WorkspaceLayout.tsx` (nav)

- [ ] **Step 1: Create DashboardPage**

```tsx
/**
 * Jobs overview for the ACTIVE brand — running batches first with live
 * progress, then recent finished/failed. Clicking a job deep-links into the
 * source app with ?job=<id>, which restores the full working session there.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, CheckCircle2, AlertTriangle, Clapperboard, MessageSquare, Film, ListOrdered, PenLine, Clock } from "lucide-react";
import { listJobs, type Job } from "../../lib/api";
import { useBrand } from "../../contexts/BrandContext";

const APP_META: Record<string, { label: string; icon: React.ElementType; path: string }> = {
  broll: { label: "B-Roll", icon: Film, path: "/workspace/apps/broll" },
  character_broll: { label: "Character B-Roll", icon: Clapperboard, path: "/workspace/apps/character-broll" },
  single_scene: { label: "Single Scene", icon: Film, path: "/workspace/apps/single-scene" },
  message_testing: { label: "Message Testing", icon: MessageSquare, path: "/workspace/apps/message-testing" },
  listicle: { label: "Listicle Builder", icon: ListOrdered, path: "/workspace/apps/listicle-builder" },
  copy_engine: { label: "Copy Engine", icon: PenLine, path: "/workspace/apps/copy-engine" },
};

function StatusChip({ job }: { job: Job }) {
  if (job.status === "queued" || job.status === "running") {
    return <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-cyan-300"><Loader2 size={11} className="animate-spin" /> RUNNING</span>;
  }
  if (job.status === "complete") {
    return <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-400"><CheckCircle2 size={11} /> DONE</span>;
  }
  if (job.status === "complete_with_errors") {
    return <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-amber-400"><AlertTriangle size={11} /> DONE · {job.errorCount} FAILED</span>;
  }
  return <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-rose-400"><AlertTriangle size={11} /> FAILED</span>;
}

function relTime(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function DashboardPage() {
  const { activeBrandId } = useBrand();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { jobs: rows } = await listJobs(activeBrandId);
        if (!cancelled) { setJobs(rows); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    const t = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [activeBrandId]);

  const running = (jobs ?? []).filter((j) => j.status === "queued" || j.status === "running");
  const finished = (jobs ?? []).filter((j) => j.status !== "queued" && j.status !== "running");

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-lg font-semibold text-white/90 mb-1">Dashboard</h1>
      <p className="text-xs text-white/40 font-mono mb-6">Generation jobs for this brand — running batches keep going even if you close the tab.</p>
      {error && <div className="text-xs text-rose-400 font-mono mb-4">{error}</div>}
      {jobs === null ? (
        <div className="flex items-center gap-2 text-white/40 text-sm"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : jobs.length === 0 ? (
        <div className="text-sm text-white/35">No jobs yet — start a generation in any app and it will show up here.</div>
      ) : (
        <div className="space-y-6">
          {[{ title: "Running", rows: running }, { title: "Recent", rows: finished }].map(({ title, rows }) =>
            rows.length === 0 ? null : (
              <section key={title}>
                <h2 className="text-[11px] font-mono uppercase tracking-wide text-white/35 mb-2">{title}</h2>
                <div className="space-y-2">
                  {rows.map((job) => {
                    const meta = APP_META[job.app] ?? APP_META.broll;
                    const Icon = meta.icon;
                    const pct = job.totalCount > 0 ? Math.round((job.doneCount + job.errorCount) / job.totalCount * 100) : 0;
                    return (
                      <Link key={job.id} href={`${meta.path}?job=${job.id}`}>
                        <a className="block rounded-lg border border-white/[0.07] bg-[#0D0F12] hover:border-white/20 transition-colors p-3">
                          <div className="flex items-center gap-3">
                            <Icon size={16} className="text-white/40 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm text-white/85">{job.title}</div>
                              <div className="text-[11px] font-mono text-white/35">{meta.label} · {job.doneCount + job.errorCount}/{job.totalCount} · <Clock size={9} className="inline -mt-0.5" /> {relTime(job.createdAt)}</div>
                            </div>
                            <StatusChip job={job} />
                          </div>
                          {(job.status === "queued" || job.status === "running") && (
                            <div className="mt-2 h-1 rounded bg-white/[0.06] overflow-hidden">
                              <div className="h-full bg-cyan-400/70 transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </a>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ),
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Route in App.tsx** — import `DashboardPage` and add ABOVE the products route:

```tsx
<Route path="/workspace/dashboard">
  <RequireAuth><WorkspaceLayout><DashboardPage /></WorkspaceLayout></RequireAuth>
</Route>
```

- [ ] **Step 3: Nav item in WorkspaceLayout.tsx** — add as the FIRST entry of the nav array (`LayoutDashboard` icon from lucide):

```ts
{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/workspace/dashboard", description: "Jobs overview" },
```

- [ ] **Step 4: Typecheck + build + eyeball on dev** — `pnpm check`, `pnpm build`; open `/workspace/dashboard` on dev → empty state renders.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/workspace/DashboardPage.tsx client/src/App.tsx client/src/components/WorkspaceLayout.tsx
git commit -m "feat(jobs): dashboard page, route, top-level nav entry"
```

---

### Task 8: Badge + completion toast (`useJobsPulse`)

**Files:**
- Create: `client/src/hooks/useJobsPulse.ts`
- Modify: `client/src/components/WorkspaceLayout.tsx`

- [ ] **Step 1: Create the hook**

```ts
/**
 * Polls the active brand's jobs every 15s (paused while the tab is hidden):
 *  - returns runningCount for the Dashboard nav badge;
 *  - fires a toast when a job the CURRENT USER created transitions from
 *    running to finished while they're anywhere in the workspace.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { listJobs, type Job } from "../lib/api";

export function useJobsPulse(brandId: string | null, currentUserId: string | null): number {
  const [runningCount, setRunningCount] = useState(0);
  const prevRunning = useRef<Map<string, Job>>(new Map());

  useEffect(() => {
    if (!brandId) { setRunningCount(0); prevRunning.current = new Map(); return; }
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const { jobs, runningCount: rc } = await listJobs(brandId);
        if (cancelled) return;
        setRunningCount(rc);
        const nowRunning = new Map(jobs.filter((j) => j.status === "queued" || j.status === "running").map((j) => [j.id, j]));
        for (const [id, prev] of prevRunning.current) {
          if (nowRunning.has(id)) continue;
          const finished = jobs.find((j) => j.id === id);
          if (!finished || finished.userId !== currentUserId) continue;
          if (finished.status === "complete") {
            toast.success(`${prev.title} — done`, { description: "Open the Dashboard to review the results." });
          } else {
            toast.error(`${prev.title} — finished with ${finished.errorCount} error(s)`, { description: "Open the Dashboard to retry failed items." });
          }
        }
        prevRunning.current = nowRunning;
      } catch { /* transient — next tick retries */ }
    };
    void tick();
    const t = setInterval(tick, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, [brandId, currentUserId]);

  return runningCount;
}
```

- [ ] **Step 2: Wire into WorkspaceLayout** — inside the layout component (it already has brand context + auth user available; check `useAuth()`/`useBrand()` usage at the top of the file):

```tsx
const runningJobs = useJobsPulse(activeBrandId ?? null, user?.id ?? null);
```
And on the Dashboard nav entry render, show the badge when `item.id === "dashboard" && runningJobs > 0`:
```tsx
<span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-cyan-400/20 text-cyan-300 text-[10px] font-mono px-1">
  {runningJobs}
</span>
```
(Match the exact JSX of the existing nav-item renderer — insert the badge inside the item row container.)

- [ ] **Step 3: Typecheck + build; visual check on dev.**
- [ ] **Step 4: Commit** — `git add client/src/hooks/useJobsPulse.ts client/src/components/WorkspaceLayout.tsx && git commit -m "feat(jobs): running badge + completion toast"`

---

### Task 9: B-roll pilot — batches create jobs; page polls job state

**Files:**
- Modify: `client/src/pages/workspace/BrollAppPage.tsx`

Keep `writeImagePrompts` / `writeVideoPrompts` (fast text calls) client-side as today; the JOB covers the expensive media generation. Item inputs are fully resolved fal payloads so executors stay generic.

- [ ] **Step 1: Add job state + input builders** (near the other state/hooks; import `createJob, getJob, type JobItem` from api, `useBrand` already present):

```ts
const [activeImageJobId, setActiveImageJobId] = useState<string | null>(null);
const [activeVideoJobId, setActiveVideoJobId] = useState<string | null>(null);

/** Same body as callImageModel minus the fetch — produces the job item input. */
function buildImageItemInput(shot: UiShot, prompt: string): Record<string, unknown> {
  const imageUrls = collectReferenceImagesForShot(shot);
  const hasImages = imageUrls.length > 0;
  return {
    shotId: shot.id,
    kind: "image",
    model: hasImages ? "fal-ai/nano-banana-pro/edit" : "fal-ai/flux-pro/v1.1",
    falInput: hasImages
      ? { prompt, image_urls: imageUrls, aspect_ratio: "9:16", num_images: 1, output_format: "jpeg" }
      : { prompt, aspect_ratio: "9:16", num_images: 1, output_format: "jpeg" },
  };
}

/** Same body as callVideoModel minus the fetch. */
function buildVideoItemInput(shot: UiShot, prompt: string): Record<string, unknown> {
  const productRefs = collectProductImageUrls();
  const imageUrls = [shot.imageUrl!, ...productRefs.filter((u) => u !== shot.imageUrl)];
  return {
    shotId: shot.id,
    kind: "video",
    model: "bytedance/seedance-2.0/fast/reference-to-video",
    falInput: {
      prompt, image_urls: imageUrls, duration: "5", aspect_ratio: "9:16",
      resolution: "720p", generate_audio: false,
    },
  };
}
```

- [ ] **Step 2: Replace `generateAllImages` body** (keep prompt-writing; job replaces the Promise.all):

```ts
async function generateAllImages() {
  const queue = uiShots.filter((s) => s.imageStatus === "idle" || s.imageStatus === "failed");
  if (queue.length === 0 || !activeBrandId || activeImageJobId) return;
  setPipelineError(null);
  try {
    const prompts = await writeImagePrompts(queue);
    queue.forEach((s, i) => patchShot(s.id, { imageStatus: "generating", imageError: undefined, imagePrompt: prompts[i] ?? "" }));
    const { job } = await createJob({
      app: "broll", type: "broll_images", brandId: activeBrandId,
      productId: selectedProductId ?? null,
      title: `B-roll images — ${selectedProduct?.name ?? "product"} · ${queue.length} shot(s)`,
      payload: buildSessionPayload(),
      items: queue.map((s, i) => ({ label: s.title, input: buildImageItemInput(s, prompts[i] ?? "") })),
    });
    setActiveImageJobId(job.id);
  } catch (err) {
    setPipelineError(err instanceof Error ? err.message : String(err));
  }
}
```

`buildSessionPayload()` — new helper next to the builders (the full-restore snapshot):

```ts
function buildSessionPayload(): Record<string, unknown> {
  return {
    productId: selectedProductId,
    productName: selectedProduct?.name ?? null,
    shots: uiShots.map((s) => ({
      id: s.id, shot_id: s.shot_id, type: s.type, userAdded: s.userAdded,
      title: s.title, description: s.description, location: s.location,
      imagePrompt: s.imagePrompt ?? null, imageUrl: s.imageUrl ?? null,
      imageApproval: s.imageApproval,
      videoPrompt: s.videoPrompt ?? null, videoUrl: s.videoUrl ?? null,
      videoApproval: s.videoApproval,
    })),
  };
}
```

- [ ] **Step 3: Replace `generateAllVideos` body** — mirror of Step 2 with `type: "broll_videos"`, queue filter unchanged (`imageApproval === "approved" && imageUrl && videoStatus not generating/ready`), prompts via `writeVideoPrompts`, items via `buildVideoItemInput`, `setActiveVideoJobId(job.id)`, per-shot `patchShot(s.id, { videoStatus: "generating", videoError: undefined, videoPrompt: prompts[i] ?? "" })`.

- [ ] **Step 4: Poll effect applying job items back onto shots**

```ts
// Poll the active job(s) and mirror item state onto shots. Runs while a job
// id is set; clears itself when the job reaches a terminal status.
useEffect(() => {
  const jobId = activeImageJobId ?? activeVideoJobId;
  if (!jobId) return;
  const isImage = jobId === activeImageJobId;
  let cancelled = false;
  const tick = async () => {
    try {
      const { job, items } = await getJob(jobId);
      if (cancelled) return;
      for (const it of items) applyItemToShot(it, isImage);
      if (job.status !== "queued" && job.status !== "running") {
        if (isImage) setActiveImageJobId(null); else setActiveVideoJobId(null);
      }
    } catch { /* transient; next tick */ }
  };
  void tick();
  const t = setInterval(tick, 2500);
  return () => { cancelled = true; clearInterval(t); };
}, [activeImageJobId, activeVideoJobId]);

function applyItemToShot(it: JobItem, isImage: boolean) {
  const shotId = (it.input as { shotId?: string }).shotId;
  if (!shotId) return;
  const url = it.output?.url;
  if (isImage) {
    if (it.status === "complete" && url) patchShot(shotId, { imageStatus: "ready", imageUrl: url });
    else if (it.status === "failed") patchShot(shotId, { imageStatus: "failed", imageError: it.error ?? "Generation failed" });
  } else {
    if (it.status === "complete" && url) patchShot(shotId, { videoStatus: "ready", videoUrl: url });
    else if (it.status === "failed") patchShot(shotId, { videoStatus: "failed", videoError: it.error ?? "Generation failed" });
  }
}
```

- [ ] **Step 5: Disable batch buttons while their job runs** — where the two buttons render, add `disabled={Boolean(activeImageJobId)}` / `disabled={Boolean(activeVideoJobId)}` alongside existing disabled conditions (also fixes accidental double-generate).

- [ ] **Step 6: Typecheck + dev smoke** — `pnpm check`; on dev: run a 2-shot batch, RELOAD the page mid-run, confirm the job finishes server-side (`GET /api/jobs/:id` or dashboard shows complete). Shots re-hydrate after Task 10's resume.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/workspace/BrollAppPage.tsx
git commit -m "feat(jobs): b-roll pilot — image/video batches run as durable jobs"
```

---

### Task 10: B-roll resume (`?job=` deep link + unfinished-session banner)

**Files:**
- Modify: `client/src/pages/workspace/BrollAppPage.tsx`

- [ ] **Step 1: Hydration helper** — rebuild page state from a job:

```ts
/** Restore full working state from a job: payload snapshot + item outputs. */
async function hydrateFromJob(jobId: string) {
  const { job, items } = await getJob(jobId);
  const payload = job.payload as { productId?: string | null; shots?: Array<Record<string, unknown>> };
  if (payload.productId && payload.productId !== selectedProductId) setSelectedProductId(payload.productId);
  const isImage = job.type === "broll_images";
  const byShot = new Map(items.map((it) => [(it.input as { shotId?: string }).shotId, it]));
  const restored: UiShot[] = (payload.shots ?? []).map((s) => {
    const it = byShot.get(s.id as string);
    const base: UiShot = {
      id: s.id as string, shot_id: s.shot_id as number, type: s.type as ShotType,
      userAdded: Boolean(s.userAdded), title: (s.title as string) ?? "", description: (s.description as string) ?? "",
      location: (s.location as string) ?? "",
      imageStatus: s.imageUrl ? "ready" : "idle", imageApproval: (s.imageApproval as Approval) ?? "pending",
      imageUrl: (s.imageUrl as string) ?? undefined, imagePrompt: (s.imagePrompt as string) ?? undefined,
      imageFeedback: "",
      videoStatus: s.videoUrl ? "ready" : "idle", videoApproval: (s.videoApproval as Approval) ?? "pending",
      videoUrl: (s.videoUrl as string) ?? undefined, videoPrompt: (s.videoPrompt as string) ?? undefined,
      videoFeedback: "",
    };
    if (!it) return base;
    const url = it.output?.url;
    if (isImage) {
      if (it.status === "complete" && url) return { ...base, imageStatus: "ready", imageUrl: url };
      if (it.status === "failed") return { ...base, imageStatus: "failed", imageError: it.error ?? undefined };
      if (it.status === "pending" || it.status === "running") return { ...base, imageStatus: "generating" };
    } else {
      if (it.status === "complete" && url) return { ...base, videoStatus: "ready", videoUrl: url };
      if (it.status === "failed") return { ...base, videoStatus: "failed", videoError: it.error ?? undefined };
      if (it.status === "pending" || it.status === "running") return { ...base, videoStatus: "generating" };
    }
    return base;
  });
  setUiShots(restored);
  if (job.status === "queued" || job.status === "running") {
    if (isImage) setActiveImageJobId(job.id); else setActiveVideoJobId(job.id);
  }
}
```

(Adjust `setUiShots` / `setSelectedProductId` to the page's actual setter names; `UiShot` fields must match the type at BrollAppPage.tsx:57 — extend the restored object if the type has extra required fields.)

- [ ] **Step 2: Mount effect for `?job=` + resume banner**

```ts
// Deep link from the dashboard: ?job=<id> restores that session.
useEffect(() => {
  const jobId = new URLSearchParams(window.location.search).get("job");
  if (jobId) void hydrateFromJob(jobId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

// Unfinished-session banner: newest queued/running broll job for this brand.
const [resumableJob, setResumableJob] = useState<Job | null>(null);
useEffect(() => {
  if (!activeBrandId) return;
  void listJobs(activeBrandId).then(({ jobs }) => {
    const j = jobs.find((x) => x.app === "broll" && (x.status === "queued" || x.status === "running"));
    setResumableJob(j ?? null);
  }).catch(() => {});
}, [activeBrandId]);
```

Banner JSX (top of the page, only when `resumableJob && !activeImageJobId && !activeVideoJobId`):

```tsx
<button
  type="button"
  onClick={() => { void hydrateFromJob(resumableJob.id); setResumableJob(null); }}
  className="mb-4 w-full rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-4 py-2.5 text-left text-sm text-cyan-200 hover:bg-cyan-400/15 transition-colors"
>
  A generation is still running: <span className="font-medium">{resumableJob.title}</span> — click to resume this session.
</button>
```

- [ ] **Step 3: Typecheck + dev smoke** — start a batch, close the tab, reopen the app → banner appears → click → shots restore with live statuses; also open via Dashboard row → same restore.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/workspace/BrollAppPage.tsx
git commit -m "feat(jobs): b-roll resume via ?job deep link + unfinished-session banner"
```

---

### Task 11: Single-shot regenerate → 1-item jobs

**Files:**
- Modify: `client/src/pages/workspace/BrollAppPage.tsx`

- [ ] **Step 1: Rewrite `regenerateImage`** — keep the existing prompt/feedback composition, replace the `callImageModel` call with a 1-item job (`type: "broll_images"`, `items: [{ label: target.title, input: buildImageItemInput(target, finalPrompt) }]`, `setActiveImageJobId(job.id)`); the poll effect from Task 9 delivers the result. Same for **`regenerateVideo`** with `buildVideoItemInput` + `setActiveVideoJobId`.
- [ ] **Step 2: Delete now-unused `callImageModel` / `callVideoModel` / `generateImageForShot` / `generateVideoForShot`** and the now-unused `generateImage`/`generateVideo` imports (typecheck tells you what's dead).
- [ ] **Step 3: Typecheck + dev smoke (regenerate one image with feedback).**
- [ ] **Step 4: Commit** — `git add client/src/pages/workspace/BrollAppPage.tsx && git commit -m "feat(jobs): single-shot regenerates run as 1-item jobs"`

---

### Task 12: Kill-and-resume integration check (dev)

No new files — a manual verification script of the core durability promise.

- [ ] **Step 1:** On dev, start a 4-shot image batch in B-roll. While items are mid-flight: `lsof -ti :3001 | xargs kill` (kills only the API; tsx watch restarts it).
- [ ] **Step 2:** Watch the API log. NOTE: dev boot marks orphans failed by design — for THIS test only, temporarily run the sweep with `{ resume: true }` (edit, save, revert) or verify on a prod-like `NODE_ENV=production pnpm dev:server`. Expected log: `[jobs] boot sweep: resuming "<title>"` and the job completing; already-complete items untouched (attempts unchanged).
- [ ] **Step 3:** Confirm in the dashboard the job reaches `complete` and the B-roll resume banner restores it.
- [ ] **Step 4:** Revert any temporary edit; `git status` clean except intended files.

---

### Task 13: Final gates + ship

- [ ] `pnpm check` → 0. `pnpm exec vitest run --root .` → all pass. `pnpm build` → success.
- [ ] Full dev walkthrough: images batch → reload mid-run → resume banner → videos batch → dashboard rows/badge/toast → retry a failed item from the API.
- [ ] Commit any stragglers (explicit paths), push `main`, verify Railway deploy healthy (`/api/health`), run one real 2-shot batch on prod as smoke.

## Self-review notes

- Spec coverage: schema (T1), runner+policy (T2-4), API (T5), client API (T6), dashboard+nav (T7), badge+toast (T8), pilot batches (T9), full-state resume (T10), 1-item regenerates (T11), durability proof (T12), gates (T13). Approved-finals-to-Assets: untouched by design (existing flow). Fast-follow apps: separate plans.
- Type consistency: `kickJob/registerJobType/isRegisteredJobType/sweepOrphanedJobs/classifyJobError/seedanceToKlingFallback` used identically across T2-T5; client `Job/JobItem/createJob/listJobs/getJob/retryJobItem` across T6-T10; item input `{ shotId, kind, model, falInput }` across T4/T9/T10.
- Known judgment calls encoded: prompt-writing stays client-side (fast, cheap; media generation is the durable part); executors log their own `generations` rows (no HTTP self-calls); dev sweep marks failed (tsx flapping).
