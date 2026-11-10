/**
 * Performance dashboard routes — managers + admins, brand-scoped.
 *
 *   GET  /api/performance/config?brandId=        → { config, sync[] }   economics, source, connection state, freshness
 *   PUT  /api/performance/config?brandId=        → { config }           save config / credentials (secrets encrypted at rest)
 *   POST /api/performance/test?brandId=&source=  → { result }           credential check against Shopify / Meta / Google
 *   POST /api/performance/sync?brandId=[&full=1] → 202 { started }      run a sync now (full = wipe + backfill)
 *   GET  /api/performance/status?brandId=        → { sync[], running }  poll while a sync runs
 *   GET  /api/performance/hours?brandId=&from=&to= → { dataset, source } hourly buckets in [from, to]
 *
 * Feature-flagged: in production the router answers 404 unless FEATURE_PERFORMANCE=1.
 */
import { eq } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { db, schema } from "../lib/db.js";
import { isDev } from "../lib/env.js";
import { requireManager } from "../lib/auth.js";
import { canSeeBrand } from "../lib/brandAccess.js";
import { getClientConfig, publicConfig, saveClientConfig, type ConfigPatch } from "../lib/performance/config.js";
import { getDataSource } from "../lib/performance/source.js";
import { clearBrandData, getSyncStates, isSyncRunning, runBrandSync } from "../lib/performance/sync.js";
import { testShopify } from "../lib/performance/shopify.js";
import { testMeta } from "../lib/performance/meta.js";
import { testGoogle } from "../lib/performance/googleAds.js";
import { hasSecretsKey } from "../lib/performance/secrets.js";

export const performanceRouter: Router = Router();

export const performanceEnabled = (): boolean => isDev || process.env.FEATURE_PERFORMANCE === "1";

performanceRouter.use((_req, res, next) => {
  if (!performanceEnabled()) { res.status(404).json({ error: "Not found" }); return; }
  next();
});
performanceRouter.use(requireManager);

/** Resolves the brand for the request, enforcing team + brand visibility. 404 on denial (no existence leak). */
async function loadBrand(req: Request, res: Response) {
  const brandId = typeof req.query.brandId === "string" ? req.query.brandId : "";
  if (!brandId) { res.status(400).json({ error: "brandId is required" }); return null; }
  const auth = req.auth!;
  const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
  if (!brand || brand.teamId !== auth.team.id || !(await canSeeBrand(auth.user.id, auth.role, brandId))) {
    res.status(404).json({ error: "Brand not found" });
    return null;
  }
  return brand;
}

function shapeSync(rows: Awaited<ReturnType<typeof getSyncStates>>) {
  return rows.map((r) => ({
    source: r.source, status: r.status, lastStartedAt: r.lastStartedAt, lastSyncedAt: r.lastSyncedAt,
    rowsTotal: r.rowsTotal, error: r.error,
  }));
}

function fail(res: Response, err: unknown) {
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
}

performanceRouter.get("/config", async (req, res) => {
  try {
    const brand = await loadBrand(req, res); if (!brand) return;
    const config = await getClientConfig(brand.id, brand.name);
    res.json({ config: publicConfig(config), sync: shapeSync(await getSyncStates(brand.id)), running: isSyncRunning(brand.id), secretsKeySet: hasSecretsKey() });
  } catch (err) { fail(res, err); }
});

performanceRouter.put("/config", async (req, res) => {
  try {
    const brand = await loadBrand(req, res); if (!brand) return;
    const patch = (req.body ?? {}) as ConfigPatch;
    const touchesSecret = ["shopifyToken", "shopifyClientSecret", "metaToken", "googleDeveloperToken", "googleClientSecret", "googleRefreshToken"].some((k) => typeof (patch as Record<string, unknown>)[k] === "string" && (patch as Record<string, unknown>)[k] !== "");
    if (touchesSecret && !hasSecretsKey()) {
      res.status(400).json({ error: "CONNECTIONS_KEY is not set in .env.local — credentials can't be stored encrypted. Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"" });
      return;
    }
    await saveClientConfig(brand.id, patch);
    const config = await getClientConfig(brand.id, brand.name);
    res.json({ config: publicConfig(config) });
  } catch (err) { fail(res, err); }
});

performanceRouter.post("/test", async (req, res) => {
  try {
    const brand = await loadBrand(req, res); if (!brand) return;
    const source = String(req.query.source ?? "");
    const config = await getClientConfig(brand.id, brand.name);
    const result = source === "shopify" ? await testShopify(config)
      : source === "meta" ? await testMeta(config)
      : source === "google" ? await testGoogle(config)
      : null;
    if (!result) { res.status(400).json({ error: "source must be shopify | meta | google" }); return; }
    res.json({ result });
  } catch (err) {
    // Credential problems are expected here — report as 200 with ok:false so the UI shows the message inline.
    res.json({ result: { ok: false, error: err instanceof Error ? err.message : String(err) } });
  }
});

performanceRouter.post("/sync", async (req, res) => {
  try {
    const brand = await loadBrand(req, res); if (!brand) return;
    if (isSyncRunning(brand.id)) { res.status(202).json({ started: false, running: true }); return; }
    const full = req.query.full === "1";
    if (full) await clearBrandData(brand.id);
    void runBrandSync(brand.id, brand.name, { full });
    res.status(202).json({ started: true, running: true, full });
  } catch (err) { fail(res, err); }
});

performanceRouter.get("/status", async (req, res) => {
  try {
    const brand = await loadBrand(req, res); if (!brand) return;
    res.json({ sync: shapeSync(await getSyncStates(brand.id)), running: isSyncRunning(brand.id) });
  } catch (err) { fail(res, err); }
});

performanceRouter.get("/hours", async (req, res) => {
  try {
    const brand = await loadBrand(req, res); if (!brand) return;
    const from = Number(req.query.from), to = Number(req.query.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      res.status(400).json({ error: "from and to must be epoch milliseconds with to >= from" }); return;
    }
    const config = await getClientConfig(brand.id, brand.name);
    const dataset = await getDataSource(config).fetchHours(from, to);
    res.json({ dataset, source: config.dataSource });
  } catch (err) { fail(res, err); }
});
