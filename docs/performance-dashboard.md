# Performance dashboard (Inana section) — mock + live (Shopify, Amazon, Meta, Google Ads)

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
- **Country** — Total / the brand's regions / Other (default NL/BE, UK, USA; per brand under
  Data sources → Advanced settings, e.g. `DE: DE; AT: AT` for a DACH shop). Cards and the
  platform table scope to that market; the matching region row is highlighted.
- **Compare** — Previous period shows ▲/▼ deltas on every number (green = good direction,
  red = bad; NCPA/CPA invert; spend is grey = neutral). Off hides them.
- Hover any sparkline for the bucket's time and value. **Refresh** pulls new orders and spend from the connected sources (an incremental sync, same as "Sync now") and reloads when it is done; the button reads "Syncing…" meanwhile. On mock data it just reloads.
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
2b. **Amazon** (clients that also sell on Amazon; skip otherwise): a private, self-authorised
   Selling Partner API app in the seller's own Seller Central. Seller Central → Apps & Services →
   **Develop Apps** (the account needs the Developer profile once; Amazon approves a private
   "seller" developer profile without a review) → **Add new app client**: name (e.g. Inana), API
   type **SP API**, OAuth login/redirect URIs empty (nothing is hosted), **Roles**: tick only
   **Inventory and Order Tracking** — that role carries the Orders API, and the dashboard calls
   nothing else (getOrders + getOrderItems + the seller's marketplace list). Optionally also tick
   **Direct-to-Consumer Shipping (Restricted)**: it lets the dashboard read the anonymised buyer
   email and the shipping country, which is what new/returning customers and the region per order
   are computed from; without it every Amazon order counts as new-customer and the region is the
   marketplace's country (amazon.de → DE). Still read-only either way. Save → **View** → copy
   **LWA client id** and **client secret** → back in the app list click **Authorize** → the
   **refresh token** is shown once; copy it. In the Amazon card paste the three values, choose the
   **region endpoint** (EU for amazon.de/.nl/.co.uk/…, NA for .com/.ca/.mx, FE for .jp/.au/.sg) and
   leave **Marketplace ids** empty to pull every marketplace the seller sells in (or list ids such
   as `A1PA6795UKMFR9` for .de, `A1805IZSGTT6HS` for .nl, `A1F83G8C2ARO7P` for .co.uk). Click
   **Test connection**: it exchanges the refresh token, lists the seller's marketplaces with
   country and currency, shows how many orders the first page since the backfill start holds and
   the oldest of them, and says whether buyer info is readable. If the Authorize step fails with
   "developer profile", finish the profile under Develop Apps first; if the refresh token is
   rejected later, re-authorise the app and paste the new token (saving the credentials again drops
   nothing else; run a full re-sync only if you change marketplaces).
3. **Meta**: a System-user access token with only `ads_read` (Business settings → Users → System
   users → Generate token, tick `ads_read`, assign the ad accounts, no expiry), and the ad accounts
   with their region: `act_123:NLBE, act_456:UK`. Click **Test connection** (account name, time
   zone, currency). Spend is split by country: Meta refuses hourly + country in one request, so
   the sync also pulls the daily spend per country and pro-rates every hour by that day's
   country shares; each slice is stored with its country and mapped to the regions exactly like
   orders. The account's region is only the fallback for days without country rows. One ad
   account serving several markets is therefore fine.
4. **Google Ads**: developer token (API Center of the MCC), OAuth client id + secret (Google Cloud →
   Credentials, Desktop/Web app), a refresh token for that client (OAuth playground or the
   Google Ads API `generate_user_credentials` helper), optional MCC id, and customer ids with region:
   `1234567890:NLBE`. Click **Test connection**.
5. Set **Data source = Live** and click **Save & sync now**. The dashboard then formats money in the
   shop's currency and starts "Today" at the shop's midnight (both from Shopify's `shop.json`, shown in
   the Shopify card and the footer) — so Today matches the Shopify admin and Ads Manager, not the
   browser's clock. (Nothing to type for margin — it
   comes from Shopify's "Cost per item"; the new-customer rule and the regions live under Advanced
   settings. Regions: `label: countries; …` with 2-letter codes of the order's shipping country, up
   to 8, everything else = Other; the ad-account mapping uses the label without punctuation as key,
   e.g. `NL/BE` → `NLBE`. Saving re-assigns the synced orders.) The first Shopify backfill (since 1 Jan last year) runs in the background;
   the header shows per-source freshness ("Shopify synced 2m ago · Meta … · Google …"). After that
   the server re-syncs every 10 minutes (configurable) while the source is Live.
