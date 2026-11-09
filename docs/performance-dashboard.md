# Performance dashboard (Inana section) — Phase A: mock data

Branch: `performance-dashboard` (worktree `.claude/worktrees/performance-dashboard`, cut from `origin/main`).
Reference implementation + spec: `~/ClaudeCowork/performance-dashboard/` (`INANA_DASHBOARD_SPEC.md`, `BUILD_PLAN.md`).

## Test it (dev)

```bash
cd "$HOME/Leverage Consulting Dropbox/Projekte/Claude/Claude Code/dfy-platform-mockups/.claude/worktrees/performance-dashboard"
PORT=3001 pnpm dev
```

Then open http://localhost:3000/workspace/performance (sign in with your normal Inana account;
you need the manager or admin role). **Performance** also appears in the left nav, directly
under Dashboard. The amber **MOCK DATA** pill means the numbers are generated, not real.

What to click:
- **Today / Yesterday / Month to date / Year to date** — cards, tables and sparklines rescope;
  Today/Yesterday are hourly, MTD/YTD daily.
- **Country** — Total / NL/BE / UK / USA / Other. Cards and the platform table scope to that
  market; the matching region row is highlighted.
- **Compare** — Previous period shows ▲/▼ deltas on every number (green = good direction,
  red = bad; NCPA/RCPA/CPA invert; spend is grey = neutral). Off hides them.
- Hover any sparkline for the bucket's time and value. **Refresh** refetches.
- Switch brand in the top-left switcher: every brand gets its own mock series.

Reconciliation that must always hold (checked in the browser on 2026-11-09, all four ranges):
every KPI card equals the Total row's matching column; region rows sum to the Total row;
platform-table spend equals the Meta / Google / TikTok columns of the Total row.

## Where things live

| Piece | File |
|---|---|
| Metric engine (agg, metrics, range, series, platformStats, formatters) | `shared/performance/engine.ts` |
| Per-client config (defaults + per-brand overrides, env defaults) | `server/lib/performance/config.ts` |
| Data-source seam `fetchHours(from, to)` + source selection | `server/lib/performance/source.ts` |
| MockSource (seeded generator, cached per hour) | `server/lib/performance/mockSource.ts` |
| API: `GET /api/performance/config`, `GET /api/performance/hours` | `server/routes/performance.ts` |
| Page | `client/src/pages/workspace/PerformancePage.tsx` |
| Feature flag | `client/src/lib/featureFlags.ts` (`PERFORMANCE_ENABLED`) |

Hourly-bucket contract (every source must produce it):
`{ t, c: { REGION: [ncOrders, ncRev, rcOrders, rcRev] }, s: { PLATFORM: [spendPerRegion x4] } }`

## Flags and env

- Client: on in `pnpm dev`; in a production build only when `VITE_FEATURE_PERFORMANCE=1`.
- Server: `/api/performance/*` answers 404 in production unless `FEATURE_PERFORMANCE=1`.
- `PERFORMANCE_DATA_SOURCE=mock|live` (default mock; live throws until Phase B).
- `PERFORMANCE_GROSS_MARGIN` (0.52), `PERFORMANCE_REMARKETING_SHARE` (0.12) — defaults until
  per-client values are set in `config.ts` (Phase B: DB row).

## Metric definitions (mock-era — confirm per client)

- CM = margin × revenue − ad spend
- NC CM = margin × NC revenue − prospecting spend (1 − remarketing share); RC CM = the rest
- NCPA = total spend ÷ NC orders; RCPA = remarketing spend ÷ RC orders; NC ROAS = NC revenue ÷ total spend
- Platform ROAS/CPA use fixed mock attribution factors (Meta 2.05, Google 6.2, TikTok 2.4)

## Phase B needs from Marcus (nothing else is blocked)

1. Pilot client: `*.myshopify.com` domain + Admin API token (read orders, customers).
2. NC/RC definition: first-ever order (current) vs. first order within N days.
3. Real gross margin % for the pilot brand.
4. Prospecting vs. remarketing: campaign naming convention (replaces the fixed 88/12 split).
5. Meta ad account ids + Marketing API token; later Google MCC ids, TikTok advertiser ids; account → region mapping.

## Deliberate Phase A choices

- No DB migration: client config is in code (`config.ts`) so the branch doesn't collide with the
  unmerged `ai-employees` migrations; Phase B adds the table together with encrypted credentials.
- Styling follows the live Studio Control Room look (dark cards, cyan accent, mono labels), not
  the pale-lavender description in the spec, because that is what the running app uses.
- Hand-rolled SVG sparklines (no chart lib), identical to the reference.
