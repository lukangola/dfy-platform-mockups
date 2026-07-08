/**
 * Durable generation jobs API.
 *   POST /api/jobs                         → create + start a job
 *   GET  /api/jobs?brandId=<id>            → { jobs: [...], runningCount } for the dashboard/badge
 *   GET  /api/jobs/:id                     → { job, items } — poll target
 *   POST /api/jobs/:id/items/:itemId/retry → reset one failed item + re-kick
 * All brand-gated via canSeeBrand. Spec: docs/superpowers/specs/2026-07-08-generation-jobs-design.md
 */
import { and, asc, desc, eq, inArray, sql as sqlTag } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { db, schema } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { canSeeBrand } from "../lib/brandAccess.js";
import { isRegisteredJobType, kickJob } from "../lib/jobRunner.js";

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

const JOB_APPS = ["broll", "character_broll", "single_scene", "message_testing", "listicle", "copy_engine", "static_ads"] as const;

// ── Listicle projection ─────────────────────────────────────────────
//
// Listicle builds run server-side with their OWN status machine
// (listicles.status + listicleImages.imageStatus) — they never create jobs
// rows. For the dashboard we project them READ-ONLY into the jobs list as
// pseudo-Job rows with id "listicle-<uuid>". The client parses the prefix
// and deep-links back into the Listicle Builder with ?listicle=<id> instead
// of ?job=<id>. No writes to the listicles pipeline happen here.

/** listicles.status → job status. drafting/analyzing/images/rendering are in-flight. */
function listicleJobStatus(status: string): "running" | "complete" | "failed" {
  if (status === "ready" || status === "deployed") return "complete";
  if (status === "failed") return "failed";
  return "running";
}

/**
 * Map one listicle row (+ its product name and per-section image counts)
 * onto the exact serialized shape of a jobs row so the client's Job type
 * fits unchanged.
 */
function projectListicleAsJob(
  row: schema.Listicle,
  productName: string | null,
  counts: { total: number; ready: number; failed: number } | undefined,
): schema.Job {
  const status = listicleJobStatus(row.status);
  const terminal = status !== "running";
  return {
    id: `listicle-${row.id}`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // The listicles table has no finishedAt; updatedAt is the closest
    // "when it reached this state" timestamp for terminal rows.
    finishedAt: terminal ? row.updatedAt : null,
    brandId: row.brandId,
    // null userId also suppresses useJobsPulse completion toasts for listicles
    // (creator-filtered) — intentional for the read-only projection.
    userId: null,
    productId: row.productId,
    app: "listicle",
    type: "listicle_build",
    status,
    title: `Listicle — ${productName ?? "untitled"}`,
    payload: { listicleId: row.id, stage: row.status },
    totalCount: counts?.total ?? 0,
    doneCount: counts?.ready ?? 0,
    errorCount: counts?.failed ?? 0,
    error: row.error,
  };
}

/** Fetch the brand's recent listicles projected as pseudo-Job rows. */
async function listListicleJobs(brandId: string): Promise<schema.Job[]> {
  const rows = await db
    .select({ listicle: schema.listicles, productName: schema.products.name })
    .from(schema.listicles)
    .leftJoin(schema.products, eq(schema.products.id, schema.listicles.productId))
    .where(eq(schema.listicles.brandId, brandId))
    .orderBy(desc(schema.listicles.createdAt))
    .limit(20);
  if (rows.length === 0) return [];
  const countRows = await db
    .select({
      listicleId: schema.listicleImages.listicleId,
      total: sqlTag<number>`count(*)::int`,
      ready: sqlTag<number>`count(*) filter (where ${schema.listicleImages.imageStatus} = 'ready')::int`,
      failed: sqlTag<number>`count(*) filter (where ${schema.listicleImages.imageStatus} = 'failed')::int`,
    })
    .from(schema.listicleImages)
    .where(inArray(schema.listicleImages.listicleId, rows.map((r) => r.listicle.id)))
    .groupBy(schema.listicleImages.listicleId);
  const countsById = new Map(countRows.map((c) => [c.listicleId, c]));
  return rows.map((r) => projectListicleAsJob(r.listicle, r.productName, countsById.get(r.listicle.id)));
}

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
    // 404 (not 403) on denial — house convention (see brandAccess.ts): the
    // existence of a brand must not leak to users who can't see it.
    if (!(await canSeeBrand(user.id, role, body.brandId))) return sendError(res, 404, "Brand not found");

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
    if (!(await canSeeBrand(user.id, role, brandId))) return sendError(res, 404, "Brand not found");
    // Fetch the jobs rows and the brand's listicle builds (projected as
    // read-only pseudo-jobs) in parallel — the queries are independent.
    // Then merge and re-sort the combined list with the same
    // running-first-then-newest order the jobs query uses (the DB sort
    // only covered the jobs rows).
    const [rows, listicleJobs] = await Promise.all([
      db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.brandId, brandId))
        .orderBy(
          // running/queued first, then newest
          sqlTag`case when ${schema.jobs.status} in ('queued','running') then 0 else 1 end`,
          desc(schema.jobs.createdAt),
        )
        .limit(50),
      listListicleJobs(brandId),
    ]);
    const isActive = (s: string) => s === "queued" || s === "running";
    const merged = [...rows, ...listicleJobs].sort((a, b) => {
      const activeDelta = (isActive(a.status) ? 0 : 1) - (isActive(b.status) ? 0 : 1);
      if (activeDelta !== 0) return activeDelta;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    const runningCount = merged.filter((j) => isActive(j.status)).length;
    res.json({ jobs: merged, runningCount });
  } catch (err) {
    console.error("[jobs] list failed:", err);
    sendError(res, 500, err instanceof Error ? err.message : String(err));
  }
});

jobsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    // Listicle projections ("listicle-<uuid>") are dashboard-only pseudo-jobs
    // with no jobs/job_items rows. 404 before the uuid lookup below — drizzle
    // eq() on a uuid column with a non-uuid string THROWS (22P02) rather than
    // returning no rows, which would surface as a 500.
    if (req.params.id.startsWith("listicle-")) return sendError(res, 404, "Job not found");
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, req.params.id)).limit(1);
    if (!job) return sendError(res, 404, "Job not found");
    const { user, role } = req.auth!;
    // 404 (not 403) on denial — deny knowledge of the job entirely (no-leak convention).
    if (!(await canSeeBrand(user.id, role, job.brandId))) return sendError(res, 404, "Job not found");
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
    // Listicle projections are read-only — retries happen inside the Listicle
    // Builder, never through the jobs API. Also avoids the uuid-parse throw
    // (see GET /:id above).
    if (req.params.id.startsWith("listicle-")) return sendError(res, 404, "Job not found");
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, req.params.id)).limit(1);
    if (!job) return sendError(res, 404, "Job not found");
    const { user, role } = req.auth!;
    // 404 (not 403) on denial — deny knowledge of the job entirely (no-leak convention).
    if (!(await canSeeBrand(user.id, role, job.brandId))) return sendError(res, 404, "Job not found");
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
