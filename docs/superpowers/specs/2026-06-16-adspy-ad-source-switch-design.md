# AdSpy Ad-Source Switch — Design Spec

> Date: 2026-06-16
> Scope: Replaces the **competitor + keyword AD source** of the Ad Inspo Console (formerly "Ad Console") — swapping the **gethookd** API for the **AdSpy** API. The **organic** stream (IG Reels + TikTok via Apify) is unchanged. Supersedes `2026-06-14-gethookd-competitor-ad-stream-design.md`.
> Status: gethookd integration lives on the unmerged `gethookd-ad-source` branch; this work cuts a fresh `adspy-ad-source` branch from its tip and removes gethookd entirely.

---

## 1. Summary

gethookd gave us a calibrated `performance_score` but no real engagement counts, no deep link to the live ad, and a brittle name→brand resolution (Ryze resolved to the wrong brand; MUD\WTR was unfindable). The **AdSpy** API (verified live 2026-06-16 with the $149/mo API add-on active) returns, per ad:

- **real share counts** (`snapshot.shareNum`) plus the full reaction breakdown — the metric we rank on;
- a **deep link to the actual FB/IG post** (`linkToAd`);
- an **exact, cacheable advertiser identity** (`actor.userId` / `actor.username`) that matches the deep-link page id — making competitor matching exact instead of fuzzy;
- **country filtering** and **server-side `orderBy: total_shares`**, so the highest-shared ads arrive on page 1.

We replace gethookd with AdSpy as the sole ad source, rank by **log-scaled real shares** inside the existing relevance-first composite, and scope every pull to the **US, CA, UK, AU** markets.

