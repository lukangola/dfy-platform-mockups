/**
 * Polls the active brand's jobs every 15s (paused while the tab is hidden):
 *  - returns runningCount for the Dashboard nav badge;
 *  - fires a toast when a job the CURRENT USER created transitions from
 *    running to finished while they're anywhere in the workspace.
 * Poll cadence is deliberately slower than DashboardPage's 5s — this runs
 * globally on every workspace page, the dashboard only while you watch it.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { listJobs, type Job } from "@/lib/api";

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
          } else {
            toast.error(`${prev.title} — finished with ${finished.errorCount} error(s)`, { description: "Open the Dashboard to retry failed items." });
          }
        });
        prevRunning.current = nowRunning;
      } catch {
        /* transient — next tick retries */
      }
    };
    void tick();
    const t = setInterval(tick, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, [brandId, currentUserId]);

  return runningCount;
}
