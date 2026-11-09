/**
 * DataSource — the single seam between the dashboard and the outside world.
 *
 *   fetchHours(fromMs, toMs) → Dataset (hourly buckets, see shared/performance/engine.ts)
 *
 * Implementations:
 *   - MockSource  (Phase A, default)        — seeded generator
 *   - LiveSource  (Phase B+, not built yet)  — Shopify orders + Meta/Google/TikTok
 *                                              insights, Windsor.ai fallback,
 *                                              aggregated into the same shape.
 * Selected per client via PerformanceClientConfig.dataSource (env default = mock).
 */
import type { Dataset } from "../../../shared/performance/engine.js";
import type { PerformanceClientConfig } from "./config.js";
import { MockSource } from "./mockSource.js";

export interface DataSource {
  readonly kind: "mock" | "live";
  fetchHours(fromMs: number, toMs: number): Promise<Dataset>;
}

export function getDataSource(config: PerformanceClientConfig): DataSource {
  if (config.dataSource === "live") {
    // Phase B: return new LiveSource(config). Until then, fail loudly instead of
    // silently showing mock numbers under a "live" label.
    throw new Error(`Live data source is not implemented yet (client ${config.name}). Set PERFORMANCE_DATA_SOURCE=mock.`);
  }
  return new MockSource(config.mockSeed);
}
