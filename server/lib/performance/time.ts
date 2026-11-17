/** Time helpers shared by the platform syncs. */
import { HOUR } from "../../../shared/performance/engine.js";

/** Jan 1 of last year, local time — the backfill horizon (same window as the mock). */
export function backfillStart(now = new Date()): Date {
  return new Date(now.getFullYear() - 1, 0, 1);
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Split [from, to] (dates) into inclusive chunks of at most `days` days. */
export function dateChunks(from: Date, to: Date, days: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let a = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (a <= end) {
    const b = addDays(a, days - 1) < end ? addDays(a, days - 1) : end;
    out.push([ymd(a), ymd(b)]);
    a = addDays(b, 1);
  }
  return out;
}

/** UTC offset (ms) of an IANA time zone at a given instant. */
function tzOffsetMs(atMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(atMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return asUtc - atMs;
}

/**
 * Epoch ms of "YYYY-MM-DD HH:00" expressed in `timeZone` (platform reports are in
 * the ad account's zone). Two-pass to land on the right side of a DST switch.
 */
export function zonedHourToUtcMs(date: string, hour: number, timeZone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  let off = tzOffsetMs(guess, timeZone);
  let utc = guess - off;
  off = tzOffsetMs(utc, timeZone);
  utc = guess - off;
  return Math.floor(utc / HOUR) * HOUR;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
