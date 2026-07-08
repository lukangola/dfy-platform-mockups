# Durable Generation Jobs + Dashboard — Design

**Date:** 2026-07-08
**Status:** Approved (Marcus, 2026-07-08)

## Problem

Every media app (B-roll, Character B-roll, Single Scene, Message Testing) orchestrates
its generation batches **in the browser**: the page loops over shots with
`Promise.all(queue.map(...))`, each iteration a blocking `POST /api/generate/image|video`.
Closing/reloading the tab kills the loop mid-batch; in-flight results and all client
state (which shots finished, URLs, approvals) evaporate. A real client (Bryan / Puzzle
Makeup) lost a full B-roll image session this way. Compounding it, transient provider
failures (fal Seedance outage) and model policy refusals (Seedance 2.0 rejects reference
images containing realistic human faces) surface as raw errors with no retry or fallback.

## Goals

1. Generation batches are **server-side jobs** that keep running when the user leaves,
   reloads, or switches apps — and survive server deploys/restarts.
2. A **top-level Dashboard** nav entry lists the active brand's jobs (running first) and
   lets users **jump back into a job with the full working state restored** in the
   source app.
3. Retry/fallback policy is centralized in the job runner:
   - transient provider errors (gateway/5xx/timeout/429) → bounded retry with backoff;
   - Seedance likeness/content 422 on `broll_video` → automatic same-input fallback to
     Kling v3 (recorded per item);
   - a failed item never aborts the batch (`complete_with_errors`, not all-or-nothing).
4. All **future generation features must run on this system**.

## Non-goals (v1)

- Product research / reference sheets / mechanism / Ad Console pulls — they keep their
  existing async + boot-sweep machinery.
- Cancel button (cheap to add later: runner checks a `cancelled` flag between items).
- Cross-brand dashboard (active brand only, per decision).
- External queue infrastructure (Redis/BullMQ/pg-boss). The jobs API is the seam; a
  queue can replace the in-process runner later without touching the apps.
- Auto-saving every output to Brand Assets. **Only explicitly approved finals** go to
  Assets (B-roll: the finished videos, never intermediate images) — unchanged from
  today's approve/save flow. Everything else lives on the job record.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Scope v1 | Generic system; **pilot = standard B-roll**; fast-follow: Character B-roll, Single Scene, Message Testing, Listicle Builder, Copy Engine; all future generation apps mandatory |
| Resume depth | **Full working state**: job payload snapshots the session at trigger time; outputs land on items; app reconstructs UI from job |
| Dashboard scope | **Active brand only**, top-level nav entry |
| Affordances v1 | Running-count badge on nav item; completion/failure toast anywhere in workspace; per-item retry. No cancel. |
| Architecture | **A: DB-backed jobs + in-process runner + boot resume** (no new infra; guarded job claiming built in for future multi-instance) |

## Architecture

### Data model (drizzle, new migration)

```
jobs
  id            uuid pk default gen_random_uuid()
  created_at    timestamptz not null default now()
  updated_at    timestamptz not null default now()
  finished_at   timestamptz
  brand_id      uuid not null            -- access-gated via canSeeBrand
  user_id       uuid                     -- creator (from req.auth)
  product_id    uuid                     -- soft ref, nullable
  app           text not null            -- "broll" | "character_broll" | "single_scene"
                                         -- | "message_testing" | "listicle" | "copy_engine"
  type          text not null            -- runner registry key, e.g. "broll_images", "broll_videos"
  status        text not null default 'queued'
                                         -- queued | running | complete | complete_with_errors | failed
  title         text not null            -- "B-roll videos — The Overachiever · 12 clips"
  payload       jsonb not null           -- full session snapshot at trigger time (see below)
  total_count   int not null default 0   -- denormalized for cheap dashboard/badge queries
  done_count    int not null default 0
  error_count   int not null default 0
  error         text                     -- job-fatal error only (e.g. claim/setup failure)

job_items
  id            uuid pk
  job_id        uuid not null references jobs(id)
  idx           int not null             -- stable ordering
  label         text not null            -- shot title
  status        text not null default 'pending'  -- pending | running | complete | failed
  attempts      int not null default 0
  input         jsonb not null           -- per-item input (prompt, reference image urls, model)
  output        jsonb                    -- { imageUrl | videoUrl, model, durationMs, generationId }
  error         text
  started_at    timestamptz
  finished_at   timestamptz
  index on (job_id), index on jobs (brand_id, status, created_at)
```

`payload` for the B-roll pilot: `{ productId, productName, settings: { imageModel,
videoModel, aspect }, shots: [{ shotId, title, category, imagePrompt?, videoPrompt?,
referenceImageUrl? }] }` — enough to redraw the page exactly. The `generations` table
keeps logging every model call as today (accounting unchanged); items link back via
`output.generationId`.

### Jobs API (`server/routes/jobs.ts`, mounted at `/api/jobs`, requireAuth)

