/**
 * Durable generation jobs API.
 *   POST /api/jobs                         → create + start a job
 *   GET  /api/jobs?brandId=<id>            → { jobs: [...], runningCount } for the dashboard/badge
 *   GET  /api/jobs/:id                     → { job, items } — poll target
 *   POST /api/jobs/:id/items/:itemId/retry → reset one failed item + re-kick
 * All brand-gated via canSeeBrand. Spec: docs/superpowers/specs/2026-07-08-generation-jobs-design.md
 */
import { and, asc, desc, eq, sql as sqlTag } from "drizzle-orm";
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