6. Reconcile: Yesterday's revenue vs. Shopify admin (+ Seller Central → Business reports for
   Amazon); Yesterday's spend vs. Ads Manager (±1%); Gross margin % vs. Shopify's Profit report.
   If the header shows an amber "no cost of goods for N% of revenue" line, add costs to those
   products in Shopify (Products → variant → Cost per item) and, for Amazon, make sure the Amazon
   SKU equals the Shopify variant SKU (the server log lists the unmatched SKUs after each sync).

### Why tokens, not an OAuth login

- **Shopify**: a Dev Dashboard app installed on your own store, with the server exchanging its
  Client ID + secret for short-lived tokens, is Shopify's own flow for a single-store integration
  (the admin "custom app" with a copyable token was retired on 1 Jan 2026). For an app that lives
  in a Partner organization and is installed on a client's store, Shopify requires its install
  flow (authorization code grant) instead; the card offers that too, and the resulting token is
  stored encrypted with its refresh token. The app is scoped read-only on Shopify's side, so even
  a leaked secret could not change anything, and the 24-hour tokens from the exchange never leave
  the server (in-memory cache, never stored).
- **Amazon**: a self-authorised SP-API app is Amazon's own flow for a seller integrating their
  own account; the refresh token it issues is long-lived and the server swaps it for 1-hour access
  tokens that stay in memory. The app's roles are set in Seller Central, so the token can only read
  what the Orders role allows. No AWS keys or request signing are needed any more.
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
Amazon SP-API Orders (100/page, CreatedAfter → LastUpdatedAfter cursor)      ─┼─► performance_orders (channel) / performance_spend_hours
Meta Marketing API (hourly insights × daily country shares, account tz → UTC) ─┤          │
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

Amazon data notes (`channel = amazon` rows in `performance_orders`, same hourly buckets, no engine change):
- **Order key** = the Amazon order id (`302-1234567-1234567`), stored in the `shopify_order_id`
  column (the column predates Amazon; the unique key is brand + channel + id). **Order time** =
  `PurchaseDate`. **Revenue** = `OrderTotal` in the marketplace currency (no conversion yet, like
  Shopify); the subtotal is Σ item price − promotion discount when every item carries a price.
- **Excluded**: `Pending` / `PendingAvailability` orders are not stored at all (they have no total
  yet and come back as `Unshipped` on the next incremental run). `Canceled` and `Unfulfillable`
  orders are stored with `cancelled = true`, so a cancellation after the fact neutralises the row.
- **Region**: the order's `ShippingAddress.CountryCode` when Amazon returns it (it does for shipped
  orders; with the restricted role for all), otherwise the marketplace's country (amazon.de → DE,
  from the seller's marketplace list, else a built-in table). The sync log line says how many orders
  used which (`country from shipping N / marketplace M`).
- **New customer**: `customer_key = "amz:" + BuyerInfo.BuyerEmail` — Amazon's anonymised
  `…@marketplace.amazon.de` address, opaque but stable per buyer. The existing first-ever-order rule
  then applies. Keys never collide with Shopify's (`id:` / `email:`), so **NC/RC is per channel**: a
  buyer who ordered on Shopify and then on Amazon is "new" on both. Reading the buyer email needs a
  Restricted Data Token, i.e. the "Direct-to-Consumer Shipping (Restricted)" role; without it the key
  is null and the order counts as new-customer (same as a Shopify guest without email).
- **Cost of goods**: Amazon `SellerSKU` matched (trimmed, case-insensitive) against the Shopify
  variant SKUs now cached in `performance_variant_costs.sku`; cogs = Σ quantity × Shopify unit cost.
  Any unmatched SKU leaves `cogs_complete = false`, so the margin-coverage warning in the header
  fires and the log lists the SKUs. Variants cached before the `sku` column existed are refreshed the
  next time a Shopify order with that variant syncs (or on Full re-sync).
- **Rate limits**: getOrders allows 0.0167 requests/s (burst 20) and getOrderItems 0.5/s, so a
  first backfill of a few thousand orders takes hours; it runs last in the per-brand pass, upserts
  page by page, and backs off on 429 using `x-amzn-RateLimit-Limit`. Incremental runs are small.

