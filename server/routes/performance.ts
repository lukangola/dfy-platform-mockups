/**
 * Performance dashboard routes — managers + admins, brand-scoped.
 *
 *   GET /api/performance/config?brandId=   → { config }   per-client economics + source
 *   GET /api/performance/hours?brandId=&from=&to=
 *                                          → { dataset }  hourly buckets in [from, to]
 *
 * Feature-flagged: in production the router answers 404 unless
 * FEATURE_PERFORMANCE=1, so the section can sit on dev/preview without
 * touching production users. In dev it is always on.
 */
import { eq } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { db, schema } from "../lib/db.js";
import { isDev } from "../lib/env.js";
import { requireManager } from "../lib/auth.js";
import { canSeeBrand } from "../lib/brandAccess.js";
import { getClientConfig, publicConfig } from "../lib/performance/config.js";
import { getDataSource } from "../lib/performance/source.js";

export const performanceRouter: Router = Router();

export const performanceEnabled = (): boolean => isDev || process.env.FEATURE_PERFORMANCE === "1";

performanceRouter.use((_req, res, next) => {
  if (!performanceEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
});
performanceRouter.use(requireManager);

/** Resolves the brand for the request, enforcing team + brand visibility. 404 on denial (no existence leak). */
async function loadBrand(req: Request, res: Response) {
  const brandId = typeof req.query.brandId === "string" ? req.query.brandId : "";
  if (!brandId) {
    res.status(400).json({ error: "brandId is required" });
    return null;
  }
  const auth = req.auth!;
  const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
  if (!brand || brand.teamId !== auth.team.id || !(await canSeeBrand(auth.user.id, auth.role, brandId))) {
    res.status(404).json({ error: "Brand not found" });
    return null;
  }
  return brand;
}

performanceRouter.get("/config", async (req, res) => {
  try {
    const brand = await loadBrand(req, res);
    if (!brand) return;
    res.json({ config: publicConfig(getClientConfig(brand.id, brand.name)) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

performanceRouter.get("/hours", async (req, res) => {
  try {
    const brand = await loadBrand(req, res);
    if (!brand) return;
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      res.status(400).json({ error: "from and to must be epoch milliseconds with to >= from" });
      return;
    }
    const config = getClientConfig(brand.id, brand.name);
    const dataset = await getDataSource(config).fetchHours(from, to);
    res.json({ dataset, source: config.dataSource });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
