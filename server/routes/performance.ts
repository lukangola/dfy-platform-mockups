/**
 * Performance dashboard routes — managers + admins, brand-scoped.
 *
 *   GET  /api/performance/config?brandId=        → { config, sync[] }   economics, source, connection state, freshness
 *   PUT  /api/performance/config?brandId=        → { config }           save config / credentials (secrets encrypted at rest)
 *   POST /api/performance/test?brandId=&source=  → { result }           credential check against Shopify / Meta / Google
 *   POST /api/performance/sync?brandId=[&full=1] → 202 { started }      run a sync now (full = wipe + backfill)
 *   GET  /api/performance/status?brandId=        → { sync[], running }  poll while a sync runs
 *   GET  /api/performance/hours?brandId=&from=&to= → { dataset, source } hourly buckets in [from, to]
 *   GET  /api/performance/shopify/install?brandId=&origin= → 302 to Shopify's authorize page (Partner app install flow)
 *   GET  /api/performance/shopify/callback?code&hmac&shop&state → stores the token, 302 back to the dashboard
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
import { REQUIRED_SCOPES, forgetShopifyToken, testShopify } from "../lib/performance/shopify.js";
import { createShopifyInstallUrl, exchangeShopifyCode, shopifyShopHost, storeShopifyTokens, takeShopifyInstallState, verifyShopifyCallbackHmac } from "../lib/performance/shopifyOAuth.js";
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

/**
 * Shopify install flow for an app that lives in a Partner organization (see shopifyOAuth.ts).
 * `origin` is the browser's origin (the app is reached through the Vite proxy, so the API can't
 * derive it from the request); it must match the redirect URL entered in the app's settings.
 */
performanceRouter.get("/shopify/install", async (req, res) => {
  try {
    const brand = await loadBrand(req, res); if (!brand) return;
    const config = await getClientConfig(brand.id, brand.name);
    const { shopDomain, clientId, clientSecret } = config.shopify;
    if (!shopDomain || !clientId || !clientSecret) { res.status(400).json({ error: "Save the shop domain, Client ID and Client secret first" }); return; }
    const origin = process.env.PUBLIC_APP_URL ?? (typeof req.query.origin === "string" ? req.query.origin : "");
    res.redirect(302, createShopifyInstallUrl({ brandId: brand.id, shopDomain, clientId, scopes: REQUIRED_SCOPES, origin }));
  } catch (err) { fail(res, err); }
});

performanceRouter.get("/shopify/callback", async (req, res) => {
  const q = req.query as Record<string, unknown>;
  const pending = takeShopifyInstallState(typeof q.state === "string" ? q.state : "");
  if (!pending) {
    res.status(400).type("text/plain").send("This Shopify install link has expired or was already used. Go back to Inana and click \"Install on store\" again.");
    return;
  }
  const back = (params: Record<string, string>) => res.redirect(302, `${pending.origin}/workspace/performance?${new URLSearchParams(params).toString()}`);
  try {
    const auth = req.auth!;
    const [brand] = await db.select().from(schema.brands).where(eq(schema.brands.id, pending.brandId)).limit(1);
    if (!brand || brand.teamId !== auth.team.id || !(await canSeeBrand(auth.user.id, auth.role, brand.id))) throw new Error("Brand not found");
    const config = await getClientConfig(brand.id, brand.name);
    const { shopDomain, clientId, clientSecret } = config.shopify;
    if (!shopDomain || !clientId || !clientSecret) throw new Error("Shopify credentials were changed while installing — save them and try again");
    if (!verifyShopifyCallbackHmac(q, clientSecret)) throw new Error("Shopify's callback signature did not match the Client secret");
    const shop = typeof q.shop === "string" ? q.shop.toLowerCase() : "";
    if (shop !== pending.shop || shop !== shopifyShopHost(shopDomain)) throw new Error(`The install came back from ${shop || "an unknown shop"}, expected ${pending.shop}`);
    const code = typeof q.code === "string" ? q.code : "";
    if (!code) throw new Error("Shopify did not return an authorization code");
    const tokens = await exchangeShopifyCode(shop, clientId, clientSecret, code);
    await storeShopifyTokens(brand.id, tokens, true);
    forgetShopifyToken(brand.id);
    back({ shopify: "installed" });
  } catch (err) {
    back({ shopify: "error", message: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
  }
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