API versions (env overrides): `SHOPIFY_API_VERSION` (2025-01), `META_GRAPH_VERSION` (v23.0),
`GOOGLE_ADS_API_VERSION` (v22); Amazon uses Orders API v0, Sellers v1, Tokens 2021-03-01. If a
platform retires a version the Test button shows the error.

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
| Amazon orders sync (SP-API Orders, SKU → Shopify cost) | `server/lib/performance/amazon.ts` |
| Meta hourly spend sync + campaign days | `server/lib/performance/meta.ts` |
| Product-line spend split (campaign days → hourly slices) | `server/lib/performance/productSplit.ts` |
| Google Ads hourly spend sync | `server/lib/performance/googleAds.ts` |
| Sync loop, "Sync now", freshness | `server/lib/performance/sync.ts` |
| Credential encryption | `server/lib/performance/secrets.ts` |
| Tables (migrations `drizzle/0031_performance_dashboard.sql` … `0039_product_lines.sql`) | `performance_client_configs`, `performance_orders` (`channel`), `performance_order_lines`, `performance_customers`, `performance_variant_costs` (`sku`), `performance_spend_hours`, `performance_spend_campaign_days`, `performance_sync_state` |

Hourly-bucket contract (every source must produce it):
`{ t, c: { REGION: [ncOrders, ncRev, rcOrders, rcRev, cogs] }, s: { PLATFORM: [spendPerRegion] } }` — the
dataset carries the brand's `regions` (named ones, then Other); spend arrays are indexed like it.
With product lines configured each bucket also carries `pc: { PRODUCT: { REGION: [ncOrders, ncRev, rcOrders, rcRev] } }`
and `ps: { PRODUCT: [spendPerRegion] }` (`Dataset.products`, "Other / unassigned" last).

### What each sync pulls (so nothing is re-downloaded needlessly)

| Source | First run | Every 10 min after |
| --- | --- | --- |
| Shopify orders | all orders since 1 Jan last year, 250/page | only orders whose `updated_at` moved past the cursor (new, edited, cancelled, refunded) |
| Shopify unit costs | one GraphQL request per 100 distinct variants seen in orders | only variants not cached yet, or cached > 30 days ago (or without SKU) and seen again |
| Amazon orders | all orders created since 1 Jan last year, 100/page + one items call per live order | only orders whose `LastUpdateDate` moved past the cursor |
| Meta spend | hourly rows since 1 Jan last year, 60-day chunks | last 3 days per account (late attribution settles) |
| Meta campaign days | daily spend per campaign × country, same chunks (product-line split) | same 3 days; an account without campaign days yet gets one full re-pull |
| Shopify line items | stored with every order (no extra request) | with every order upsert; a brand whose orders predate product lines re-pulls its window once |
| Google spend | hourly rows since 1 Jan last year, 90-day chunks | last 3 days per account |

**Refresh** on the dashboard runs an incremental sync (the same as "Sync now") and reloads;
the range/country/compare controls only re-read the local database and never call Shopify or
the ad platforms. "Full re-sync" is the only button that redoes the backfill.

## Flags and env

- Client: on in `pnpm dev`; in a production build only when `VITE_FEATURE_PERFORMANCE=1`.
- Server: `/api/performance/*` answers 404 in production unless `FEATURE_PERFORMANCE=1`.
- `PERFORMANCE_DATA_SOURCE=mock|live` — default for brands without a saved config (the panel's
  Data source setting wins per brand).
- `CONNECTIONS_KEY` — 32-byte hex, encrypts stored credentials (already in Marcus's `.env.local`).

## Metric definitions

- Cost of goods (COGS) = Σ quantity × Shopify "Cost per item" over the order's line items (Amazon
  items by SKU match); gross margin % = (revenue − COGS) ÷ revenue. Mock data uses a calibrated ~52% margin.
- CM = revenue − COGS − ad spend
- NC CM = margin × NC revenue − ad spend (all ad spend counts as acquisition); RC CM = margin × RC revenue
- NC revenue = total price of new-customer orders (the "New customer revenue" card); NCPA = ad spend ÷ NC orders; NC ROAS = NC revenue ÷ ad spend
- New customer = first-ever order of that customer (Shopify's and Triple Whale's definition). For
  customers whose Shopify record predates the oldest synced order (with a Partner-organization app
  that is the 60-day floor, with full history the backfill start) the sync fetches the customer's
  lifetime order count (`Customer.numberOfOrders`, scope read_customers) once and stores how many of
  those orders we cannot see (`performance_customers.hidden_orders`); the order is new only when
  none is hidden. Customers without a count (deleted, or the lookup failed) count as returning.