- `POST /api/jobs` `{ app, type, brandId, productId?, title, payload, items: [{ label, input }] }`
  → validates brand access + registry type, inserts job + items, fire-and-forgets the
  runner, returns the job. 400 on unknown `type`; 403 via canSeeBrand.
- `GET /api/jobs?brandId=<id>&limit=50` → job list for the dashboard (no items), newest
  first, running first. Also returns `runningCount` for the nav badge.
- `GET /api/jobs/:id` → job + items; the poll target for dashboard rows and app resume.
- `POST /api/jobs/:id/items/:itemId/retry` → resets one failed item to pending and
  re-kicks the runner for that job if idle. Guarded: only `failed` items.

### Runner (`server/lib/jobRunner.ts`)

- **Registry:** `registerJobType(type, executor)` where
  `executor(item, payload, ctx) → Promise<output jsonb>` performs exactly ONE item.
  Executors for the pilot live in `server/lib/jobExecutors/broll.ts` and call the
  existing `generateImage` / `generateVideo`.
- **Claiming:** `UPDATE jobs SET status='running' WHERE id=$1 AND status IN
  ('queued','running') RETURNING id` — single-instance safe today, multi-instance
  safe later.
- **Loop:** processes pending items with a small concurrency pool (3), persisting each
  item transition (running → complete/failed + counters on the job row) immediately.
- **Per-item policy:**
  - transient (HTTP 5xx / gateway / timeout / 429 / fal "unavailable") → retry up to 2×
    with 2s/6s backoff (attempts tracked);
  - `broll_video` Seedance 422 matching likeness/content-checker text → one fallback
    attempt on `fal-ai/kling-video/v3/standard/image-to-video` with the same inputs;
    `output.model` records what actually rendered;
  - other 4xx → item `failed` with the formatted error; loop continues.
- **Completion:** all items terminal → job `complete` (0 errors) or
  `complete_with_errors`; `finished_at` set. Job-fatal setup errors → `failed`.
- **Boot resume:** boot sweep (same idiom as research/mechanism sweeps) re-kicks every
  job in `queued`/`running` on server start; completed items are skipped by status, so
  resume is idempotent. Production resumes; dev marks interrupted jobs `failed` with
  "interrupted by dev restart" (tsx-watch flapping, same precedent as research sweep).

### Dashboard (`client/src/pages/workspace/DashboardPage.tsx`, `/workspace/dashboard`)

- First entry in the nav ("Dashboard"). Active-brand scope.
- Running jobs on top with live progress (`done/total`, thin progress bar, per-item
  status on expand), then recent finished/failed (last 50). Row: app icon · title ·
  progress · status chip · creator · relative time · **Open** → deep link
  `/workspace/apps/broll?job=<id>`.
- Nav badge: running count from `GET /api/jobs?brandId=` polled every 15s by a small
  hook in WorkspaceLayout (only while authenticated; stops when tab hidden).
- Toast: the same WorkspaceLayout poller detects "a job I created transitioned to
  finished since last poll" → toast (success or error) with a jump link. In-app only.

### Pilot: B-roll app migration

- "Generate all images" / "Generate all videos" build the payload + item list and
  `POST /api/jobs` instead of looping in the page; the page then polls
  `GET /api/jobs/:id` (2.5s, the codebase's established cadence) and renders shots from
  job state. Single-shot regenerate-with-feedback becomes a 1-item job of the same type.
- Resume: on mount with `?job=<id>` → load job, reconstruct state. On mount without it →
  if an unfinished job exists for this brand+app, show a "Resume session" banner.
- Approved finals: the existing approve/save-to-Brand-Assets flow is untouched.

### Fast-follows (each its own small PR, same API)

Character B-roll → Single Scene → Message Testing (image compose step) → Listicle
Builder (already server-side: register its existing pipeline states so it appears on
the dashboard; jump-in = its existing page) → Copy Engine.

## Failure modes considered

- Deploy mid-batch → boot sweep resumes; done items skipped. (Deploys pause jobs ~30s.)
- fal outage → bounded per-item retries; if still failing, item fails, batch finishes,
  user retries failed items individually later.
- Double-click "Generate" → the page disables the button while a job for this app+product
  is queued/running (also mitigates Bryan's accidental-generate complaint).
- Server dies mid-item → item stays `running` in DB; boot sweep resets stale `running`
  items (attempts++ preserved) and re-runs them.
- Multi-instance future → guarded claim + per-item status transitions are already safe.

## Testing

- Unit (vitest, colocated): retry/fallback classification; item state machine; resume
  idempotency (mock executors — no live fal).
- Integration on dev: create a 4-item job with a slow mock executor, restart the dev
  server mid-run, assert the job completes after resume (manual script).
- UI smoke on dev: B-roll pilot generates via job, page reload restores state,
  dashboard shows progress, badge + toast fire.
- Gates: `pnpm check`, full vitest, `pnpm build` before every commit.
