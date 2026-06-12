import { env } from "./env.js";

// ---------------------------------------------------------------------------
// Apify Reddit harvesting for resonance mining.
//
// Anthropic's web_search/web_fetch can't reliably open Reddit (JS-rendered +
// bot-blocked, and Reddit's public .json API returns 403 since May 2026). So
// for real first-person resonance statements we harvest Reddit through Apify's
// `trudax/reddit-scraper` actor, which parses Reddit's server-rendered HTML and
// returns structured posts + comments WITH their real permalinks. Claude then
// curates the best statements from this real pool (see dfy_resonance_curate).
//
// We call Apify's REST run-sync endpoint directly (no SDK dependency): it runs
// the actor and returns the dataset items in a single HTTP request.
// ---------------------------------------------------------------------------

// trudax/reddit-scraper-lite: same build as trudax/reddit-scraper but
// pay-per-result (no monthly rental). Path form uses ~ instead of /.
const ACTOR_ID = "trudax~reddit-scraper-lite";
const RUN_SYNC_URL = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items`;

export type RedditStatement = {
  text: string; // the post/comment body (verbatim)
  url: string; // the real permalink — never fabricated
  score: number; // upvotes (for ranking)
  subreddit: string; // e.g. "r/decaf"
  kind: "post" | "comment";
};

export function isApifyConfigured(): boolean {
  return Boolean(env.APIFY_TOKEN);
}

// Defensive extractor: actor output field names vary by version, so read from a
// set of likely candidates rather than assuming one shape.
function pick(item: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pickNumber(item: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

// Reddit bodies come back HTML-escaped (e.g. `I&#39;ll`, `&amp;`). Decode the
// common entities and strip zero-width junk so downstream text is clean.
function decodeEntities(s: string): string {
  return s
    .replace(/&#x200b;/gi, "")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&"); // ampersand last, so it can't re-form an entity
}

// The reddit-scraper-lite actor scrapes old-Reddit's RSS feed, so a POST's
// `body` is wrapper boilerplate ("submitted by /u/x [link] [comments]"), never
// the real selftext. Strip that junk; whatever real selftext survives is kept,
// otherwise the title carries the pain.
function stripPostBoilerplate(s: string): string {
  return s
    .replace(/submitted by\s*\/u\/\S+/gi, "")
    .replace(/\[link\]/gi, "")
    .replace(/\[comments?\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeItem(item: Record<string, unknown>): RedditStatement | null {
  const dataType = pick(item, ["dataType", "type"]).toLowerCase();
  const isComment = dataType.includes("comment");
  // For comments, the body IS the voice. For posts, the pain lives in the title
  // (this actor never returns usable selftext — just RSS boilerplate), so use
  // the title plus any selftext that survives boilerplate stripping.
  const title = pick(item, ["title"]);
  const rawBody = pick(item, ["body", "text", "content", "selftext"]);
  let text: string;
  if (isComment) {
    text = rawBody;
  } else {
    const cleanBody = stripPostBoilerplate(decodeEntities(rawBody));
    text = [title, cleanBody].filter(Boolean).join(" — ");
  }
  text = decodeEntities(text).replace(/\s+/g, " ").trim();
  const url = pick(item, ["url", "link", "permalink", "postUrl"]);
  if (!text || !url) return null;
  const subRaw = pick(item, ["communityName", "subreddit", "community"]);
  const subreddit = subRaw ? (subRaw.startsWith("r/") ? subRaw : `r/${subRaw.replace(/^\/?r\//, "")}`) : "";
  const score = pickNumber(item, ["upVotes", "score", "numberOfUpVotes", "ups"]);
  return { text, url, score, subreddit, kind: isComment ? "comment" : "post" };
}

export type HarvestSpec = {
  subreddits?: string[]; // e.g. ["decaf", "Anxiety"] — search is scoped to these
  searchTerms: string[]; // OR-joined into the search query
  anchorTerms?: string[]; // ≥1 must appear in an item for it to count (relevance gate)
};

// Build a Reddit search query string by OR-joining the pain terms (quoting
// multi-word phrases so they match as phrases).
function buildSearchQuery(terms: string[]): string {
  return terms
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.includes(" ") ? `"${t}"` : t))
    .join(" OR ");
}

// One server-rendered search-results URL per subreddit, scoped to that
// community (restrict_sr) and sorted by TOP of all time (sort=top&t=all) — so
// Reddit returns the highest-upvoted threads for the query first. The actor
// crawls those posts in that order, then (skipComments:false) pulls their
// comment trees (Reddit's "best"/top-first order) — so both posts AND comments
// come from the most-resonant threads in on-topic communities. We can't read a
// numeric vote count from this actor, so this top-ordering is how popularity is
// captured: harvest order ≈ community resonance.
function buildSearchUrls(subreddits: string[], query: string): Array<{ url: string }> {
  const q = encodeURIComponent(query);
  return subreddits
    .map((s) => s.trim().replace(/^\/?r\//i, ""))
    .filter(Boolean)
    .slice(0, 8)
    .map((sub) => ({
      url: `https://www.reddit.com/r/${sub}/search/?q=${q}&restrict_sr=1&sort=top&t=all&type=link`,
    }));
}

/**
 * Harvest real Reddit posts + comments for an angle's pain. When subreddits are
 * given, the search is scoped to those communities (far higher relevance than a
 * global Reddit search). Results are filtered by anchor terms, deduped, and
 * ranked. Throws on transport/auth errors so the caller can fall back.
 */
export async function harvestRedditStatements(
  spec: HarvestSpec,
  opts?: { maxItems?: number; timeoutMs?: number },
): Promise<RedditStatement[]> {
  if (!env.APIFY_TOKEN) throw new Error("APIFY_TOKEN not set");
  const searchTerms = spec.searchTerms.map((q) => q.trim()).filter(Boolean);
  if (searchTerms.length === 0) return [];
  const query = buildSearchQuery(searchTerms);
  const subreddits = (spec.subreddits ?? []).filter(Boolean);

  const maxItems = opts?.maxItems ?? 80;
  // Prefer subreddit-scoped startUrls; fall back to a global search only if the
  // planner gave us no subreddits.
  const scoped = subreddits.length > 0;
  const input: Record<string, unknown> = scoped
    ? {
        startUrls: buildSearchUrls(subreddits, query),
        maxItems,
        maxPostCount: 12,
        maxComments: 6,
        skipComments: false,
        sort: "top",
        proxy: { useApifyProxy: true },
      }
    : {
        searches: [query],
        searchPosts: true,
        searchComments: true,
        searchCommunities: false,
        searchUsers: false,
        maxItems,
        maxPostCount: 12,
        maxComments: 6,
        skipComments: false,
        sort: "top",
        proxy: { useApifyProxy: true },
      };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 240_000);
  let res: Response;
  try {
    res = await fetch(`${RUN_SYNC_URL}?token=${encodeURIComponent(env.APIFY_TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Apify run failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const items = (await res.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(items)) throw new Error("Apify returned a non-array dataset");

  // One-time visibility into the real output shape, so field mapping can be
  // confirmed/tightened against live data during dev testing.
  if (items.length > 0) {
    console.log(`[apify] reddit harvest: ${items.length} raw items; first item keys=[${Object.keys(items[0]).join(",")}]`);
  } else {
    console.log("[apify] reddit harvest: 0 raw items");
  }

  // Relevance gate: an on-topic item must contain at least one anchor term.
  // This strips noise that a broad search can pull in (off-topic subs, fiction,
  // jokes) while keeping anything genuinely about the pain.
  const anchors = (spec.anchorTerms ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean);
  const passesAnchor = (text: string) => {
    if (anchors.length === 0) return true;
    const lc = text.toLowerCase();
    return anchors.some((a) => lc.includes(a));
  };

  const seen = new Set<string>();
  const out: RedditStatement[] = [];
  let droppedOffTopic = 0;
  for (const raw of items) {
    const s = normalizeItem(raw);
    if (!s) continue;
    if (s.text.length < 25) continue;
    if (!passesAnchor(s.text)) {
      droppedOffTopic++;
      continue;
    }
    // Dedupe by URL, then by normalized text.
    const key = s.url || s.text.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  console.log(
    `[apify] reddit harvest: ${out.length} on-topic statements (dropped ${droppedOffTopic} off-topic by anchor gate) from ${items.length} raw`,
  );
  // Popularity ranking: this actor exposes no numeric vote count, so we rely on
  // Reddit's own ordering — the search is sorted top-of-all-time and comments
  // come back best-first, and the dedupe loop preserves that harvest order. So
  // `out` is already most-resonant-first; do NOT re-sort (a score-based sort
  // would be a no-op here and would only risk disturbing that order).
  return out;
}

/** Render harvested statements into a compact candidate list for the curator prompt. */
export function formatCandidates(statements: RedditStatement[], opts?: { maxPerItem?: number }): string {
  const maxPerItem = opts?.maxPerItem ?? 600;
  return statements
    .map((s) => {
      const text = s.text.length > maxPerItem ? `${s.text.slice(0, maxPerItem)}…` : s.text;
      const meta = [s.subreddit, s.kind, s.score ? `${s.score} upvotes` : ""].filter(Boolean).join(" · ");
      return `- [${meta}] "${text}" (${s.url})`;
    })
    .join("\n");
}
