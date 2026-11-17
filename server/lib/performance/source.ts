/**
 * DataSource — the single seam between the dashboard and the outside world.
 *
 *   fetchHours(fromMs, toMs) → Dataset (hourly buckets, see shared/performance/engine.ts)
 *
 * Implementations:
 *   - MockSource  — seeded generator (default for any brand without a live config)
 *   - LiveSource  — performance_orders (Shopify) + performance_spend_hours (Meta, Google)
 *                   kept fresh by server/lib/performance/sync.ts
 * Selected per client via PerformanceClientConfig.dataSource.
 */
import type { Dataset } from "../../../shared/performance/engine.js";
import type { PerformanceClientConfig } from "./config.js";
import { LiveSource } from "./liveSource.js";
import { MockSource } from "./mockSource.js";

export interface DataSource {
  readonly kind: "mock" | "live";
  fetchHours(fromMs: number, toMs: number): Promise<Dataset>;
}

export function getDataSource(config: PerformanceClientConfig): DataSource {
  return config.dataSource === "live" ? new LiveSource(config) : new MockSource(config.mockSeed);
}
