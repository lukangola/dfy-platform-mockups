import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { env, isDev } from "./lib/env.js";
import { eq, inArray, sql as sqlTag } from "drizzle-orm";
import { db, schema } from "./lib/db.js";
import { attachAuth, getOrCreateDefaultTeam } from "./lib/auth.js";
import { ingestCharacterLibrary } from "./lib/characterIngest.js";
import { backfillCharacterSeedancePrep, prepareCharacterForSeedance } from "./lib/characterSeedancePrep.js";
import { ingestStaticAdLibrary } from "./lib/staticAdIngest.js";
import { authRouter } from "./routes/auth.js";
import { brandAssetsRouter } from "./routes/brandAssets.js";
import { brandsRouter, runBrandResearch } from "./routes/brands.js";
import { charactersRouter } from "./routes/characters.js";
import { generateRouter } from "./routes/generate.js";
import { listiclesRouter } from "./routes/listicles.js";
import { teamRouter } from "./routes/team.js";
import { isNull } from "drizzle-orm";
import { messageTestingRouter } from "./routes/messageTesting.js";
import { productsRouter, sweepOrphanedMechanismExtractions, sweepOrphanedProductPipelines } from "./routes/products.js";
import { shareRouter } from "./routes/share.js";
import { staticAdsRouter } from "./routes/staticAds.js";
import { staticAdsIterationsRouter } from "./routes/staticAdsIterations.js";
import { backfillMissingThumbnails, runDeconstruction, runNicheClassification, staticAdReferencesRouter } from "./routes/staticAdReferences.js";
import { uploadsRouter } from "./routes/uploads.js";
import { adConsoleRouter } from "./routes/adConsole.js";
import { adPipelineRouter } from "./routes/adPipeline.js";
import { jobsRouter } from "./routes/jobs.js";
import { sweepOrphanedJobs } from "./lib/jobRunner.js";
import "./lib/jobExecutors/media.js"; // side-effect: registers broll/character/single-scene/message-testing media job types
import "./lib/jobExecutors/staticAds.js"; // side-effect: registers static_ads_recreate

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * In production, run drizzle migrations before opening the listener.
 *
 * Railway / Fly / Render rebuild the container on every deploy. By running
 * migrations here we get a clean "schema-up-to-date guarantee" on every
 * boot — no separate deploy hook to forget about, and no race where
 * /api/auth/register is called before the `users` table exists. The pool
 * is fresh each call, isolated from the runtime pool that the request
 * handlers use, so a migration mid-flight can't deadlock against an
 * existing connection.
 *
 * Skipped in dev — `pnpm db:migrate` is the explicit dev command and we
 * don't want every `pnpm dev` save-and-restart to hammer the dev DB with
 * idempotent ALTER TABLE statements.
 */
async function runMigrationsOnBoot() {
  // process.cwd() = repo root in both dev and prod (pnpm runs from project
  // root). Avoiding __dirname so the path works whether the entry is
  // `server/index.ts` (dev) or the bundled `dist/index.js` (prod).
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  try {
    const migrationDb = drizzle(pool);
    console.log(`[boot] applying drizzle migrations from ${migrationsFolder}`);
    await migrate(migrationDb, { migrationsFolder });
    console.log(`[boot] migrations complete`);
  } finally {
    await pool.end();
  }
}

