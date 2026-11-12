# Performance dashboard (Inana section) — mock + live (Shopify, Meta, Google Ads)

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
  red = bad; NCPA/CPA invert; spend is grey = neutral). Off hides them.
- Hover any sparkline for the bucket's time and value. **Refresh** refetches.
- Switch brand in the top-left switcher: every brand gets its own mock series.

Reconciliation that must always hold (checked in the browser on 2026-11-09, all four ranges):
every KPI card equals the Total row's matching column; region rows sum to the Total row;
platform-table spend equals the Meta / Google / TikTok columns of the Total row.

## Go live tomorrow (what Marcus does, nothing else needed)

1. Open the Performance page → click **Data sources** (or the amber MOCK DATA pill).
2. **Shopify**: shop domain (`brand.myshopify.com`) + the app's **Client ID** and **Client secret**.
   Since 1 Jan 2026 Shopify no longer creates custom apps in the admin and shows no access token
   anywhere; apps are made in the Dev Dashboard (dev.shopify.com) instead: **Create app** → name
   (e.g. Inana.ai), App URL can stay as it is (nothing is hosted; `https://shopify.dev/apps/default-app-home`
   is Shopify's own placeholder), no redirect URL, no "embed", no "legacy install flow" →
   **Scopes**: only `read_orders, read_customers, read_products, read_inventory` (no `write_*`) →
   release the version → **install it on the store** → copy Client ID + Client secret from the
   app's Settings. The server exchanges them for a 24-hour token (client credentials grant) and
   renews it once a day; nothing else to do. Requirement: the app and the store must be in the
   same Shopify organization (create the app from the organization that owns the store; for a
   client's store the client, or someone with the App developer role there, creates it). Legacy
   custom apps created in the admin before 2026 still work: paste their `shpat_` token in the
   legacy field instead. Click **Test connection** — it exchanges the credentials, shows the shop,
   the currency and the scopes really granted, warns about missing read scopes or any write scope,
   and checks the order history: Shopify shows apps created under a *Partner* account only the
   last 60 days of orders (the dashboard backfills from 1 Jan last year). An app created from the
   store's own organization sees everything, so the test line should read "history: full". If it
   says "only the last 60 days", create the app from the store's organization or request
   "Read all orders" in the Partner Dashboard and add `read_all_orders`. No reports scope is
   needed: every number is computed from the raw orders, products and inventory items.

   **App created under a Partner organization (agency account) instead?** The exchange above is
   refused for a client's store ("same organization"). Use the install flow in the Shopify card:
   in the app's Home choose **Custom distribution** for the store (irreversible, fine for an
   agency app; "single store", not the multi-store Plus link), add the redirect URL
   `http://localhost:3000/api/performance/shopify/callback` to the app's released version config
   (the panel shows the exact one for the origin you use), save shop domain + Client ID + secret in
   Inana. The **first** install must go through Shopify's signed link: copy the install link from
   the Distribution page, open it logged in to the store, click Install (Shopify then lands on the
   app URL, which can be ignored). Inana's **Install on store** button sends a plain authorize URL,
   which Shopify rejects for a custom-distribution app that is not installed yet ("The installation
   link for this app is invalid"). Once the app is installed, click **Install on store**: Shopify
   sends the code straight back and Inana stores the token encrypted (newer apps: 1-hour token +
   90-day refresh token, renewed automatically ~10 minutes before expiry). Such apps only see the last
   60 days of orders until "Read all orders" is approved for them — Test connection says so.
   Pasting different app credentials later (e.g. the client's own app) drops the installed token;
   run a full sync afterwards to backfill the history. Set `PUBLIC_APP_URL` in `.env.local` if the
   app is reached under another origin than the browser reports.
3. **Meta**: a System-user access token with only `ads_read` (Business settings → Users → System
   users → Generate token, tick `ads_read`, assign the ad accounts, no expiry), and the ad accounts
   with their region: `act_123:NLBE, act_456:UK`. Click **Test connection** (account name, time
   zone, currency).
4. **Google Ads**: developer token (API Center of the MCC), OAuth client id + secret (Google Cloud →
   Credentials, Desktop/Web app), a refresh token for that client (OAuth playground or the
   Google Ads API `generate_user_credentials` helper), optional MCC id, and customer ids with region:
   `1234567890:NLBE`. Click **Test connection**.
5. Set **Data source = Live** and click **Save & sync now**. (Nothing to type for margin — it
   comes from Shopify's "Cost per item"; the new-customer rule lives under Advanced settings and
   defaults to Shopify's own first-ever-order definition.) The first Shopify backfill (since 1 Jan last year) runs in the background;
   the header shows per-source freshness ("Shopify synced 2m ago · Meta … · Google …"). After that
   the server re-syncs every 10 minutes (configurable) while the source is Live.
6. Reconcile: Yesterday's revenue vs. Shopify admin; Yesterday's spend vs. Ads Manager (±1%);
   Gross margin % vs. Shopify's Profit report. If the header shows an amber "no Cost per item for
   N% of revenue" line, add costs to those products in Shopify (Products → variant → Cost per item).

### Why tokens, not an OAuth login

- **Shopify**: a Dev Dashboard app installed on your own store, with the server exchanging its
  Client ID + secret for short-lived tokens, is Shopify's own flow for a single-store integration
  (the admin "custom app" with a copyable token was retired on 1 Jan 2026). For an app that lives
  in a Partner organization and is installed on a client's store, Shopify requires its install
  flow (authorization code grant) instead; the card offers that too, and the resulting token is
  stored encrypted with its refresh token. The app is scoped read-only on Shopify's side, so even
  a leaked secret could not change anything, and the 24-hour tokens from the exchange never leave
  the server (in-memory cache, never stored).
- **Meta**: a System-user token is long-lived and belongs to the business, not to a person's
  login, and carries only `ads_read`. An OAuth "Log in with Facebook" would give a 60-day token tied
  to one person and require a Meta app review for `ads_read`.
- **Google Ads**: there is no token alternative — Google requires OAuth. The one-time consent
  produces the refresh token you paste; after that the server refreshes access tokens itself.
- Secrets are stored AES-256-GCM encrypted (`CONNECTIONS_KEY`), never returned by any API
  (`GET /config` only says "set"), never put in URLs (Meta uses the Authorization header), and
  never logged. Nothing in the dashboard code calls a write endpoint on any platform.

Credentials are AES-256-GCM encrypted with `CONNECTIONS_KEY` from `.env.local` and are never sent
back to the browser. Sources that aren't connected simply contribute zero (TikTok stays 0 until
Phase 4). No webhook/public URL is needed — polling by `updated_at` catches new orders, edits and
cancellations.

### How live data flows

```
Shopify Admin REST (orders, 250/page, created_at_min → updated_at_min cursor) ─┐
Meta Marketing API (account insights, hourly breakdown, account tz → UTC)   ─┼─► performance_orders / performance_spend_hours
Google Ads API (GAQL customer report, segments.date + hour, account tz → UTC) ─┘          │
                                       sync.ts (10-min loop + "Sync now") ──────────────► performance_sync_state (freshness)
                                                                                           │
LiveSource.fetchHours(from, to) ── SQL group by hour/region/platform ──► hourly buckets ──► same engine + UI as the mock
```

New-customer rule (recomputed after every Shopify sync, selectable in the panel):
`first_ever` = the customer's earliest order in our data AND the customer record was created inside the
backfill window (older customers count as returning); `window_days` = no earlier order by the same
customer within N days. Guests are keyed by email; orders without customer or email count as new.
Cancelled/voided and test orders are stored but excluded. Refunds are not netted yet (Phase 5).

API versions (env overrides): `SHOPIFY_API_VERSION` (2025-01), `META_GRAPH_VERSION` (v23.0),
`GOOGLE_ADS_API_VERSION` (v22). If a platform retires a version the Test button shows the error.

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
| Connect-data-sources panel | `client/src/components/PerformanceSourcesPanel.tsx` |
| LiveSource (SQL → hourly buckets) | `server/lib/performance/liveSource.ts` |
| Shopify orders sync + NC/RC recompute | `server/lib/performance/shopify.ts` |
| Meta hourly spend sync | `server/lib/performance/meta.ts` |
| Google Ads hourly spend sync | `server/lib/performance/googleAds.ts` |
| Sync loop, "Sync now", freshness | `server/lib/performance/sync.ts` |
| Credential encryption | `server/lib/performance/secrets.ts` |
| Tables (migration `drizzle/0031_performance_dashboard.sql`) | `performance_client_configs`, `performance_orders`, `performance_spend_hours`, `performance_sync_state` |

Hourly-bucket contract (every source must produce it):
`{ t, c: { REGION: [ncOrders, ncRev, rcOrders, rcRev, cogs] }, s: { PLATFORM: [spendPerRegion x4] } }`

### What each sync pulls (so nothing is re-downloaded needlessly)

| Source | First run | Every 10 min after |
| --- | --- | --- |
| Shopify orders | all orders since 1 Jan last year, 250/page | only orders whose `updated_at` moved past the cursor (new, edited, cancelled, refunded) |
| Shopify unit costs | one GraphQL request per 100 distinct variants seen in orders | only variants not cached yet, or cached > 30 days ago and seen again |
| Meta spend | hourly rows since 1 Jan last year, 60-day chunks | last 3 days per account (late attribution settles) |
| Google spend | hourly rows since 1 Jan last year, 90-day chunks | last 3 days per account |

**Refresh** on the dashboard and the range/country/compare controls only re-read the local
database — they never call Shopify or the ad platforms. "Full re-sync" is the only button that
redoes the backfill.

## Flags and env

- Client: on in `pnpm dev`; in a production build only when `VITE_FEATURE_PERFORMANCE=1`.
- Server: `/api/performance/*` answers 404 in production unless `FEATURE_PERFORMANCE=1`.
- `PERFORMANCE_DATA_SOURCE=mock|live` — default for brands without a saved config (the panel's
  Data source setting wins per brand).
- `CONNECTIONS_KEY` — 32-byte hex, encrypts stored credentials (already in Marcus's `.env.local`).

## Metric definitions

- Cost of goods (COGS) = Σ quantity × Shopify "Cost per item" over the order's line items;
  gross margin % = (revenue − COGS) ÷ revenue. Mock data uses a calibrated ~52% margin.
- CM = revenue − COGS − ad spend
- NC CM = margin × NC revenue − ad spend (all ad spend counts as acquisition); RC CM = margin × RC revenue
- NCPA = ad spend ÷ NC orders; NC ROAS = NC revenue ÷ ad spend
- New customer = first-ever order of that customer (Shopify's definition); orders of customers whose
  Shopify record predates the backfill count as returning
- Platform ROAS/CPA use fixed mock attribution factors (Meta 2.05, Google 6.2, TikTok 2.4)

## Still open (not blocking the live dashboard)

1. Prospecting vs. remarketing split of spend is not modelled (all spend = acquisition spend, so
   RC CM carries no spend). A real split needs the campaign naming convention → per-campaign
   insights (Phase 4).
2. Platform ROAS/CPA in the by-platform table still use mock attribution factors; platform-reported
   conversions come with the campaign-level pull (Phase 4).
3. TikTok and Windsor.ai fallback (Phase 4). Refund netting, currency conversion (shop currency is
   assumed EUR), auth hardening for production (Phase 5).
4. Merge note: `drizzle/0031_performance_dashboard.sql` was generated from `main` (regenerated on
   2026-11-10 to include unit costs; the dev DB was reset to it). The unmerged `ai-employees`
   branch has its own 0031 (already applied to the shared dev DB) — renumber on merge.

## Deliberate Phase A choices

- Client config + credentials live in `performance_client_configs` (one row per brand), written
  from the panel; brands without a row run on defaults (mock).
- Styling follows the live Studio Control Room look (dark cards, cyan accent, mono labels), not
  the pale-lavender description in the spec, because that is what the running app uses.
- Hand-rolled SVG sparklines (no chart lib), identical to the reference.
