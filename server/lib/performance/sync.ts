/**
 * Sync orchestration: pulls Shopify orders, Meta spend and Google spend for a
 * brand into the performance_* tables and records freshness per source.
 *
 *   runBrandSync(brandId)      — one pass over every connected source (serial, per source
 *                                status running → ok | error; sources that aren't connected
 *                                are skipped and shown as "not connected")
 *   startPerformanceSyncLoop() — every minute, run brands whose source is live and whose
 *                                last successful sync is older than sync_every_minutes
 */
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db.js";
import { getClientConfig, liveBrandIds, type PerformanceClientConfig } from "./config.js";
import { syncGoogleSpend } from "./googleAds.js";
import { syncMetaSpend } from "./meta.js";
import { syncShopifyOrders } from "./shopify.js";

export type SyncSource = "shopify" | "meta" | "google";
export const SYNC_SOURCES: SyncSource[] = ["shopify", "meta", "google"];

const running = new Set<string>(); // brandIds with a sync in flight

export type SyncStateRow = typeof schema.performanceSyncState.$inferSelect;

export async function getSyncStates(brandId: string): Promise<SyncStateRow[]> {
  return db.select().from(schema.performanceSyncState).where(eq(schema.performanceSyncState.brandId, brandId));
}

async function upsertState(brandId: string, source: SyncSource, set: Partial<typeof schema.performanceSyncState.$inferInsert>): Promise<void> {
  await db.insert(schema.performanceSyncState).values({ brandId, source, ...set }).onConflictDoUpdate({
    target: [schema.performanceSyncState.brandId, schema.performanceSyncState.source],
    set,
  });
}

function isConnected(config: PerformanceClientConfig, source: SyncSource): boolean {
  if (source === "shopify") return Boolean(config.shopify.shopDomain && config.shopify.token);
  if (source === "meta") return Boolean(config.meta.token && config.meta.accounts.length);
  return Boolean(config.google.refreshToken && config.google.developerToken && config.google.accounts.length);
}

export function isSyncRunning(brandId: string): boolean {
  return running.has(brandId);
}

/** Run every connected source for the brand. Resolves when all are done; never throws (errors land in sync_state). */
export async function runBrandSync(brandId: string, brandName: string, opts: { full?: boolean } = {}): Promise<void> {
  if (running.has(brandId)) return;
  running.add(brandId);
  try {
    const config = await getClientConfig(brandId, brandName);
    const states = await getSyncStates(brandId);
    for (const source of SYNC_SOURCES) {
      if (!isConnected(config, source)) {
        await upsertState(brandId, source, { status: "idle", error: null });
        continue;
      }
      const prev = states.find((s) => s.source === source);
      const startedAt = new Date();
      await upsertState(brandId, source, { status: "running", lastStartedAt: startedAt, error: null });
      try {
        let rows = 0;
        let cursor: string | null = prev?.cursor ?? null;
        const lastSynced = opts.full ? null : (prev?.lastSyncedAt ?? null);
        if (source === "shopify") {
          const r = await syncShopifyOrders(config, opts.full ? null : cursor);
          rows = r.rows; cursor = r.cursor;
        } else if (source === "meta") {
          rows = (await syncMetaSpend(config, lastSynced)).rows;
        } else {
          rows = (await syncGoogleSpend(config, lastSynced)).rows;
        }
        await upsertState(brandId, source, {
          status: "ok", lastSyncedAt: startedAt, cursor, error: null,
          rowsTotal: sql`${schema.performanceSyncState.rowsTotal} + ${rows}` as unknown as number,
        });
        console.log(`[performance] ${brandName}: ${source} synced ${rows} rows`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await upsertState(brandId, source, { status: "error", error: message.slice(0, 1000) });
        console.error(`[performance] ${brandName}: ${source} failed — ${message}`);
      }
    }
  } finally {
    running.delete(brandId);
  }
}

/** Background loop: keeps live brands fresh. Call once at boot (only when the feature is enabled). */
export function startPerformanceSyncLoop(): void {
  const tick = async () => {
    try {
      const ids = await liveBrandIds();
      for (const brandId of ids) {
        if (running.has(brandId)) continue;
        const config = await getClientConfig(brandId, brandId);
        const states = await getSyncStates(brandId);
        const connected = SYNC_SOURCES.filter((s) => isConnected(config, s));
        if (!connected.length) continue;
        const due = connected.some((s) => {
          const st = states.find((x) => x.source === s);
          if (!st?.lastSyncedAt) return true;
          return Date.now() - st.lastSyncedAt.getTime() > config.syncEveryMinutes * 60_000;
        });
        if (!due) continue;
        const [brand] = await db.select({ name: schema.brands.name }).from(schema.brands).where(eq(schema.brands.id, brandId)).limit(1);
        void runBrandSync(brandId, brand?.name ?? brandId);
      }
    } catch (err) {
      console.error("[performance] sync loop error", err);
    }
  };
  setTimeout(() => void tick(), 15_000);
  setInterval(() => void tick(), 60_000);
}

/** Reset a brand's live data (used by "Full re-sync"). */
export async function clearBrandData(brandId: string): Promise<void> {
  await db.delete(schema.performanceOrders).where(eq(schema.performanceOrders.brandId, brandId));
  await db.delete(schema.performanceSpendHours).where(eq(schema.performanceSpendHours.brandId, brandId));
  await db.update(schema.performanceSyncState).set({ cursor: null, lastSyncedAt: null, rowsTotal: 0, status: "idle", error: null })
    .where(and(eq(schema.performanceSyncState.brandId, brandId)));
}
