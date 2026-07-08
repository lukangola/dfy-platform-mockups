/**
 * Polls the active brand's jobs every 15s (ticks are skipped while the tab is
 * hidden; a visibilitychange listener catches up immediately on refocus):
 *  - returns runningCount for the Dashboard nav badge;
 *  - fires a toast when a job the CURRENT USER created transitions from
 *    running to finished while they're anywhere in the workspace.
 * Poll cadence is deliberately slower than DashboardPage's 5s — this runs
 * globally on every workspace page, the dashboard only while you watch it.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { listJobs, type Job } from "@/lib/api";

/**
 * Returns the active brand's running-job count AND, as a side effect, fires
 * completion toasts (success / warning / error) when one of the current
 * user's jobs finishes while they're anywhere in the workspace.
 */
export function useJobsPulse(brandId: string | null, currentUserId: string | null): number {
  const [runningCount, setRunningCount] = useState(0);
  const prevRunning = useRef<Map<string, Job>>(new Map());

  useEffect(() => {
    prevRunning.current = new Map();
    if (!brandId) { setRunningCount(0); return; }
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const { jobs, runningCount: rc } = await listJobs(brandId);
        if (cancelled) return;
        setRunningCount(rc);
        const nowRunning = new Map(jobs.filter((j) => j.status === "queued" || j.status === "running").map((j) => [j.id, j] as const));
        prevRunning.current.forEach((prev, id) => {
          if (nowRunning.has(id)) return;
          const finished = jobs.find((j) => j.id === id);
          if (!finished || finished.userId !== currentUserId) return;
          if (finished.status === "complete") {
            toast.success(`${prev.title} — done`, { description: "Open the Dashboard to review the results." });
          } else if (finished.status === "complete_with_errors") {
            toast.warning(`${prev.title} — done, ${finished.errorCount} item(s) failed`, { description: "Open the Dashboard to retry the failed items." });
          } else {
            toast.error(`${prev.title} — failed`, { description: finished.error ?? "Open the Dashboard for details." });
          }
        });
        prevRunning.current = nowRunning;
      } catch {
        /* transient — next tick retries */
      }
    };
    void tick();
    const t = setInterval(tick, 15000);
    // Hidden-tab ticks are skipped above — catch up as soon as the tab is
    // visible again instead of waiting up to 15s for the next interval.
    const onVis = () => { if (!document.hidden) void tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelled = true; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [brandId, currentUserId]);

  return runningCount;
}
