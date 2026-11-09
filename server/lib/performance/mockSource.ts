/**
 * MockSource — deterministic (seeded) hourly dataset, port of `buildData()` from
 * the reference core.js. Generates from Jan 1 of last year to the current hour,
 * cached per (seed, hour) so repeated requests are free. Calibrated to realistic
 * relationships: ~€24k/day revenue, ~€8.8k/day spend at current scale, 55% → 100%
 * growth over the window, NL/BE 48% of revenue, Meta ~94% of spend, TikTok only
 * in NL/BE + UK, USA intentionally marginal.
 */
import { HOUR, PLATFORMS, REGIONS, type Dataset, type HourBucket, type PlatformKey, type RegionKey } from "../../../shared/performance/engine.js";
import type { DataSource } from "./source.js";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REV_SHARE = [0.48, 0.197, 0.075, 0.248];
const NC_OF_REV = [0.637, 0.687, 0.884, 0.837];
const NC_AOV = [69, 73, 70, 72];
const RC_AOV = [61, 57, 70, 15];
const SPEND_SHARE = [0.402, 0.19, 0.104, 0.297];
const PLAT_SPLIT = [
  [0.914, 0.041, 0.045],
  [0.914, 0.046, 0.04],
  [0.977, 0.023, 0.0],
  [0.996, 0.004, 0.0],
];
const BASE_DAY_REV = 24000;
const BASE_DAY_SPEND = 8800;
const HOUR_W = [0.35, 0.25, 0.2, 0.2, 0.25, 0.4, 0.6, 0.9, 1.15, 1.3, 1.4, 1.45, 1.4, 1.35, 1.3, 1.25, 1.3, 1.45, 1.6, 1.7, 1.6, 1.35, 1.0, 0.55];
const DOW_W = [1.06, 0.98, 0.96, 0.97, 1.0, 1.02, 1.01];

export function buildMockData(seed: number, nowMs: number): Dataset {
  const rng = mulberry32(seed);
  const now = new Date(nowMs);
  const start = new Date(now.getFullYear() - 1, 0, 1);
  const startMs = start.getTime();
  const nowHour = new Date(now); nowHour.setMinutes(0, 0, 0);
  const lastHourFrac = Math.max(0.05, (nowMs - nowHour.getTime()) / HOUR);
  const nHours = Math.floor((nowHour.getTime() - startMs) / HOUR) + 1;
  const totalMs = nowHour.getTime() - startMs;

  const hours: HourBucket[] = new Array(nHours);
  for (let i = 0; i < nHours; i++) {
    const t = startMs + i * HOUR;
    const d = new Date(t);
    const prog = (t - startMs) / totalMs;
    const growth = 0.55 + 0.45 * prog;
    const dayW = DOW_W[d.getDay()] * (0.9 + 0.2 * rng());
    const hw = HOUR_W[d.getHours()] / 24;
    const frac = i === nHours - 1 ? lastHourFrac : 1;
    const scale = growth * dayW * hw * frac;

    const c = {} as Record<RegionKey, [number, number, number, number]>;
    for (let r = 0; r < 4; r++) {
      const regRev = BASE_DAY_REV * REV_SHARE[r] * scale;
      const ncRevT = regRev * NC_OF_REV[r];
      const rcRevT = regRev - ncRevT;
      const ncO = Math.max(0, Math.round((ncRevT / NC_AOV[r]) * (0.75 + 0.5 * rng())));
      const rcO = Math.max(0, Math.round((rcRevT / RC_AOV[r]) * (0.75 + 0.5 * rng())));
      const ncR = ncO * NC_AOV[r] * (0.92 + 0.16 * rng());
      const rcR = rcO * RC_AOV[r] * (0.92 + 0.16 * rng());
      c[REGIONS[r].key] = [ncO, Math.round(ncR * 100) / 100, rcO, Math.round(rcR * 100) / 100];
    }

    const s = {} as Record<PlatformKey, [number, number, number, number]>;
    for (let p = 0; p < 3; p++) {
      const row: [number, number, number, number] = [0, 0, 0, 0];
      for (let r = 0; r < 4; r++) {
        const sp = BASE_DAY_SPEND * SPEND_SHARE[r] * PLAT_SPLIT[r][p] * scale * (0.85 + 0.3 * rng());
        row[r] = Math.round(sp * 100) / 100;
      }
      s[PLATFORMS[p].key] = row;
    }
    hours[i] = { t, c, s };
  }
  return { hours, startMs, now: nowMs, nowHourMs: nowHour.getTime() };
}

/** Cache: one full series per seed per wall-clock hour. The last (partial) bucket is rescaled on read. */
const cache = new Map<string, Dataset>();

export class MockSource implements DataSource {
  readonly kind = "mock" as const;
  constructor(private readonly seed: number) {}

  async fetchHours(fromMs: number, toMs: number): Promise<Dataset> {
    const now = Date.now();
    const hourKey = Math.floor(now / HOUR);
    const key = `${this.seed}:${hourKey}`;
    let full = cache.get(key);
    if (!full) {
      full = buildMockData(this.seed, now);
      cache.clear(); // keep memory flat: one series per seed per hour is all we need
      cache.set(key, full);
    }
    // Slice the requested window (aligned to whole hours, inclusive of the bucket containing `to`).
    const i0 = Math.max(0, Math.floor((fromMs - full.startMs) / HOUR));
    const i1 = Math.min(full.hours.length - 1, Math.floor((Math.min(toMs, now) - full.startMs) / HOUR));
    const hours = i1 >= i0 ? full.hours.slice(i0, i1 + 1) : [];
    return { hours, startMs: full.startMs + i0 * HOUR, now, nowHourMs: full.nowHourMs };
  }
}
