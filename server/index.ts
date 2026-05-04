import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { env, isDev } from "./lib/env.js";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./lib/db.js";
import { attachAuth, getOrCreateDefaultTeam } from "./lib/auth.js";
import { ingestCharacterLibrary } from "./lib/characterIngest.js";
import { backfillCharacterSeedancePrep, prepareCharacterForSeedance } from "./lib/characterSeedancePrep.js";
import { ingestStaticAdLibrary } from "./lib/staticAdIngest.js";
import { authRouter } from "./routes/auth.js";
import { brandAssetsRouter } from "./routes/brandAssets.js";
import { brandsRouter } from "./routes/brands.js";
import { charactersRouter } from "./routes/characters.js";
import { generateRouter } from "./routes/generate.js";
import { teamRouter } from "./routes/team.js";
import { isNull } from "drizzle-orm";
import { messageTestingRouter } from "./routes/messageTesting.js";
import { productsRouter } from "./routes/products.js";
import { staticAdsRouter } from "./routes/staticAds.js";
import { staticAdsIterationsRouter } from "./routes/staticAdsIterations.js";
import { runDeconstruction, runNicheClassification, staticAdReferencesRouter } from "./routes/staticAdReferences.js";
import { uploadsRouter } from "./routes/uploads.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // 20 MB gives headroom above the 8 MB raw-image cap in upload-image —
  // base64 encoding adds ~33%, so an 8 MB image becomes ~10.7 MB on the wire.
  app.use(express.json({ limit: "20mb" }));

  // Mount globally so every downstream handler has `req.auth` (or null).
  // Auth-required endpoints opt in via the requireAuth / requireAdmin
  // middleware in their route definitions.
  app.use(attachAuth);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, env: env.NODE_ENV });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/team", teamRouter);
  app.use("/api/generate", generateRouter);
  app.use("/api/brands", brandsRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/message-testing", messageTestingRouter);
  app.use("/api/brand-assets", brandAssetsRouter);
  app.use("/api/characters", charactersRouter);
  app.use("/api/static-ad-references", staticAdReferencesRouter);
  app.use("/api/static-ads", staticAdsRouter);
  app.use("/api/static-ads-iterations", staticAdsIterationsRouter);
  app.use("/api/uploads", uploadsRouter);

  // Dev: API-only on API_PORT. Vite serves the UI and proxies /api/* here.
  // Prod: same process also serves built assets.
  if (!isDev) {
    const staticPath = path.resolve(__dirname, "public");
    app.use(express.static(staticPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(staticPath, "index.html"));
    });
  }

  server.listen(env.API_PORT, () => {
    console.log(`[api] listening on http://localhost:${env.API_PORT}/ (${env.NODE_ENV})`);
    if (isDev) console.log(`[api] Vite dev server proxies /api/* here. Run both via \`pnpm dev\`.`);
  });

  // Scan the static-ad library folder once on boot, then fire deconstruction
  // and niche classification jobs for any new or changed files. Runs after
  // `listen` so the server is already accepting traffic while jobs catch up in
  // the background. After ingest, also backfill niches for any existing rows
  // still marked "unassigned" / "other" so the filter UI gets populated
  // without the user clicking the backfill endpoint.
  void (async () => {
    try {
      const ids = await ingestStaticAdLibrary();
      if (ids.length > 0) {
        console.log(`[static-ads] ingested ${ids.length} new/updated reference(s)`);
        for (const id of ids) {
          void runDeconstruction(id);
          void runNicheClassification(id);
        }
      }

      const unclassified = await db
        .select({ id: schema.staticAdReferences.id })
        .from(schema.staticAdReferences)
        .where(inArray(schema.staticAdReferences.niche, ["unassigned", "other", ""]));
      if (unclassified.length > 0) {
        console.log(`[static-ads] backfilling niches for ${unclassified.length} reference(s)`);
        for (const row of unclassified) void runNicheClassification(row.id);
      }

      // Rows that failed (typically 429 rate limits on a previous boot) get
      // automatically retried. The concurrency gate in runDeconstruction keeps
      // fan-out bounded so we don't retrigger the same 429 storm.
      const failed = await db
        .select({ id: schema.staticAdReferences.id })
        .from(schema.staticAdReferences)
        .where(eq(schema.staticAdReferences.deconstructionStatus, "failed"));
      if (failed.length > 0) {
        console.log(`[static-ads] retrying ${failed.length} failed deconstruction(s)`);
        for (const row of failed) void runDeconstruction(row.id);
      }
    } catch (err) {
      console.error("[static-ads] boot ingest failed:", err);
    }
  })();

  // Backfill team_id on legacy brands. v1 ships single-team, so every brand
  // belongs to the bootstrap "Default Team". This mirrors the schema's
  // future-proofing comment — multi-team support later only needs filtering
  // logic, not a data migration. Idempotent: skips on every subsequent boot.
  void (async () => {
    try {
      const orphanCount = (await db
        .select({ id: schema.brands.id })
        .from(schema.brands)
        .where(isNull(schema.brands.teamId))).length;
      if (orphanCount === 0) return;
      const team = await getOrCreateDefaultTeam();
      await db
        .update(schema.brands)
        .set({ teamId: team.id })
        .where(isNull(schema.brands.teamId));
      console.log(`[teams] backfilled ${orphanCount} brand(s) onto team "${team.name}"`);
    } catch (err) {
      console.error("[teams] brand backfill failed:", err);
    }
  })();

  // Scan the character library folder once on boot. New / changed files become
  // default-library rows (brandId NULL) shared across every brand. After the
  // ingest, queue every character missing the Seedance-safe portrait through
  // the 2-step Nano-Banana-2 prep so the next video generation can use the
  // synthetic portrait as @Image2 instead of the realistic original (which
  // Seedance's likeness detector rejects).
  void (async () => {
    try {
      const ids = await ingestCharacterLibrary();
      if (ids.length > 0) {
        console.log(`[characters] ingested ${ids.length} new/updated character(s)`);
      }
      const queued = await backfillCharacterSeedancePrep();
      if (queued.length > 0) {
        console.log(`[character-prep] backfill queued ${queued.length} character(s) for Seedance prep`);
      }
    } catch (err) {
      console.error("[characters] boot ingest failed:", err);
    }
  })();
}

startServer().catch((err) => {
  console.error("[api] failed to start:", err);
  process.exit(1);
});