async function startServer() {
  if (!isDev) {
    await runMigrationsOnBoot();
  }

  const app = express();
  const server = createServer(app);

  // 60 MB to accommodate uploaded video ads in the Listicle Builder's
  // "winning ad" workflow (30-60s ad clips at decent quality ≈ 20-50 MB
  // raw; base64 wire-encoding adds ~33%). The 8 MB raw-image cap in
  // upload-image is enforced separately in that handler — this is just
  // the outer Express body parser limit.
  app.use(express.json({ limit: "60mb" }));

  // Mount globally so every downstream handler has `req.auth` (or null).
  // Auth-required endpoints opt in via the requireAuth / requireAdmin
  // middleware in their route definitions.
  app.use(attachAuth);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, env: env.NODE_ENV });
  });

  // Dev-only screenshot save endpoint. Used by the docs walkthrough flow
  // to capture step-by-step screenshots of the app via the Chrome MCP
  // (which can't otherwise write files to disk). Disabled in production.
  if (env.NODE_ENV !== "production") {
    app.post("/api/__debug__/save-screenshot", async (req, res) => {
      try {
        const { dataUrl, filename } = (req.body ?? {}) as { dataUrl?: string; filename?: string };
        if (!dataUrl || !filename) {
          return res.status(400).json({ error: "dataUrl and filename are required" });
        }
        const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
        if (!m) return res.status(400).json({ error: "dataUrl is not a valid base64 data URL" });
        const safe = filename.replace(/[^\w.-]/g, "_");
        const { promises: fs } = await import("node:fs");
        const path = await import("node:path");
        const dir = path.resolve(process.cwd(), "client/public/docs-screenshots/character-broll");
        await fs.mkdir(dir, { recursive: true });
        const dest = path.join(dir, safe);
        await fs.writeFile(dest, Buffer.from(m[1], "base64"));
        res.json({ ok: true, path: dest, bytes: Buffer.byteLength(m[1], "base64") });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  app.use("/api/auth", authRouter);
  app.use("/api/team", teamRouter);
  app.use("/api/generate", generateRouter);
  app.use("/api/brands", brandsRouter);
  app.use("/api/products", productsRouter);
  // PUBLIC, un-authenticated: read-only client share links. Mounted as its own
  // router (not under /api/products) so it never inherits productsRouter's
  // cookie-session auth/brand gating — access is by share token only.
  app.use("/api/share", shareRouter);
  app.use("/api/message-testing", messageTestingRouter);
  app.use("/api/brand-assets", brandAssetsRouter);
  app.use("/api/characters", charactersRouter);
  app.use("/api/listicles", listiclesRouter);
  app.use("/api/static-ad-references", staticAdReferencesRouter);
  app.use("/api/static-ads", staticAdsRouter);
  app.use("/api/static-ads-iterations", staticAdsIterationsRouter);
  app.use("/api/uploads", uploadsRouter);
  // Ad Creative Console — niche detection (Phase 0), competitors, feed.
  // Managers + admins on any brand; gated inside the router with requireManager.
  app.use("/api/ad-console", adConsoleRouter);
  // Ad Pipeline Kanban — Idea → In Production → Ready; managers + admins, gated inside the router.
  app.use("/api/ad-pipeline", adPipelineRouter);
  app.use("/api/jobs", jobsRouter);

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

      // Auto-backfill grid thumbnails for any reference still missing one.
      // Idempotent + bandwidth-bounded (concurrency 4). The original
      // imageUrl stays unchanged — the thumb is a separate fal asset that
      // the references list endpoint surfaces to the frontend grid so it
      // doesn't have to download multi-MB source PNGs.
      void backfillMissingThumbnails();
    } catch (err) {
      console.error("[static-ads] boot ingest failed:", err);
    }
  })();

  // Ensure the brand_members schema exists on every boot. The CREATE TABLE
  // / CREATE INDEX statements are idempotent (IF NOT EXISTS guards), so
  // they're safe to re-run forever and they let fresh deploys come up
  // without depending on a drizzle migration having already applied.
  //
  // ⚠️ DO NOT ADD A BOOT-TIME INSERT INTO brand_members HERE. ⚠️
  //
  // History — a security incident: a previous version of this block had an
  // INSERT INTO brand_members (...) SELECT FROM team_members JOIN brands ...
  // ON CONFLICT (brand_id, user_id) DO NOTHING, intended as a one-shot
  // migration when per-brand access first shipped.
  //
  // The bug: ON CONFLICT only suppresses *duplicate* (brand_id, user_id)
  // pairs. When an admin created a NEW brand, the (new_brand_id,
  // existing_user_id) pair had never existed, so it was NOT a conflict.
  // Every existing non-admin member silently got grants to the new brand
  // on the next deploy — wiping out the admin's carefully scoped access
  // rules and giving everyone access to everything.
  //
  // The correct grant paths, which DO NOT depend on boot-time logic, are:
  //   1. server/routes/brands.ts POST /api/brands → grants the creator
  //      (when they're a member). Admins skip the row (role check
  //      bypasses brand_members anyway).
  //   2. server/routes/team.ts PUT /api/team/members/:userId/brands →
  //      the admin explicitly assigns brand access via SettingsPage
  //      → Manage workspaces. This is the ONLY way a non-creator,
  //      non-admin gets brand access.
  //
  // If you ever need to backfill existing data again, write a one-shot
  // script that runs out-of-band (e.g. via `pnpm tsx scripts/...`) and
  // is removed after it runs. NEVER put data-seeding logic at the boot
  // entry point — it will silently re-fire on every deploy.
  void (async () => {
    try {
      await db.execute(sqlTag`
        CREATE TABLE IF NOT EXISTS brand_members (
          id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          created_at  timestamptz NOT NULL DEFAULT now(),
          brand_id    uuid NOT NULL,
          user_id     uuid NOT NULL,
          created_by  uuid
        );
      `);
      await db.execute(sqlTag`
        CREATE UNIQUE INDEX IF NOT EXISTS brand_members_brand_user_uniq
        ON brand_members (brand_id, user_id);
      `);
    } catch (err) {
      console.error("[brand-members] schema bootstrap failed (non-fatal):", err);
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

  // Backfill user_id on legacy brand_assets. Migration 0010 added the column
  // but didn't (couldn't) attribute existing rows — they pre-date the column.
  // Single-user attribution rule: if there's exactly one user in the DB, all
  // orphan rows belong to that user. If there are multiple users, we skip
  // and log — admin can run scripts/backfill-creator.ts manually after
  // deciding the attribution policy. Idempotent: skips on every subsequent
  // boot once the orphans are filled.
  void (async () => {
    try {
      const orphans = await db
        .select({ id: schema.brandAssets.id })
        .from(schema.brandAssets)
        .where(isNull(schema.brandAssets.userId));
      if (orphans.length === 0) return;
      const users = await db
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .limit(2);
      if (users.length === 0) {
        console.log(`[brand-assets] ${orphans.length} orphan row(s) but no users to attribute to — skipping`);
        return;
      }
      if (users.length > 1) {
        console.log(`[brand-assets] ${orphans.length} orphan row(s), multiple users — skipping auto-backfill (run scripts/backfill-creator.ts to choose)`);
        return;
      }
      const targetUser = users[0]!;
      await db
        .update(schema.brandAssets)
        .set({ userId: targetUser.id })
        .where(isNull(schema.brandAssets.userId));
      console.log(`[brand-assets] backfilled ${orphans.length} orphan row(s) onto ${targetUser.email}`);
    } catch (err) {
      console.error("[brand-assets] creator backfill failed:", err);
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

  // Research / reference-sheet rescue sweep. Product research and the
  // reference-sheet generator are fire-and-forget in-process promises, so a
  // deploy or crash mid-run leaves the row stuck on "researching"/"running"
  // forever (the UI spinner never resolves). In production we RESUME the
  // orphaned pipeline (research re-chains reference sheet + mechanism, so a
  // recovered product runs the whole way through); in dev — where tsx watch
  // restarts on every file save — we mark them failed with a retry hint
  // instead, so editing code doesn't fire a Claude research run per save.
  void (async () => {
    try {
      const result = await sweepOrphanedProductPipelines({ resume: !isDev });
      if (result.research > 0 || result.referenceSheets > 0 || result.angleArtifacts > 0) {
        console.log(
          `[products] research sweep: ${isDev ? "marked failed" : "resumed"} ${result.research} orphaned research run(s), ${result.referenceSheets} orphaned reference sheet(s), ${result.angleArtifacts} orphaned angle artifact(s)`,
        );
      }
    } catch (err) {
      console.error("[products] research sweep failed (non-fatal):", err);
    }
  })();

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

  // Mechanism-extraction rescue sweep. The reference-sheet → mechanism
  // chain is fire-and-forget (`void runMechanismExtraction(...)`), so a
  // server restart between sheet completion and mechanism start leaves
  // the product orphaned (sheet=complete, mechanism=null). Manual rescue
  // scripts that write referenceSheetUrl directly create the same shape.
  // This sweep resets any "running" status (those are crash orphans from
  // the previous process) and re-triggers extraction for every product
  // whose sheet is complete but whose mechanism is missing.
  // Idempotent: products with a complete mechanism are skipped.
  void (async () => {
    try {
      const result = await sweepOrphanedMechanismExtractions();
      if (result.resetRunning > 0) {
        console.log(`[products] mechanism sweep: reset ${result.resetRunning} stuck "running" status(es) from crash orphans`);
      }
      if (result.triggered > 0) {
        console.log(`[products] mechanism sweep: triggered extraction for ${result.triggered} orphan(s); ${result.skipped} skipped`);
      }
    } catch (err) {
      console.error("[products] mechanism sweep failed (non-fatal):", err);
    }
  })();

  // Brand-guidelines backfill. Every brand whose row has a brandUrl but
  // no guidelinesMarkdown (i.e. predates the migration from the old
  // brand_extract JSON to the new Brand Guidelines Generator skill) gets
  // its identity regenerated as a markdown style guide. Runs in the
  // background after the listener is up — first request to BrandInfoPage
  // will see "researching" and poll until the markdown lands.
  //
  // Idempotent: brands that already have a markdown are skipped. Errors
  // per brand are logged but don't block the others; the affected row
  // just keeps researchStatus=failed and the user can retry from the UI.
  void (async () => {
    try {
      const candidates = await db
        .select({ id: schema.brands.id, name: schema.brands.name, brandUrl: schema.brands.brandUrl, guidelinesMarkdown: schema.brands.guidelinesMarkdown })
        .from(schema.brands);
      const orphans = candidates.filter((b) =>
        b.brandUrl != null && b.brandUrl.trim().length > 0 &&
        (b.guidelinesMarkdown == null || b.guidelinesMarkdown.trim().length === 0),
      );
      if (orphans.length === 0) return;
      console.log(`[brands] backfill: ${orphans.length} brand(s) need guidelines markdown — kicking off`);
      // Sequential to avoid running N concurrent web_search / web_fetch
      // tool sessions against Anthropic at once. Each extraction is
      // ~30-90 seconds; running 5 brands sequentially is still well
      // under any practical boot time.
      for (const b of orphans) {
        try {
          console.log(`[brands] backfill: generating guidelines for "${b.name}" (${b.id})`);
          await runBrandResearch(b.id, b.brandUrl!);
        } catch (err) {
          console.error(`[brands] backfill failed for ${b.id} (non-fatal):`, err);
        }
      }
      console.log(`[brands] backfill: done`);
    } catch (err) {
      console.error("[brands] backfill sweep failed (non-fatal):", err);
    }
  })();
}

startServer().catch((err) => {
  console.error("[api] failed to start:", err);
  process.exit(1);
});