---

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Ad source | **Full replace** — AdSpy is the sole source for competitor + keyword ADS. gethookd (`gethookd.ts`, its ingest paths, env vars, `competitors.gethookd_brand_id` / `brandspy_active`) is removed. |
| Organic | **Unchanged** — stays on Apify (IG Reel + TikTok). AdSpy is ads-only. |
| Market scope | **US, CA, UK, AU** on every request (`countries: ["US","CA","UK","AU"]`; AdSpy's UK code is `"UK"`, not `GB`). |
| Rank metric | **Real shares**, log-scaled to 0–1, as the `traction` term. |
| Ranking model | **Relevance-first composite** (unchanged shape): `0.5·relevance + 0.35·traction + 0.15·recency + 0.30·competitorBoost`. |
| Competitor matching | **Verified-only** for the advertiser's own ads — gated by exact `actor.userId === fb_page_id` (FB) or `actor.username === ig_handle` (IG); resolved advertiser id is cached. Unverifiable competitors yield no *own-ad* rows (logged + surfaced in Setup). |
| Competitor name-in-copy | **Also search the competitor name in ad text** (`searches:[{type:"texts"}]`, ungated) to catch whitelisted/affiliate ads running the competitor's copy. Tagged with the competitor → same relevance as the competitor's own ads. |
| Keyword discovery | **Kept** — angle Problem + Outcome phrases searched against ad copy. |
| Platforms / media | **Both** FB + IG, **both** video + static (statics-only toggle still filters client-side). |
| Polling cadence | **Weekly** manual "Pull this week's feed" (unchanged). |

---

## 3. Architecture & data flow

Unchanged seam — only the ad **source** swaps. The Console never calls AdSpy; a server-side pull writes into the existing `ad_creatives` pool, which the ranker turns into per-brand `feed_items`.

```
"PULL THIS WEEK'S FEED" (server-side, weekly)
  adspy client (server/lib/adspy.ts) ──► POST /api/ad, countries=US/CA/UK/AU, orderBy=total_shares
    LANE 1 — Competitor ads (per tracked competitor)
       1a. Verified advertiser pull   → competitor's OWN ads (exact userId match, cached)
       1b. Name-in-copy text search   → whitelisted/affiliate clones of their copy
    LANE 2 — Keyword/angle discovery
       texts search on Problem+Outcome angle phrases (brand_keyword_sets)
  ──► normalizeAdspyAd ──► upsert into ad_creatives (source="adspy")
  ──► rankAdConsoleFeed: traction = log-scaled shares ──► feed_items (per brand)
  organic lane (Apify) runs unchanged in the same pull
```

Files:
- **NEW** `server/lib/adspy.ts` — REST client + `normalizeAdspyAd` + `scoreAdspyTraction` + `isAdspyConfigured()` (mirrors the old `gethookd.ts` shape).
- **REWRITE** `server/lib/adConsoleAds.ts` — two lanes against AdSpy (below). Drop `resolveGethookdBrand`, BrandSpy, `/explore`.
- **EDIT** `server/lib/adConsoleFeed.ts` — `adTraction` = log-scaled `shares`.
- **DELETE** `server/lib/gethookd.ts` + its test.
- **EDIT** `server/lib/env.ts`, route gates, `client/src/lib/api.ts` types, Console card UI.

---

## 4. AdSpy API reference (verified live 2026-06-16)

- **Base:** `https://api.adspy.com` · **Auth:** `Authorization: Bearer ${ADSPY_TOKEN}` (OAuth password-grant token; **can expire → 401**).
- **Search:** `POST /api/ad`, `Content-Type: application/json`. **10 ads per page.**
- **Request body** (all optional unless noted):
  - `searches`: `[{ type, value, locked }]` — `type` ∈ `texts | advertisers | urls | lp_urls | comments | page_text`; `locked` false = OR / true = AND across same-type entries.
  - `countries`: 2-letter codes, e.g. `["US","CA","UK","AU"]`.
  - `siteType`: `facebook | instagram` (omit = both). `mediaType`: `video | photo` (omit = both).
  - `seenBetween` / `createdBetween`: `["DD-MMM-YYYY","DD-MMM-YYYY"]`.
  - `username` (exact advertiser username) · `userId` (exact advertiser id) — the cached fast path.
  - `orderBy`: `total_shares | total_likes | total_loves | created_on_asc | …` (default: created desc).
  - `page`: positive int.
- **Response:** JSON **array of 10 ad objects**. Per-ad fields used:
  - `id` (ad id, dedup key) · `isIg` (bool) · `adType` (`Video|Image`) · `text` (primary copy) · `createdOn`.
  - `actor`: `{ userId, name, username, profilePicture }` — advertiser identity.
  - `snapshot`: `{ shareNum, likeNum, commentsNum, loveNum, hahaNum, wowNum, sadNum, angryNum }` — engagement.
  - `mainAttachment`: `{ type, videoUrl, imageUrl, actionLinkTitle (CTA), url (landing), state }`.
  - `linkToAd`: deep link to the live FB/IG post, e.g. `https://www.facebook.com/{pageId}/posts/{id}` where `{pageId} === actor.userId`.
- **Confirmed:** `GET /api/affnetwork` → 200 (auth ok); `POST /api/ad` → 200 with 10 results (was 400 before the add-on). `/api/affnetwork` and `/api/tech` provide id lookups for the optional `affNetwork`/`tech` filters (not used in v1).

---

## 5. Search strategy

### Lane 1 — Competitor ads

For each `active` competitor, run **two** searches, both with `countries=US/CA/UK/AU`, `orderBy=total_shares`, `seenBetween` = last 12 months:

**1a. Verified advertiser pull (the competitor's own ads).**
1. **Cached fast path:** if `competitor.adspy_advertiser_id` is set → `POST /api/ad { userId: <id>, … }`, page to cap. Exact; no fuzzy matching.
2. **First-time resolve:** `searches:[{type:"advertisers", value: competitor.name, locked:false}]`, page 1..K. Group candidate ads by `actor.userId`. **Verify** a candidate advertiser:
   - **FB ad** (`isIg=false`): `actor.userId === competitor.fb_page_id` (page id also extractable from `linkToAd`).
   - **IG ad** (`isIg=true`): normalized `actor.username === competitor.ig_handle`.
   On the first verified candidate: cache `actor.userId → competitor.adspy_advertiser_id`, set `adspy_verified=true`, ingest its top-shared ads.
3. **Unverifiable** (competitor has neither `fb_page_id` nor `ig_handle`, or no candidate verifies): contribute **0 own-ad rows**; log + surface a count in Setup ("N competitors couldn't be verified on AdSpy"). No wrong-brand ad ever enters the feed.

**1b. Competitor-name-in-copy (whitelisted/affiliate clones).**
`searches:[{type:"texts", value: competitor.name, locked:false}]`, page to cap. **No verification gate** — these ads are often run by third-party/whitelisted accounts using the competitor's messaging, so they won't (and shouldn't) match the advertiser id. Tag each with `competitor_id` + provenance marker `nameInCopy` so they get the **same relevance 1.0 + competitor boost** as the brand's own ads, with a card chip `mentions {name}`.

- **Generic-name guard:** for short/generic one-word competitor names (≤ a threshold, e.g. 4 chars or a stop-word brand like "Bloom"), pass the name as a locked exact phrase or skip 1b, to avoid false positives. Per-competitor; logged when skipped.
- **Side benefit:** 1b needs no page id/handle, so it also rescues competitors that fail 1a verification.

### Lane 2 — Keyword/angle discovery

For each angle keyword — the brand's **Problem + Outcome** phrases from `brand_keyword_sets` (same source the gethookd path used) — run `searches:[{type:"texts", value: kw, locked:false}]` + countries + `orderBy=total_shares`, page to cap. Tag `discovery_query = kw`.

### Dedup & precedence

All lanes dedup by AdSpy `id` into the global `ad_creatives` pool (`uniq(source, external_id)`). Precedence when the same ad appears in multiple lanes (first-writer-wins on provenance, but competitor identity is preserved):
1. **1a verified advertiser** (strongest — the real brand ad) →
2. **1b name-in-copy** (`competitor_id` + `nameInCopy`) →
3. **Lane 2 keyword** (`discovery_query`, no competitor).

An ad already tagged to a competitor never loses its `competitor_id` to a later keyword-lane touch.

---

## 6. Ranking model

Composite shape is **unchanged** (relevance-first); only `traction` changes source.

```
adComposite = 0.50·relevance + 0.35·traction + 0.15·recency + (competitorId ? 0.30 : 0)   // clamped to [0,1]
```

- **traction (NEW = log-scaled real shares):**
  `traction = clamp01( (log10(max(shares,1)) − LO_LOG) / (HI_LOG − LO_LOG) )`, with `LO_LOG=1.5` (~31 shares → 0) and `HI_LOG=4.5` (~31k → 1). Tunable constants. Log (not raw/linear) keeps a single mega-viral outlier from flattening the rest while preserving "more shares = higher" within a relevance tier.
- **relevance (unchanged provenance model):** `competitor_id` set (1a or 1b) → 1.0; brand-angle keyword (`discovery_query` ∈ brand-angle pool) → 1.0; generic niche term → 0.6; otherwise → 0.5.
- **recency:** linear decay from `createdOn` over a **365-day** lookback — matching the `seenBetween` pull window (1.0 today → 0 at 365d, floored at 0).
- **competitor boost:** +0.30 when `competitor_id` is set (covers both 1a and 1b).

Net: within a relevance tier the most-shared ads rise; tracked competitors (own ads *and* name-in-copy clones) still outrank a random viral keyword match.

---

## 7. Schema changes (one migration: `0022_adspy_ad_source`)

**`ad_creatives` — add:**
- `shares` integer — `snapshot.shareNum` (rank driver).
- `likes` integer — `snapshot.likeNum` (display/secondary).
- `deep_link_url` text — `linkToAd` (the live FB/IG post).

Repurpose (no DDL): `traction_score` = log-scaled shares; `source` = `"adspy"`; `advertiser_name`/`page_id` from `actor`; `page_url`/`landing_url` from `mainAttachment.url`; `format` from `adType` (`Video→video`, else `static`); `cta` from `actionLinkTitle`; `media_urls`/`thumbnail_url` from attachments; `ad_start`/recency from `createdOn`; `variation_count` unused (AdSpy has no equivalent). Full ad kept in `raw_json`. Platform (FB vs IG) is derivable from `deep_link_url` / `isIg` in `raw_json` — no new column.

**`competitors` — add `adspy_advertiser_id` text, `adspy_verified` boolean default false; drop `gethookd_brand_id`, `brandspy_active`.**

> Migration `0022` runs after the dev-applied gethookd migrations `0019`–`0021`; it drops the gethookd columns added in `0019` and adds the AdSpy columns.

---

## 8. UI changes (Console card)

- **"View original ad ↗"** link → `deep_link_url` (opens the live FB/IG post — new capability gethookd lacked).
- **Real share-count badge** on competitor/keyword ad cards (e.g. `↗ 3.0K shares`), using the new `shares` field; likes as a secondary stat.
- `mentions {name}` provenance chip for 1b name-in-copy ads.
- No new rails or layout changes; the statics-only toggle and three-rail layout are untouched.

---

## 9. Caps, quota, token, risks

- **Caps (tunable):** ~2–3 pages/competitor for 1a, ~2 pages for 1b, ~1–2 pages/keyword. `orderBy=total_shares` front-loads winners, so small caps suffice. A global per-run request cap guards runaway pulls.
- **Quota — verify before scaling:** AdSpy's rate limit and whether the $149 add-on is metered vs unlimited are **unknown**. v1 ships conservative caps + sequential/low-concurrency requests; we confirm real limits on the first live pull and tune.
- **Token:** `ADSPY_TOKEN` is in `.env.local` (gitignored); **must be added to production env at ship**. Password-grant tokens expire → a typed `AdspyAuthError` surfaces a clear "AdSpy token expired (401) — re-mint" in the pull status rather than failing silently. Auto-refresh from stored credentials is **out of scope** (a creds decision; the user mints the token).
- **Generic competitor names:** 1b text search noise mitigated by the locked-exact-phrase / skip guard (§5).
- **DATABASE_URL** stays per-environment; no dev secret is copied to prod.

---

## 10. gethookd removal checklist

- Delete `server/lib/gethookd.ts` + its test file.
- Remove `GETHOOKD_API_KEY`, `GETHOOKD_BASE_URL`, `GETHOOKD_CREDIT_RESERVE` from `server/lib/env.ts` and `.env.local`.
- Replace `isGethookdConfigured()` route gates with `isAdspyConfigured()`.
- Remove gethookd references/strings (`"gethookd"` source, comments) across `adConsoleAds.ts`, `api.ts`, schema comments.
- Drop `gethookd_brand_id` + `brandspy_active` in migration `0022`.

---

## 11. Testing & verification

- **Unit (vitest, `--root .`):** `normalizeAdspyAd` (field mapping incl. deep link + shares); `scoreAdspyTraction` (log mapping, clamps, shares=0); the verification matcher (`actor.userId===fb_page_id`, `actor.username===ig_handle`, normalization); country-code mapping (`UK` not `GB`); generic-name guard.
- **Live (dev, Alcami Elements):** run a real pull → confirm (1a) a competitor verifies + locks `adspy_advertiser_id`; (1b) name-in-copy returns clones with `mentions` chips; Lane 2 keyword ads carry `discovery_query`; `shares`/`deep_link_url` populated; cards open the live ad; feed orders by shares within relevance tiers; unverifiable competitors are counted in Setup.
- **Type/build:** `pnpm check` green; partial-staged commits on `adspy-ad-source`.

---

## 12. Out of scope (v1)

- AdSpy token auto-refresh from stored credentials.
- `affNetwork` / `tech` / demographic filters (data captured in `raw_json` for later).
- Landing-domain verification (no competitor website domain stored today; page-id/handle is the v1 verifier).
- Any change to the organic (Apify) stream, weekly-ideas rail, or Creative Brief handoff.
