/**
 * Client-side feature flags.
 *
 * Performance dashboard: on in every dev build (`pnpm dev`), off in production
 * builds unless VITE_FEATURE_PERFORMANCE=1 at build time. The server mirrors
 * this with FEATURE_PERFORMANCE (routes/performance.ts), so a hand-typed URL on
 * production gets an empty page AND a 404 from the API.
 */
export const PERFORMANCE_ENABLED: boolean =
  import.meta.env.DEV || import.meta.env.VITE_FEATURE_PERFORMANCE === "1";