- Platform ROAS/CPA use fixed mock attribution factors (Meta 2.05, Google 6.2, TikTok 2.4)

### By product line (front-end offers)

The table under "By region" repeats the weekly tracker's product rows per region: Ad spend, NC
revenue, NC orders, NC ROAS, NCPA, NC AOV (+ all-customer revenue), with the region's totals as the
group header. Product lines are per brand (Connect data sources → Advanced settings → Product
lines), one per row:

```
GGK & single bundle products = products: -laundry, -durga, -protection | campaigns: ggk
Laundry = products: laundry, durga | campaigns: laundry
```

- **Sales**: every Shopify line item is stored (`performance_order_lines`) and assigned to the first
  product line whose product keywords match its title — case-insensitive substring; `-kw` means the
  title must not contain kw, no plain keyword means any title. This mirrors the Shopify report
  filters the tracker was filled from ("does not contain Laundry, Durga, Protection" → GGK,
  "contains Laundry / Durga" → Laundry). An order counts in **every** product line it has an item in
  (like a line-item report, so product order counts exceed the region's order count — the tracker's
  rows behave the same way), while the order's revenue (the configured revenue field) is split
  across its product lines in proportion to the net line value, so product revenue adds up to the
  region's revenue. Items no product line claims (Shipping Protection) and orders without stored
  items (Amazon) sit in "Other / unassigned".
- **Spend**: Meta is also pulled at campaign level per day and country
  (`performance_spend_campaign_days`); a campaign maps to a product line by the campaign keywords
  (GoE: `LVRG_CBO_GGK_CA`, `LVRG_CBO_LAUNDRY_US`, …). Each hourly spend slice is split in the
  proportions of that day's **attributed** spend for the same account and country — so spend no
  rule claims (promo campaigns, retargeting) is distributed pro-rata over the product lines, the
  same rule as the tracker's promo column. Fallbacks: the day's shares across all countries of the
  account, then any campaign day of the same region (how Google spend without campaign data is
  split), else "Other / unassigned". NC ROAS and NCPA per product therefore include the
  distributed share.
- Changing product lines re-assigns the stored line items and campaign days in SQL; nothing is
  re-downloaded except the one-time re-pull when a brand had no line items yet.
- Difference to the tracker: the tracker's product revenue is Shopify "gross sales" (before
  discounts, tax and shipping); Inana uses the same revenue definition as the rest of the dashboard
  (order total by default), so absolute revenue differs slightly while ROAS/NCPA stay comparable in
  shape.

## Still open (not blocking the live dashboard)

1. Prospecting vs. remarketing split of spend is not modelled (all spend = acquisition spend, so
   RC CM carries no spend). A real split needs the campaign naming convention → per-campaign
   insights (Phase 4).
2. Platform ROAS/CPA in the by-platform table still use mock attribution factors; platform-reported
   conversions come with the campaign-level pull (Phase 4).
3. TikTok and Windsor.ai fallback (Phase 4). Refund netting, currency conversion across sources (the dashboard shows every figure in
   the Shopify shop's currency — CAD for Guests on Earth, EUR for wellbe — and cuts "Today" at the
   shop's midnight, both read from `shop.json` on every sync; Amazon totals and ad spend are stored
   in their own currency as-is and are not converted, so a USD ad account on a CAD shop would mix), auth hardening for
   production (Phase 5). Amazon: the Reports API (`GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL`)
   would make the first backfill minutes instead of hours; Amazon ad spend (Advertising API) is a
   separate platform and not pulled.
4. Merge note: `drizzle/0031_performance_dashboard.sql` was generated from `main` (regenerated on
   2026-11-10 to include unit costs; the dev DB was reset to it). The unmerged `ai-employees`
   branch has its own 0031 (already applied to the shared dev DB) — renumber on merge.

## Deliberate Phase A choices

- Client config + credentials live in `performance_client_configs` (one row per brand), written
  from the panel; brands without a row run on defaults (mock).
- Styling follows the live Studio Control Room look (dark cards, cyan accent, mono labels), not
  the pale-lavender description in the spec, because that is what the running app uses.
- Hand-rolled SVG sparklines (no chart lib), identical to the reference.
