/**
 * DESIGN: Studio Control Room — Ad Creative Console
 *
 * A swipeable "command center" of proven creative signal for the active brand.
 * Three rails sit side by side:
 *   - LEFT   — Competitor Ads (longest-running FB Ad Library creatives)
 *   - CENTER — Trending Organic (highest-traction IG/TikTok posts) — the wide,
 *              center-top hero feed per the design directive
 *   - RIGHT  — This Week's Ideas (LLM-GENERATED fresh concepts, not scraped)
 *
 * Each card carries a "Make it mine" → Creative Brief handoff and a "Skip".
 * Above the rails: a control bar to Pull this week's feed (Apify ads+organic+rank,
 * polled to completion) and Generate ideas (one LLM call). A collapsible Setup
 * panel manages the niche classification and the competitor watchlist.
 *
 * Access: managers + admins, ANY brand (no DFY gate). The page re-checks the
 * role so a hand-typed URL can't bypass the hidden nav; mutations are also
 * gated server-side with requireManager.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radar, Loader2, ShieldAlert, Building2, RefreshCw, Sparkles, Settings2,
  Plus, Trash2, Archive, ArrowUpRight, Wand2, Play,
  Megaphone, Flame, Lightbulb, X, ExternalLink, Clock, Eye, Bookmark, Share2, Heart,
  CheckCircle2, AlertTriangle, ChevronDown,
} from "lucide-react";
import {
  adConsoleImg,
  getAdConsoleNiche, bootstrapAdConsole, detectAdConsoleNiche,
  listAdConsoleCompetitors, addAdConsoleCompetitor,
  updateAdConsoleCompetitor, deleteAdConsoleCompetitor,
  listAdConsoleKeywordSets,
  getAdConsoleKeywords, addAdConsoleKeyword, removeAdConsoleKeyword, generateAdConsoleKeywords, regenerateAdConsoleKeywords,
  type AdConsoleSearchTerms, type AdConsoleSearchLane,
  getAdConsoleFeed, selectAdConsoleFeedItem, skipAdConsoleFeedItem,
  rankAdConsoleFeed,
  startAdConsoleFeedPull, getAdConsoleFeedPullStatus,
  getAdConsoleIdeas, generateAdConsoleIdeas, selectAdConsoleIdea, skipAdConsoleIdea,
  createAdPipelineCard, listProducts, type Product,
  ApiCallError,
  type AdConsoleNicheState, type AdConsoleCompetitor, type AdConsoleFeedCard,
  type AdConsoleOrganicPost,
  type AdConsoleCreativeBrief, type AdConsoleFeedPullRun, type AdConsoleIdea,
} from "@/lib/api";
import { useBrand } from "@/contexts/BrandContext";
import { useAuth } from "@/contexts/AuthContext";
import { LANGUAGES } from "@/lib/mockData";

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

type Notice = { kind: "info" | "success" | "error"; text: string };

/** Compact number formatting: 12345 → "12.3K", 1200000 → "1.2M". */
function compact(n: number | null | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * True when a URL looks like a playable video file. FB/IG/TikTok CDN video
 * URLs are signed and end in .mp4/.m3u8 (sometimes before a query string) or
 * live on a `video.*` / `video-*` host. We can't fetch headers from the
 * client, so this string heuristic is how the card decides to mount a
 * <video> instead of an <img>.
 */
function isLikelyVideoUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  try {
    const url = new URL(u);
    if (/\.(mp4|m3u8|webm|mov)(\?|$)/i.test(url.pathname)) return true;
    if (/^video[-.]/i.test(url.hostname)) return true;
    return false;
  } catch {
    return /\.(mp4|m3u8|webm|mov)(\?|$)/i.test(u);
  }
}

/**
 * Resolve a card's playable video URL, or null for a static creative.
 * Ads: collectMedia() lists images first, then the video file, then its
 * preview image — so we scan mediaUrls for the first video-looking URL rather
 * than trusting index 0. Organic: mediaUrl is the video itself when the post
 * is a reel/clip (thumbnailUrl is the cover).
 */
function pickVideoUrl(card: AdConsoleFeedCard): string | null {
  const { ad, organic } = card;
  if (ad) {
    return (ad.mediaUrls ?? []).find(isLikelyVideoUrl) ?? null;
  }
  if (organic) {
    if (isLikelyVideoUrl(organic.mediaUrl)) return organic.mediaUrl;
    // Trust an explicit video format even when the CDN URL is opaque.
    if ((organic.format ?? "").toLowerCase() === "video" && organic.mediaUrl) return organic.mediaUrl;
  }
  return null;
}

/**
 * Durable, in-card playback for organic posts via the platforms' own embed
 * players — the only reliable option since TikTok never returns a hotlinkable
 * file (mediaUrl is null) and Instagram's signed CDN URL expires. TikTok keys
 * off the numeric video id (externalId); Instagram off the /p|reel/<code>/ slug.
 */
function tiktokEmbedUrl(post: AdConsoleOrganicPost): string | null {
  if (post.source !== "tiktok") return null;
  const id = (post.externalId ?? "").trim();
  if (!/^\d{6,}$/.test(id)) return null;
  // autoplay=1 is fine: the iframe is mounted only after the operator clicks the
  // card's play button (the facade), so nothing ever plays on load/scroll.
  return `https://www.tiktok.com/player/v1/${id}?autoplay=1&controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1&music_info=0&description=0&rel=0&native_context_menu=0`;
}

function instagramEmbedUrl(post: AdConsoleOrganicPost): string | null {
  if (post.source !== "instagram") return null;
  const m = (post.postUrl ?? "").match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i);
  return m ? `https://www.instagram.com/reel/${m[1]}/embed/` : null;
}

/**
 * Resolve an organic post's in-card PLAYER iframe, or null to play the raw
 * <video> instead. TikTok has no hotlinkable file → always its player iframe.
 * Instagram's raw video_url IS cross-origin-playable (CORP: cross-origin,
 * ACAO: *), so we play it inline in a <video> — one click, no new tab; the
 * /reel/<code>/embed iframe is only a fallback for a reel with no video URL.
 */
function pickOrganicEmbedUrl(card: AdConsoleFeedCard, videoUrl: string | null): string | null {
  const { organic } = card;
  if (!organic) return null;
  if (organic.source === "tiktok") return tiktokEmbedUrl(organic);
  if (organic.source === "instagram") return videoUrl ? null : instagramEmbedUrl(organic);
  return null;
}

/** A pull-run is mid-flight (started, not yet settled). */
function isRunning(run: AdConsoleFeedPullRun | null): boolean {
  return run?.status === "running";
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function AdConsolePage() {
  const { activeBrand, activeBrandId } = useBrand();
  const { role } = useAuth();
  const [, navigate] = useLocation();

  const canUse = role === "admin" || role === "manager";
  // The Ad Console is DFY-only: shown only for brands an admin has flagged a DFY
  // client. The nav hides it for non-DFY brands; we re-check here so a hand-typed
  // URL can't bypass it.
  const isDfy = Boolean(activeBrand?.isDfyClient);

  // Core data
  const [niche, setNiche] = useState<AdConsoleNicheState | null>(null);
  const [competitors, setCompetitors] = useState<AdConsoleCompetitor[]>([]);
  const [keywordSetCount, setKeywordSetCount] = useState<number | null>(null);
  const [feedCards, setFeedCards] = useState<AdConsoleFeedCard[]>([]);
  const [ideas, setIdeas] = useState<AdConsoleIdea[]>([]);
  const [pullRun, setPullRun] = useState<AdConsoleFeedPullRun | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Competitor-ads rail filter: when on, show only static (non-video) creatives.
  const [staticsOnly, setStaticsOnly] = useState(false);

  // "What is this feed?" explainer — dismissible, remembered per browser.
  const [explainerDismissed, setExplainerDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("adConsoleExplainerDismissed") === "1";
    } catch {
      return false;
    }
  });
  function dismissExplainer() {
    setExplainerDismissed(true);
    try {
      localStorage.setItem("adConsoleExplainerDismissed", "1");
    } catch {
      /* private mode — best effort */
    }
  }

  // Background bootstrap (auto niche + competitors + keywords). Fires once per
  // brand per mount when the brand isn't set up yet; the ref de-dupes re-fires.
  const [bootstrapping, setBootstrapping] = useState(false);
  const bootstrappedRef = useRef<Set<string>>(new Set());

  // Transient UI
  const [notice, setNotice] = useState<Notice | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [brief, setBrief] = useState<AdConsoleCreativeBrief | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  // Busy flags for the control bar
  const [pulling, setPulling] = useState(false);
  const [generatingIdeas, setGeneratingIdeas] = useState(false);

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((n: Notice) => {
    setNotice(n);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }, []);

  // Products (for the "Recreate now" product/angle picker in BriefModal).
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    if (!activeBrandId) return;
    listProducts(activeBrandId).then(({ products }) => setProducts(products)).catch(() => setProducts([]));
  }, [activeBrandId]);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const refreshFeed = useCallback(async () => {
    if (!activeBrandId) return;
    // Fetch each rail independently: competitor-ad composites are hard-tiered
    // above organic, so a single combined top-N query would starve the organic
    // rail (all top slots would be ads). Per-rail limits keep both populated.
    const [comp, org] = await Promise.all([
      getAdConsoleFeed(activeBrandId, { rail: "competitor_ads", status: "new", limit: 200 }),
      getAdConsoleFeed(activeBrandId, { rail: "trending_organic", status: "new", limit: 250 }),
    ]);
    setFeedCards([...comp.feed, ...org.feed]);
  }, [activeBrandId]);

  const refreshIdeas = useCallback(async () => {
    if (!activeBrandId) return;
    const { ideas: rows } = await getAdConsoleIdeas(activeBrandId);
    setIdeas(rows);
  }, [activeBrandId]);

  const refreshCompetitors = useCallback(async () => {
    if (!activeBrandId) return;
    const { competitors: rows } = await listAdConsoleCompetitors(activeBrandId);
    setCompetitors(rows);
  }, [activeBrandId]);

  // Initial load — pull everything in parallel.
  useEffect(() => {
    if (!activeBrandId || !canUse || !isDfy) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const [nicheState, comps, keywordSets, compFeed, organicFeed, ideaRows, pullStatus] = await Promise.all([
          getAdConsoleNiche(activeBrandId),
          listAdConsoleCompetitors(activeBrandId),
          listAdConsoleKeywordSets(activeBrandId),
          // Per-rail fetches (ads are score-boosted above organic — see refreshFeed).
          getAdConsoleFeed(activeBrandId, { rail: "competitor_ads", status: "new", limit: 200 }),
          getAdConsoleFeed(activeBrandId, { rail: "trending_organic", status: "new", limit: 250 }),
          getAdConsoleIdeas(activeBrandId),
          getAdConsoleFeedPullStatus(activeBrandId),
        ]);
        if (cancelled) return;
        setNiche(nicheState);
        setCompetitors(comps.competitors);
        setKeywordSetCount(keywordSets.keywordSets.length);
        setFeedCards([...compFeed.feed, ...organicFeed.feed]);
        setIdeas(ideaRows.ideas);
        setPullRun(pullStatus.run);

        // Auto-prepare the brand in the background: detect niche + research
        // competitors + extract angle keywords (all LLM, no Apify spend). Only
        // when something's missing, and only once per brand per mount.
        const needsBootstrap = !nicheState.nicheType || comps.competitors.length === 0;
        if (needsBootstrap && !bootstrappedRef.current.has(activeBrandId)) {
          bootstrappedRef.current.add(activeBrandId);
          setBootstrapping(true);
          void (async () => {
            try {
              await bootstrapAdConsole(activeBrandId);
              const [n2, c2, k2] = await Promise.all([
                getAdConsoleNiche(activeBrandId),
                listAdConsoleCompetitors(activeBrandId),
                listAdConsoleKeywordSets(activeBrandId),
              ]);
              if (cancelled) return;
              setNiche(n2);
              setCompetitors(c2.competitors);
              setKeywordSetCount(k2.keywordSets.length);
            } catch (err) {
              console.error("[ad-console] background bootstrap failed:", err);
              bootstrappedRef.current.delete(activeBrandId); // allow retry next mount
            } finally {
              if (!cancelled) setBootstrapping(false);
            }
          })();
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, canUse, isDfy]);

  // Poll the pull-run while it's in flight; refresh the feed when it settles.
  useEffect(() => {
    if (!activeBrandId || !isRunning(pullRun)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const { run } = await getAdConsoleFeedPullStatus(activeBrandId);
        if (cancelled) return;
        if (run) {
          setPullRun(run);
          if (run.status !== "running") {
            if (run.status === "complete") {
              flash({ kind: "success", text: "Feed refreshed — new cards pulled and ranked." });
              void refreshFeed();
            } else {
              flash({ kind: "error", text: run.error ?? "Feed pull failed." });
            }
            return; // effect re-runs on status change and stops
          }
        }
        timer = setTimeout(tick, 2500);
      } catch {
        if (!cancelled) timer = setTimeout(tick, 4000);
      }
    };
    timer = setTimeout(tick, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeBrandId, pullRun, refreshFeed, flash]);

  // ── Control-bar actions ──────────────────────────────────────────────────────

  async function handlePullFeed() {
    if (!activeBrandId || pulling || isRunning(pullRun)) return;
    setPulling(true);
    try {
      const { run, alreadyRunning } = await startAdConsoleFeedPull(activeBrandId);
      setPullRun(run);
      flash({
        kind: "info",
        text: alreadyRunning ? "A pull is already running — watching it." : "Pulling this week's feed…",
      });
    } catch (err) {
      const msg =
        err instanceof ApiCallError && err.status === 424
          ? "Apify isn't configured on this server — set APIFY_TOKEN to pull live data."
          : err instanceof Error
            ? err.message
            : String(err);
      flash({ kind: "error", text: msg });
    } finally {
      setPulling(false);
    }
  }

  async function handleGenerateIdeas() {
    if (!activeBrandId || generatingIdeas) return;
    setGeneratingIdeas(true);
    try {
      const { summary, ideas: rows } = await generateAdConsoleIdeas(activeBrandId);
      setIdeas(rows);
      flash({
        kind: "success",
        text: `Generated ${summary.generated} fresh idea${summary.generated === 1 ? "" : "s"} (grounded on ${summary.grounding.ads} ads + ${summary.grounding.organic} posts).`,
      });
    } catch (err) {
      const msg =
        err instanceof ApiCallError && err.status === 424
          ? "The weekly_ideas prompt isn't configured on this server yet."
          : err instanceof Error
            ? err.message
            : String(err);
      flash({ kind: "error", text: msg });
    } finally {
      setGeneratingIdeas(false);
    }
  }

  // ── Card actions ────────────────────────────────────────────────────────────

  async function handleMakeItMine(card: AdConsoleFeedCard) {
    if (!activeBrandId || actioningId) return;
    setActioningId(card.item.id);
    try {
      const { brief: b } = await selectAdConsoleFeedItem(activeBrandId, card.item.id);
      setFeedCards((prev) => prev.filter((c) => c.item.id !== card.item.id));
      setBrief(b);
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setActioningId(null);
    }
  }

  async function handleSkipCard(card: AdConsoleFeedCard) {
    if (!activeBrandId || actioningId) return;
    setActioningId(card.item.id);
    try {
      await skipAdConsoleFeedItem(activeBrandId, card.item.id);
      setFeedCards((prev) => prev.filter((c) => c.item.id !== card.item.id));
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setActioningId(null);
    }
  }

  async function handleSelectIdea(idea: AdConsoleIdea) {
    if (!activeBrandId || actioningId) return;
    setActioningId(idea.id);
    try {
      await selectAdConsoleIdea(activeBrandId, idea.id);
      setIdeas((prev) => prev.filter((i) => i.id !== idea.id));
      flash({ kind: "success", text: `Saved "${idea.title ?? "idea"}" to your shortlist.` });
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setActioningId(null);
    }
  }

  async function handleSkipIdea(idea: AdConsoleIdea) {
    if (!activeBrandId || actioningId) return;
    setActioningId(idea.id);
    try {
      await skipAdConsoleIdea(activeBrandId, idea.id);
      setIdeas((prev) => prev.filter((i) => i.id !== idea.id));
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setActioningId(null);
    }
  }

  // ── Split feed into rails ─────────────────────────────────────────────────────
  // Guard against empty cards: a feed item whose joined ad/organic row is missing
  // (orphaned reference) or that has no media would render as a blank "Unknown"
  // placeholder — drop it so the rail only ever shows real, displayable creatives.
  const isRenderable = (c: AdConsoleFeedCard): boolean => {
    if (c.ad) {
      const media = Array.isArray(c.ad.mediaUrls) ? c.ad.mediaUrls : [];
      return media.length > 0 || Boolean(c.ad.thumbnailUrl);
    }
    return Boolean(c.organic);
  };
  const competitorCards = feedCards.filter((c) => c.item.rail === "competitor_ads" && isRenderable(c));
  const organicCards = feedCards.filter((c) => c.item.rail === "trending_organic" && isRenderable(c));
  // "Statics only" filter on the competitor rail — hides video creatives.
  const competitorVisible = staticsOnly
    ? competitorCards.filter((c) => (c.ad?.format ?? "").toLowerCase() === "static")
    : competitorCards;

  const nicheLabel = niche?.stream?.displayName ?? niche?.nicheType ?? null;

  // Distinct search keywords that actually surfaced this feed — shown in the
  // explainer so the brand sees what went into it. Competitor ads carry the
  // literal "competitor" sentinel instead of a query, so we drop it.
  const feedKeywords = Array.from(
    new Set(
      feedCards
        .flatMap((c) => c.item.matchedKeywords ?? [])
        .map((kw) => kw.trim())
        .filter((kw) => kw && kw.toLowerCase() !== "competitor"),
    ),
  ).slice(0, 10);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen lg:h-screen lg:flex lg:flex-col lg:overflow-hidden">
      {/* Header */}
      <div
        className="border-b border-white/[0.06] px-6 py-5 sticky top-0 z-20 lg:shrink-0"
        style={{ background: "#0D0F12" }}
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-white/90 flex items-center gap-2">
              <Radar size={18} className="text-cyan-400" />
              Ad Inspo Console
            </h1>
            <p className="text-xs text-white/30 mt-1 font-mono flex items-center gap-2 flex-wrap">
              <span>{activeBrand ? activeBrand.name : "No brand selected"}</span>
              {nicheLabel && (
                <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300/80 border border-cyan-500/20 uppercase tracking-wider text-[10px]">
                  {nicheLabel}
                </span>
              )}
            </p>
          </div>

          {/* Control bar */}
          {canUse && activeBrand && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleGenerateIdeas()}
                disabled={generatingIdeas}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono tracking-wide border border-violet-500/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 transition-all disabled:opacity-50"
              >
                {generatingIdeas ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                Generate ideas
              </button>
              <button
                onClick={() => void handlePullFeed()}
                disabled={pulling || isRunning(pullRun)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono tracking-wide border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 transition-all disabled:opacity-50"
              >
                {pulling || isRunning(pullRun) ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                {isRunning(pullRun) ? "Pulling…" : "Pull this week's feed"}
              </button>
              <button
                onClick={() => setSetupOpen((v) => !v)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono tracking-wide border transition-all ${
                  setupOpen
                    ? "border-white/15 bg-white/[0.06] text-white/80"
                    : "border-white/[0.08] bg-white/[0.02] text-white/40 hover:text-white/70"
                }`}
              >
                <Settings2 size={13} />
                Setup
              </button>
            </div>
          )}
        </div>

        {/* Pull progress strip */}
        {isRunning(pullRun) && pullRun && <PullProgress run={pullRun} />}
      </div>

      <div className="p-6 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col lg:overflow-hidden">
        {/* Notice banner */}
        <AnimatePresence>
          {notice && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-mono ${
                notice.kind === "error"
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                  : notice.kind === "success"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
              }`}
            >
              {notice.kind === "error" ? (
                <AlertTriangle size={13} />
              ) : notice.kind === "success" ? (
                <CheckCircle2 size={13} />
              ) : (
                <Loader2 size={13} className="animate-spin" />
              )}
              {notice.text}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Guards */}
        {!canUse ? (
          <GuardPanel
            icon={ShieldAlert}
            title="Manager access required"
            body="The Ad Inspo Console is available to managers and admins. Ask an admin to upgrade your role if you need access."
          />
        ) : !activeBrand ? (
          <GuardPanel
            icon={Building2}
            title="No brand selected"
            body="Pick a brand from the switcher in the top-left to load its competitor ads, trending posts, and weekly ideas."
          />
        ) : !isDfy ? (
          <GuardPanel
            icon={ShieldAlert}
            title="DFY clients only"
            body="The Ad Inspo Console is enabled per brand. An admin can flag this brand as a DFY client under Settings → Clients to turn it on."
          />
        ) : loadError ? (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs font-mono text-rose-300">
            Failed to load the console: {loadError}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="text-white/20 animate-spin" />
          </div>
        ) : (
          <>
            {/* "What is this feed?" explainer — dismissible */}
            <AnimatePresence initial={false}>
              {!explainerDismissed && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden lg:shrink-0"
                >
                  <div className="mb-4 flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                    <div className="mt-0.5 shrink-0 rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-1.5">
                      <Sparkles size={14} className="text-cyan-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-relaxed text-white/55">
                        This is{" "}
                        <span className="font-medium text-white/80">
                          {activeBrand ? activeBrand.name : "your brand"}
                        </span>
                        ’s personalized inspiration feed — more than a competitor watch. We pull{" "}
                        <span className="text-indigo-300">competitor ads</span> and research new ads
                        around the main angles you’re targeting, then{" "}
                        <span className="font-medium text-white/80">rank every one by relevance</span>{" "}
                        to your brand. <span className="text-cyan-300">Viral organic videos</span> are
                        surfaced and ranked the same way — so the most on-message ideas rise to the top,
                        ready to recreate.
                      </p>
                      {feedKeywords.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-white/30">
                            Searched for
                          </span>
                          {feedKeywords.map((kw) => (
                            <span
                              key={kw}
                              className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-mono text-white/50"
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={dismissExplainer}
                      aria-label="Dismiss"
                      className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-white/25 transition-colors hover:bg-white/[0.05] hover:text-white/60"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Setup panel (collapsible) */}
            <AnimatePresence initial={false}>
              {setupOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden lg:shrink-0"
                >
                  <SetupPanel
                    niche={niche}
                    nicheLabel={nicheLabel}
                    competitors={competitors}
                    keywordSetCount={keywordSetCount}
                    bootstrapping={bootstrapping}
                    onCompetitorsChange={refreshCompetitors}
                    onFeedRanked={refreshFeed}
                    onNicheChange={setNiche}
                    onNotice={flash}
                    brandId={activeBrandId!}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Three rails — each column scrolls independently on desktop */}
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] items-start lg:items-stretch lg:flex-1 lg:min-h-0">
              {/* Competitor ads — left */}
              <Rail
                icon={Megaphone}
                accent="indigo"
                title="Competitor Ads"
                subtitle="Longest-running creatives in the niche"
                count={competitorVisible.length}
                empty={
                  staticsOnly
                    ? "No static creatives in this rail — turn off “Statics only” to see videos too."
                    : "No ranked competitor ads yet — pull this week's feed to populate this rail."
                }
                controls={
                  <button
                    type="button"
                    role="switch"
                    aria-checked={staticsOnly}
                    onClick={() => setStaticsOnly((v) => !v)}
                    className="group -mx-1 flex select-none items-center gap-2.5 rounded-md px-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-violet-400/40"
                    title="Show only static (non-video) creatives"
                  >
                    <span
                      className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${
                        staticsOnly ? "bg-violet-500/70" : "bg-white/[0.18]"
                      }`}
                    >
                      <span
                        className={`absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                          staticsOnly ? "translate-x-3.5" : "translate-x-0"
                        }`}
                      />
                    </span>
                    <span
                      className={`text-[10px] font-mono tracking-wide transition-colors ${
                        staticsOnly ? "text-violet-200" : "text-white/40 group-hover:text-white/70"
                      }`}
                    >
                      Statics only
                    </span>
                  </button>
                }
              >
                {competitorVisible.map((card) => (
                  <FeedCardView
                    key={card.item.id}
                    card={card}
                    accent="indigo"
                    busy={actioningId === card.item.id}
                    disabled={Boolean(actioningId)}
                    onMakeItMine={() => void handleMakeItMine(card)}
                    onSkip={() => void handleSkipCard(card)}
                  />
                ))}
              </Rail>

              {/* This week's ideas — center, LLM (wide column) */}
              <Rail
                icon={Lightbulb}
                accent="violet"
                title="This Week's Ideas"
                subtitle="Fresh concepts generated for this brand"
                count={ideas.length}
                empty="No ideas yet — hit “Generate ideas” to spin up fresh concepts."
              >
                {ideas.map((idea) => (
                  <IdeaCardView
                    key={idea.id}
                    idea={idea}
                    busy={actioningId === idea.id}
                    disabled={Boolean(actioningId)}
                    onSave={() => void handleSelectIdea(idea)}
                    onSkip={() => void handleSkipIdea(idea)}
                  />
                ))}
              </Rail>

              {/* Trending organic — right column */}
              <Rail
                icon={Flame}
                accent="cyan"
                title="Trending Organic"
                subtitle="Highest-traction posts right now"
                count={organicCards.length}
                empty="No trending posts yet — pull this week's feed to populate this rail."
              >
                {organicCards.map((card) => (
                  <FeedCardView
                    key={card.item.id}
                    card={card}
                    accent="cyan"
                    busy={actioningId === card.item.id}
                    disabled={Boolean(actioningId)}
                    onMakeItMine={() => void handleMakeItMine(card)}
                    onSkip={() => void handleSkipCard(card)}
                  />
                ))}
              </Rail>
            </div>
          </>
        )}
      </div>

      {/* Creative Brief modal */}
      <AnimatePresence>
        {brief && activeBrandId && (
          <BriefModal
            brief={brief}
            products={products}
            brandId={activeBrandId}
            onClose={() => setBrief(null)}
            flash={flash}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pull progress strip
// ─────────────────────────────────────────────────────────────────────────────

function PullProgress({ run }: { run: AdConsoleFeedPullRun }) {
  const steps: Array<{ key: "ads" | "organic" | "rank"; label: string }> = [
    { key: "ads", label: "Ads" },
    { key: "organic", label: "Organic" },
    { key: "rank", label: "Rank" },
  ];
  return (
    <div className="mt-3 flex items-center gap-3">
      {steps.map(({ key, label }) => {
        const s = run.steps[key].status;
        const active = run.currentStep === key;
        return (
          <div key={key} className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider">
            {s === "complete" ? (
              <CheckCircle2 size={12} className="text-emerald-400" />
            ) : s === "failed" ? (
              <AlertTriangle size={12} className="text-rose-400" />
            ) : s === "running" || active ? (
              <Loader2 size={12} className="text-cyan-400 animate-spin" />
            ) : (
              <Clock size={12} className="text-white/20" />
            )}
            <span
              className={
                s === "complete"
                  ? "text-emerald-300/80"
                  : s === "failed"
                    ? "text-rose-300/80"
                    : s === "running"
                      ? "text-cyan-300/80"
                      : "text-white/30"
              }
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rail column
// ─────────────────────────────────────────────────────────────────────────────

type Accent = "indigo" | "cyan" | "violet";

const ACCENT: Record<Accent, { text: string; chip: string; ring: string; dot: string }> = {
  indigo: {
    text: "text-indigo-300",
    chip: "bg-indigo-500/10 text-indigo-300 border-indigo-500/20",
    ring: "border-indigo-500/20",
    dot: "bg-indigo-400",
  },
  cyan: {
    text: "text-cyan-300",
    chip: "bg-cyan-500/10 text-cyan-300 border-cyan-500/20",
    ring: "border-cyan-500/20",
    dot: "bg-cyan-400",
  },
  violet: {
    text: "text-violet-300",
    chip: "bg-violet-500/10 text-violet-300 border-violet-500/20",
    ring: "border-violet-500/20",
    dot: "bg-violet-400",
  },
};

// The primary card action ("Make it mine" / "Save idea") is ONE consistent color
// across every rail — not the per-rail accent — to match the reference card.
const PRIMARY_ACTION_BTN = "bg-violet-500/15 text-violet-200 border-violet-500/30";

function Rail({
  icon: Icon,
  accent,
  title,
  subtitle,
  count,
  empty,
  hero,
  controls,
  children,
}: {
  icon: React.ElementType;
  accent: Accent;
  title: string;
  subtitle: string;
  count: number;
  empty: string;
  hero?: boolean;
  /** Optional control strip rendered directly under the header (e.g. a filter toggle). */
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  const a = ACCENT[accent];
  return (
    <section
      className={`rounded-xl border ${a.ring} bg-white/[0.02] ${hero ? "lg:bg-white/[0.03]" : ""} flex flex-col lg:h-full lg:min-h-0 lg:overflow-hidden`}
    >
      {/* Rail header */}
      <header className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2.5 lg:shrink-0">
        <div className={`w-7 h-7 rounded-lg border ${a.ring} bg-white/[0.03] flex items-center justify-center shrink-0`}>
          <Icon size={14} className={a.text} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-white/85 flex items-center gap-2">
            {title}
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${a.chip}`}>{count}</span>
          </h2>
          <p className="text-[10px] text-white/30 font-mono truncate">{subtitle}</p>
        </div>
      </header>

      {/* Optional control strip (filters) — fixed directly under the header */}
      {controls && <div className="px-4 py-2 border-b border-white/[0.06] lg:shrink-0">{controls}</div>}

      {/* Cards — scroll within the column on desktop */}
      <div className="p-3 space-y-3 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
        {count === 0 ? (
          <div className="px-3 py-10 text-center text-[11px] text-white/30 font-mono leading-relaxed">{empty}</div>
        ) : (
          <AnimatePresence initial={false}>{children}</AnimatePresence>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Feed card (ad or organic)
// ─────────────────────────────────────────────────────────────────────────────

function FeedCardView({
  card,
  accent,
  hero,
  busy,
  disabled,
  onMakeItMine,
  onSkip,
}: {
  card: AdConsoleFeedCard;
  accent: Accent;
  hero?: boolean;
  busy: boolean;
  disabled: boolean;
  onMakeItMine: () => void;
  onSkip: () => void;
}) {
  const a = ACCENT[accent];
  const { ad, organic, item } = card;
  // Organic players (TikTok/IG embeds + IG <video>) are click-to-load: the card
  // shows the cover thumbnail until the operator presses play, then mounts the
  // single player. Avoids 60 platform iframes booting at once (which throttle to
  // black) and means nothing plays on load.
  const [activated, setActivated] = useState(false);
  // IG video URLs are signed + expire; if the raw <video> 403s we fall back to
  // the durable /reel/<code>/embed iframe so a stale reel is still watchable.
  const [videoFailed, setVideoFailed] = useState(false);

  const isOrganic = item.itemType === "organic";
  const advertiser = ad?.advertiserName ?? organic?.profileName ?? organic?.handle ?? "Unknown";
  const handle = organic?.handle ? `@${organic.handle.replace(/^@/, "")}` : null;
  const thumb = ad?.thumbnailUrl ?? ad?.mediaUrls?.[0] ?? organic?.thumbnailUrl ?? organic?.mediaUrl ?? null;
  const videoUrl = pickVideoUrl(card);
  // Organic posts play through the platform's own embed (durable; TikTok has no
  // hotlinkable file and IG's CDN URL expires). Ads + live-URL IG use <video>.
  const embedUrl = pickOrganicEmbedUrl(card, videoUrl);
  // IG embed used as the fallback when the raw video fails (expired URL).
  const embedFallbackUrl = organic?.source === "instagram" ? instagramEmbedUrl(organic) : null;
  // The player to mount when activated: an explicit embed, else (on video error) the fallback embed.
  const activePlayerUrl = embedUrl ?? (videoFailed ? embedFallbackUrl : null);
  const hasMedia = Boolean(embedUrl || videoUrl || thumb);
  // Organic content is vertical (9:16 reels/TikToks). Render it in a fixed
  // vertical frame so the poster fills correctly and the card doesn't jump size
  // when playback starts — <video h-auto> otherwise sits at the browser's 2:1
  // default and a portrait reel collapses into a short black strip. Ads keep
  // their native aspect (FB creatives are landscape/square/various).
  const verticalFrame = Boolean(embedUrl) || (isOrganic && Boolean(videoUrl));
  // Organic cards that have a player (embed or live <video>) use the click-to-load facade.
  const canPlay = isOrganic && Boolean(embedUrl || videoUrl);
  // Organic covers go through the same-origin proxy (IG CDN blocks cross-origin
  // rendering); ad thumbnails (FB CDN) render directly.
  const previewSrc = isOrganic ? adConsoleImg(thumb) : (thumb ?? undefined);
  // Cap height so a 9:16 reel doesn't dominate the column, but let the media
  // keep its native aspect ratio (no crop) — hero cards get a touch more room.
  const mediaMaxH = hero ? "max-h-[80vh]" : "max-h-[68vh]";
  const hook = ad?.hook ?? organic?.hook ?? null;
  const body = ad?.copy ?? organic?.caption ?? null;
  const format = (ad?.format ?? organic?.format ?? "").toLowerCase();
  const sourceUrl = ad?.deepLinkUrl ?? ad?.pageUrl ?? organic?.postUrl ?? ad?.landingUrl ?? null;
  // Labelled "View on …" link to the original organic post.
  const platformLabel =
    organic?.source === "tiktok" ? "TikTok" : organic?.source === "instagram" ? "Instagram" : "Original";
  // Deep-link straight to this creative's Meta Ad Library entry (externalId is
  // the ad_archive_id). Lets the operator confirm an ad really came from the
  // competitor's library, and fall back to the advertiser's full library page.
  // Prefer the AdSpy deep link to the live FB/IG post; fall back to the Meta Ad
  // Library lookup when a legacy row has no deep link.
  const adLibraryUrl = ad?.externalId
    ? `https://www.facebook.com/ads/library/?id=${ad.externalId}`
    : ad?.pageId
      ? `https://www.facebook.com/ads/library/?view_all_page_id=${ad.pageId}`
      : null;
  const adLink = ad?.deepLinkUrl ?? adLibraryUrl;

  // Traction line: ads → runtime/variations/active, organic → views/likes.
  const tractionBits: Array<{ icon: React.ElementType; label: string }> = [];
  if (ad) {
    const sh = ad.shares ? compact(ad.shares) : null;
    if (sh) tractionBits.push({ icon: Share2, label: `${sh} shares` });
    const lk = ad.likes ? compact(ad.likes) : null;
    if (lk) tractionBits.push({ icon: Heart, label: lk });
  }
  if (organic) {
    const v = compact(organic.views);
    if (v) tractionBits.push({ icon: Eye, label: v });
    // Platform virality metric: TikTok → saves/bookmarks, Instagram → shares.
    const isTikTok = organic.source === "tiktok";
    const metric = compact(isTikTok ? organic.bookmarks : organic.shares);
    if (metric) tractionBits.push({ icon: isTikTok ? Bookmark : Share2, label: metric });
    if (organic.durationSec != null)
      tractionBits.push({ icon: Clock, label: `${Math.round(organic.durationSec)}s` });
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -40, transition: { duration: 0.18 } }}
      className="rounded-lg border border-white/[0.07] bg-[#0D0F12] overflow-hidden group"
    >
      {/* Media — organic posts are CLICK-TO-LOAD: cover thumbnail + play button
          in a vertical 9:16 frame; the platform player (TikTok/IG iframe or IG
          <video>) mounts only when the operator presses play. Ads keep their
          native-aspect <video>/<img>. No-media → fixed-aspect placeholder. */}
      <div
        className={`relative w-full bg-black overflow-hidden ${
          verticalFrame
            ? `aspect-[9/16] ${mediaMaxH} mx-auto`
            : hasMedia
              ? ""
              : hero
                ? "aspect-[4/3]"
                : "aspect-video"
        }`}
      >
        {canPlay && !activated ? (
          // Facade: cover thumbnail + play overlay. Loads no media until clicked.
          <button
            type="button"
            onClick={() => setActivated(true)}
            aria-label={`Play ${platformLabel} video`}
            className="absolute inset-0 w-full h-full group/play"
          >
            {previewSrc ? (
              // eslint-disable-next-line jsx-a11y/img-redundant-alt
              <img src={previewSrc} alt={advertiser} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <Flame size={22} className="text-white/15" />
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/15 group-hover/play:bg-black/30 transition-colors">
              <span className="flex items-center justify-center w-14 h-14 rounded-full bg-black/55 backdrop-blur border border-white/25 group-hover/play:scale-105 transition-transform">
                <Play size={22} className="text-white translate-x-0.5" fill="currentColor" />
              </span>
            </div>
          </button>
        ) : canPlay && activated ? (
          activePlayerUrl ? (
            <iframe
              src={activePlayerUrl}
              title={`${platformLabel} — ${advertiser}`}
              className="absolute inset-0 w-full h-full border-0"
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <video
              src={videoUrl ?? undefined}
              poster={previewSrc}
              autoPlay
              controls
              playsInline
              onError={() => setVideoFailed(true)}
              className="absolute inset-0 w-full h-full object-cover bg-black"
            />
          )
        ) : videoUrl ? (
          <video
            src={videoUrl}
            poster={thumb ?? undefined}
            controls
            playsInline
            preload="metadata"
            className={`w-full h-auto ${mediaMaxH} object-contain bg-black block`}
          />
        ) : thumb ? (
          // eslint-disable-next-line jsx-a11y/img-redundant-alt
          <img
            src={thumb}
            alt={advertiser}
            className={`w-full h-auto ${mediaMaxH} object-contain bg-black block`}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {card.item.itemType === "ad" ? (
              <Megaphone size={22} className="text-white/15" />
            ) : (
              <Flame size={22} className="text-white/15" />
            )}
          </div>
        )}
        {/* format + traction chips */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none">
          {format && (
            <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/60 text-white/70 backdrop-blur">
              {format}
            </span>
          )}
        </div>
        {tractionBits.length > 0 && (
          // Pin traction to the top-right on every card (clears the video control
          // bar; statics get the badge in the same place for consistency).
          <div className="absolute top-2 right-2 flex items-center gap-1.5 pointer-events-none">
            {tractionBits.map((t, i) => {
              const TIcon = t.icon;
              return (
                <span
                  key={i}
                  className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/60 text-white/75 backdrop-blur"
                >
                  <TIcon size={9} /> {t.label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.dot}`} />
          <span className="text-[11px] font-medium text-white/75 truncate">{advertiser}</span>
          {handle && <span className="text-[10px] font-mono text-white/30 truncate">{handle}</span>}
          <div className="ml-auto shrink-0 flex items-center gap-2">
            {adLink && (
              <a
                href={adLink}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[9px] font-mono text-white/30 hover:text-cyan-300 transition-colors"
                title="View the original ad"
              >
                <ExternalLink size={11} /> Original ad
              </a>
            )}
            {isOrganic && organic?.postUrl ? (
              <a
                href={organic.postUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[9px] font-mono text-white/30 hover:text-cyan-300 transition-colors"
                title={`View original post on ${platformLabel}`}
              >
                <ExternalLink size={11} /> {platformLabel}
              </a>
            ) : sourceUrl ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-white/25 hover:text-white/60 transition-colors"
                title="Open source"
              >
                <ArrowUpRight size={13} />
              </a>
            ) : null}
          </div>
        </div>

        {hook && <p className="text-[12px] leading-snug text-white/90 font-medium line-clamp-3">{hook}</p>}
        {body && <p className="text-[11px] leading-snug text-white/45 line-clamp-3">{body}</p>}

        {item.matchedKeywords && item.matchedKeywords.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {item.matchedKeywords.slice(0, 4).map((kw, i) => (
              <span
                key={i}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/[0.04] text-white/40 border border-white/[0.06]"
              >
                {kw}
              </span>
            ))}
          </div>
        )}

        {/* Actions — stacked full-width (matches the reference card) */}
        <div className="flex flex-col gap-1.5 pt-1">
          <button
            onClick={onMakeItMine}
            disabled={disabled}
            className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-2.5 rounded-lg text-[11px] font-mono tracking-wide border ${PRIMARY_ACTION_BTN} hover:brightness-125 transition-all disabled:opacity-40`}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            Make it mine
          </button>
          <button
            onClick={onSkip}
            disabled={disabled}
            className="w-full flex items-center justify-center px-2.5 py-2 rounded-lg text-[11px] font-mono tracking-wide border border-white/[0.08] bg-white/[0.02] text-white/40 hover:text-white/70 hover:bg-white/[0.05] transition-all disabled:opacity-40"
          >
            Skip
          </button>
        </div>
      </div>
    </motion.article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Idea card (LLM-generated)
// ─────────────────────────────────────────────────────────────────────────────

function IdeaCardView({
  idea,
  busy,
  disabled,
  onSave,
  onSkip,
}: {
  idea: AdConsoleIdea;
  busy: boolean;
  disabled: boolean;
  onSave: () => void;
  onSkip: () => void;
}) {
  const a = ACCENT.violet;
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
      className="rounded-lg border border-violet-500/15 bg-[#0D0F12] overflow-hidden"
    >
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {idea.format && (
            <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 border border-violet-500/20">
              {idea.format}
            </span>
          )}
          {idea.angle && (
            <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.04] text-white/40 border border-white/[0.06]">
              {idea.angle}
            </span>
          )}
        </div>

        {idea.title && <h3 className="text-[12px] font-semibold text-white/85">{idea.title}</h3>}
        {idea.hook && (
          <p className="text-[12px] leading-snug text-white/90 font-medium italic">“{idea.hook}”</p>
        )}
        {idea.concept && <p className="text-[11px] leading-snug text-white/50 line-clamp-4">{idea.concept}</p>}

        {idea.rationale && (
          <div className="flex items-start gap-1.5 pt-0.5">
            <Lightbulb size={11} className="text-violet-300/60 shrink-0 mt-0.5" />
            <p className="text-[10px] leading-snug text-white/35 font-mono line-clamp-3">{idea.rationale}</p>
          </div>
        )}

        {idea.sourceRefs && idea.sourceRefs.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {idea.sourceRefs.slice(0, 3).map((ref, i) => (
              <span
                key={i}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/[0.04] text-white/40 border border-white/[0.06]"
                title={ref.note ?? undefined}
              >
                {ref.ref ?? ref.type ?? "source"}
              </span>
            ))}
          </div>
        )}

        {/* Actions — stacked full-width (matches the reference card) */}
        <div className="flex flex-col gap-1.5 pt-1">
          <button
            onClick={onSave}
            disabled={disabled}
            className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-2.5 rounded-lg text-[11px] font-mono tracking-wide border ${PRIMARY_ACTION_BTN} hover:brightness-125 transition-all disabled:opacity-40`}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Save idea
          </button>
          <button
            onClick={onSkip}
            disabled={disabled}
            className="w-full flex items-center justify-center px-2.5 py-2 rounded-lg text-[11px] font-mono tracking-wide border border-white/[0.08] bg-white/[0.02] text-white/40 hover:text-white/70 hover:bg-white/[0.05] transition-all disabled:opacity-40"
          >
            Skip
          </button>
        </div>
      </div>
    </motion.article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Creative Brief modal (Make-it-mine handoff)
// ─────────────────────────────────────────────────────────────────────────────

function BriefModal({
  brief,
  products,
  brandId,
  onClose,
  flash,
}: {
  brief: AdConsoleCreativeBrief;
  products: Product[];
  brandId: string;
  onClose: () => void;
  flash: (m: { kind: "error" | "success"; text: string }) => void;
}) {
  const [, navigate] = useLocation();
  const thumb = brief.thumbnailUrl ?? brief.referenceMediaUrls[0] ?? null;
  const body = brief.copy ?? brief.caption ?? brief.transcript ?? brief.sourceCopy ?? null;

  const isStatic = brief.sourceType === "ad" && brief.format === "static";
  const [recreateOpen, setRecreateOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [angleName, setAngleName] = useState("");
  const [language, setLanguage] = useState("en");
  const [busy, setBusy] = useState(false);

  const researched = products.filter((p) => p.researchStatus === "complete" && p.research?.markdown);
  const angles = researched.find((p) => p.id === productId)?.research?.angles ?? [];

  async function addToPipeline() {
    setBusy(true);
    try {
      await createAdPipelineCard(brandId, { feedItemId: brief.feedItemId, mode: "idea" });
      flash({ kind: "success", text: "Added to Ad Pipeline." });
      onClose();
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function recreateNow() {
    if (!productId || !angleName) return;
    setBusy(true);
    try {
      const { card } = await createAdPipelineCard(brandId, {
        feedItemId: brief.feedItemId, mode: "recreate", productId, angleName, language,
      });
      if (isStatic) {
        // Static recreator needs the deconstructed reference id, produced by the
        // background job. We pass the card id; the Static Ads page resolves the
        // reference from the card if not yet ready.
        const params = new URLSearchParams({
          productId, angle: angleName, language, pipelineCardId: card.id,
        });
        if (card.staticReferenceId) params.set("referenceId", card.staticReferenceId);
        navigate(`/workspace/apps/static-ads?${params.toString()}`);
      } else {
        // Copy Engine pulls the transcript from the card via pipelineCardId — do NOT
        // pass source here. autorun=1 kicks off generation immediately.
        const params = new URLSearchParams({
          mode: "rewrite", product: productId, angle: angleName, language,
          pipelineCardId: card.id, autorun: "1",
        });
        navigate(`/workspace/apps/copy-engine?${params.toString()}`);
      }
      onClose();
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-white/10 bg-[#0D0F12] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wand2 size={16} className="text-cyan-400" />
            <h3 className="text-sm font-semibold text-white/90">Creative Brief</h3>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="flex gap-4">
            {thumb && (
              <div className="w-24 h-24 rounded-lg overflow-hidden bg-white/[0.03] border border-white/[0.06] shrink-0">
                <img src={thumb} alt={brief.advertiserName ?? "reference"} className="w-full h-full object-cover" />
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.05] text-white/60 border border-white/[0.08]">
                  {brief.format}
                </span>
                {brief.tractionBadge && (
                  <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    {brief.tractionBadge}
                  </span>
                )}
              </div>
              {brief.advertiserName && (
                <p className="text-[12px] text-white/70 truncate">{brief.advertiserName}</p>
              )}
              {brief.hook && <p className="text-[13px] text-white/90 font-medium leading-snug">{brief.hook}</p>}
            </div>
          </div>

          {body && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-white/30 mb-1">Reference copy</p>
              <p className="text-[12px] text-white/60 leading-relaxed whitespace-pre-wrap line-clamp-[8]">{body}</p>
            </div>
          )}

          {brief.matchedKeywords.length > 0 && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-white/30 mb-1.5">Matched keywords</p>
              <div className="flex flex-wrap gap-1">
                {brief.matchedKeywords.slice(0, 8).map((kw, i) => (
                  <span
                    key={i}
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300/80 border border-cyan-500/20"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 flex items-center gap-2">
            <ExternalLink size={13} className="text-cyan-400 shrink-0" />
            <p className="text-[11px] font-mono text-white/50">
              Recreates in <span className="text-white/80">{isStatic ? "Static Ads Recreator" : "Copy Engine"}</span>
            </p>
          </div>
        </div>

        {/* Footer — Add to pipeline vs Recreate now (collects product + angle) */}
        <div className="px-5 py-4 border-t border-white/[0.06] space-y-3">
          {!recreateOpen ? (
            <div className="flex gap-3">
              <button
                disabled={busy}
                onClick={addToPipeline}
                className="flex-1 rounded-lg border border-white/10 py-2.5 text-sm text-white/80 hover:bg-white/5 disabled:opacity-50"
              >
                Add to pipeline
              </button>
              <button
                disabled={busy}
                onClick={() => setRecreateOpen(true)}
                className="flex-1 rounded-lg bg-cyan-500 py-2.5 text-sm font-semibold text-black hover:bg-cyan-400 disabled:opacity-50"
              >
                Recreate now
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <select
                value={productId}
                onChange={(e) => { setProductId(e.target.value); setAngleName(""); }}
                className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white/90"
              >
                <option value="">Select product…</option>
                {researched.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select
                value={angleName}
                onChange={(e) => setAngleName(e.target.value)}
                disabled={!productId}
                className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white/90 disabled:opacity-50"
              >
                <option value="">Select angle…</option>
                {angles.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
              </select>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white/90"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>{lang.flag} {lang.label}</option>
                ))}
              </select>
              <button
                disabled={busy || !productId || !angleName}
                onClick={recreateNow}
                className="w-full rounded-lg bg-cyan-500 py-2.5 text-sm font-semibold text-black hover:bg-cyan-400 disabled:opacity-50"
              >
                {isStatic ? "Open Static Ads Recreator" : "Open Copy Engine"}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup panel — niche + competitor watchlist
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Operator-facing keyword manager (Niche & Signal). Shows the brand's effective
 * search terms — the actual ad + organic queries that drive the pull — as
 * removable chips, with an inline add per lane. Fully transparent + editable;
 * edits persist server-side and survive re-extraction. Empty state offers a
 * one-click generate (LLM only, no ad credits).
 */
function KeywordLane({
  label,
  lane,
  items,
  input,
  setInput,
  onAdd,
  onRemove,
  busyLane,
  removing,
}: {
  label: string;
  lane: AdConsoleSearchLane;
  items: string[];
  input: string;
  setInput: (v: string) => void;
  onAdd: () => void;
  onRemove: (kw: string) => void;
  busyLane: AdConsoleSearchLane | null;
  removing: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-[9px] font-mono uppercase tracking-wider text-white/30">
        {label} <span className="text-white/20">({items.length})</span>
      </span>
      <div className="flex flex-wrap gap-1">
        {items.length === 0 && <span className="text-[10px] font-mono text-white/20 italic">none</span>}
        {items.map((kw) => {
          const isRemoving = removing === `${lane}:${kw}`;
          return (
            <span
              key={kw}
              className="group flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-[10px] font-mono bg-white/[0.04] border border-white/[0.06] text-white/70"
            >
              {kw}
              <button
                onClick={() => onRemove(kw)}
                disabled={isRemoving}
                className="text-white/30 hover:text-rose-300 disabled:opacity-50"
                aria-label={`Remove ${kw}`}
              >
                {isRemoving ? <Loader2 size={10} className="animate-spin" /> : <X size={11} />}
              </button>
            </span>
          );
        })}
      </div>
      <div className="flex items-center gap-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder={`Add ${lane} keyword…`}
          disabled={busyLane === lane}
          className="flex-1 bg-[#0D0F12] border border-white/[0.08] rounded-md px-2 py-1 text-[10px] font-mono text-white/80 placeholder:text-white/20 outline-none focus:border-cyan-500/40 disabled:opacity-50"
        />
        <button
          onClick={onAdd}
          disabled={busyLane === lane || !input.trim()}
          className="flex items-center justify-center w-6 h-6 rounded-md border border-white/[0.08] bg-white/[0.02] text-white/50 hover:text-white/80 disabled:opacity-40"
          aria-label={`Add ${lane} keyword`}
        >
          {busyLane === lane ? <Loader2 size={11} className="animate-spin" /> : <Plus size={12} />}
        </button>
      </div>
    </div>
  );
}

function KeywordManager({ brandId, onNotice }: { brandId: string; onNotice: (n: Notice) => void }) {
  const [terms, setTerms] = useState<AdConsoleSearchTerms | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busyLane, setBusyLane] = useState<AdConsoleSearchLane | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [adInput, setAdInput] = useState("");
  const [organicInput, setOrganicInput] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const load = useCallback(async () => {
    try {
      setTerms(await getAdConsoleKeywords(brandId));
    } catch (err) {
      onNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [brandId, onNotice]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function handleAdd(lane: AdConsoleSearchLane) {
    const value = (lane === "ad" ? adInput : organicInput).trim();
    if (!value || busyLane) return;
    setBusyLane(lane);
    try {
      setTerms(await addAdConsoleKeyword(brandId, lane, value));
      if (lane === "ad") setAdInput("");
      else setOrganicInput("");
    } catch (err) {
      onNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusyLane(null);
    }
  }

  async function handleRemove(lane: AdConsoleSearchLane, kw: string) {
    if (removing) return;
    setRemoving(`${lane}:${kw}`);
    try {
      setTerms(await removeAdConsoleKeyword(brandId, lane, kw));
    } catch (err) {
      onNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setRemoving(null);
    }
  }

  // Poll until the term list STABILIZES (two identical non-empty reads) or the
  // cap is hit. Extraction writes the authoritative list at the end, so the
  // derived-for-display value keeps changing until it lands, then holds — this
  // avoids capturing a mid-extraction partial.
  async function pollTerms() {
    let prev = "";
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const t = await getAdConsoleKeywords(brandId);
      setTerms(t);
      const sig = JSON.stringify([t.ad, t.organic]);
      if ((t.ad.length > 0 || t.organic.length > 0) && sig === prev) break;
      prev = sig;
    }
  }

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    try {
      await generateAdConsoleKeywords(brandId);
      await pollTerms();
      onNotice({ kind: "success", text: "Keywords generated from your angles." });
    } catch (err) {
      onNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setGenerating(false);
    }
  }

  async function handleRegenerate() {
    if (regenerating) return;
    setConfirmRegen(false);
    setRegenerating(true);
    try {
      await regenerateAdConsoleKeywords(brandId);
      await pollTerms();
      onNotice({ kind: "success", text: "Keywords regenerated from your angles." });
    } catch (err) {
      onNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setRegenerating(false);
    }
  }

  const total = (terms?.ad.length ?? 0) + (terms?.organic.length ?? 0);

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">Search keywords</span>
        <div className="flex items-center gap-2">
          {!loading && <span className="text-[10px] font-mono text-white/25">{total} term{total === 1 ? "" : "s"}</span>}
          {!loading && total > 0 && !confirmRegen && (
            <button
              onClick={() => setConfirmRegen(true)}
              disabled={regenerating}
              title="Re-extract all keywords with the latest prompt (discards manual edits)"
              className="flex items-center gap-1 text-[10px] font-mono text-white/40 hover:text-white/70 disabled:opacity-50"
            >
              {regenerating ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              Regenerate
            </button>
          )}
        </div>
      </div>
      {confirmRegen && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-2 py-1.5">
          <span className="text-[10px] font-mono text-amber-200/80">Replace all keywords with a fresh extraction?</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void handleRegenerate()}
              className="px-2 py-0.5 rounded text-[10px] font-mono text-amber-100 bg-amber-500/15 hover:bg-amber-500/25"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmRegen(false)}
              className="px-2 py-0.5 rounded text-[10px] font-mono text-white/50 hover:text-white/80"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-white/30">
          <Loader2 size={11} className="animate-spin" /> Loading…
        </div>
      ) : total === 0 && !terms?.hasKeywordSets && !generating ? (
        <div className="space-y-2">
          <p className="text-[10px] text-white/30 font-mono leading-relaxed">
            No keywords yet. Generate them from this brand's angles — LLM only, no ad credits used.
          </p>
          <button
            onClick={() => void handleGenerate()}
            disabled={generating}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono tracking-wide border border-cyan-500/20 bg-cyan-500/[0.06] text-cyan-200/80 hover:text-cyan-100 transition-all disabled:opacity-50"
          >
            <Sparkles size={12} /> Generate keywords
          </button>
        </div>
      ) : generating && total === 0 ? (
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-cyan-300/80">
          <Loader2 size={11} className="animate-spin" /> Generating keywords from angles…
        </div>
      ) : (
        <>
          <KeywordLane
            label="Ad search"
            lane="ad"
            items={terms?.ad ?? []}
            input={adInput}
            setInput={setAdInput}
            onAdd={() => void handleAdd("ad")}
            onRemove={(kw) => void handleRemove("ad", kw)}
            busyLane={busyLane}
            removing={removing}
          />
          <KeywordLane
            label="Organic search"
            lane="organic"
            items={terms?.organic ?? []}
            input={organicInput}
            setInput={setOrganicInput}
            onAdd={() => void handleAdd("organic")}
            onRemove={(kw) => void handleRemove("organic", kw)}
            busyLane={busyLane}
            removing={removing}
          />
          <p className="text-[9px] text-white/20 font-mono leading-relaxed">
            These are the exact terms the next pull searches. Edits persist and survive re-extraction.
          </p>
        </>
      )}
    </div>
  );
}

function SetupPanel({
  brandId,
  niche,
  nicheLabel,
  competitors,
  keywordSetCount,
  bootstrapping,
  onCompetitorsChange,
  onFeedRanked,
  onNicheChange,
  onNotice,
}: {
  brandId: string;
  niche: AdConsoleNicheState | null;
  nicheLabel: string | null;
  competitors: AdConsoleCompetitor[];
  keywordSetCount: number | null;
  /** True while the background bootstrap (niche + competitors + keywords) runs. */
  bootstrapping: boolean;
  onCompetitorsChange: () => Promise<void>;
  onFeedRanked: () => Promise<void>;
  onNicheChange: (state: AdConsoleNicheState) => void;
  onNotice: (n: Notice) => void;
}) {
  const [ranking, setRanking] = useState(false);
  const [redetecting, setRedetecting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFb, setNewFb] = useState("");
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const active = competitors.filter((c) => c.status === "active");
  const archived = competitors.filter((c) => c.status !== "active");

  async function handleRank() {
    if (ranking) return;
    setRanking(true);
    try {
      const summary = await rankAdConsoleFeed(brandId);
      await onFeedRanked();
      onNotice({
        kind: "success",
        text: `Re-ranked: ${summary.competitorAds.ranked} ads + ${summary.trendingOrganic.ranked} posts.`,
      });
    } catch (err) {
      onNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setRanking(false);
    }
  }

  async function handleRedetect() {
    if (redetecting) return;
    setRedetecting(true);
    try {
      const { classification, state } = await detectAdConsoleNiche(brandId);
      onNicheChange(state);
      const label = state.stream?.displayName ?? classification.niche;
      onNotice(
        classification.seeded
          ? { kind: "success", text: `Re-detected niche: ${label}.` }
          : { kind: "error", text: `Detected "${classification.niche}" — not a seeded niche, so no niche stream attaches.` },
      );
    } catch (err) {
      onNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setRedetecting(false);
    }
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      await addAdConsoleCompetitor(brandId, { name, fbPageUrl: newFb.trim() || null });
      setNewName("");
      setNewFb("");
      await onCompetitorsChange();
      onNotice({ kind: "success", text: `Added ${name} to the watchlist.` });
    } catch (err) {
      onNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setAdding(false);
    }
  }

  async function handleArchiveToggle(c: AdConsoleCompetitor) {
    if (rowBusy) return;
    setRowBusy(c.id);
    try {
      await updateAdConsoleCompetitor(c.id, { status: c.status === "active" ? "archived" : "active" });
      await onCompetitorsChange();
    } catch (err) {
      onNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setRowBusy(null);
    }
  }

  async function handleDelete(c: AdConsoleCompetitor) {
    if (rowBusy) return;
    setRowBusy(c.id);
    try {
      await deleteAdConsoleCompetitor(c.id);
      await onCompetitorsChange();
    } catch (err) {
      onNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 grid gap-5 md:grid-cols-2">
      {/* Niche + signal */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Radar size={13} className="text-cyan-400" />
          <h3 className="text-[11px] font-mono uppercase tracking-wider text-white/50">Niche &amp; signal</h3>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-white/40 font-mono">Niche</span>
            <span className="text-[12px] text-white/80 flex items-center gap-1.5">
              {nicheLabel ? (
                <>
                  {nicheLabel}
                  {niche?.seeded && <span className="text-[9px] text-emerald-400/70 font-mono">seeded</span>}
                </>
              ) : bootstrapping ? (
                <span className="flex items-center gap-1.5 text-cyan-300/80">
                  <Loader2 size={11} className="animate-spin" /> Auto-detecting…
                </span>
              ) : (
                "Not detected"
              )}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-white/40 font-mono">Keyword sets</span>
            <span className="text-[12px] text-white/80">{keywordSetCount ?? 0} angle{keywordSetCount === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleRank()}
            disabled={ranking}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono tracking-wide border border-white/[0.08] bg-white/[0.02] text-white/50 hover:text-white/80 transition-all disabled:opacity-50"
          >
            {ranking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Re-rank feed
          </button>
          <button
            onClick={() => void handleRedetect()}
            disabled={redetecting}
            title="Re-classify this brand's niche from its products & research"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono tracking-wide border border-white/[0.08] bg-white/[0.02] text-white/50 hover:text-white/80 transition-all disabled:opacity-50"
          >
            {redetecting ? <Loader2 size={12} className="animate-spin" /> : <Radar size={12} />}
            Re-detect niche
          </button>
        </div>
        <p className="text-[10px] text-white/25 font-mono leading-relaxed">
          Niche, competitors &amp; angle keywords are detected automatically in the background — they sharpen which ads &amp; posts rank into your feed.
        </p>

        <KeywordManager brandId={brandId} onNotice={onNotice} />
      </div>

      {/* Competitors */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Megaphone size={13} className="text-indigo-300" />
            <h3 className="text-[11px] font-mono uppercase tracking-wider text-white/50">
              Competitor watchlist
              <span className="ml-1.5 text-white/30">({active.length})</span>
            </h3>
          </div>
          {bootstrapping && (
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono tracking-wide border border-indigo-500/20 bg-indigo-500/[0.06] text-indigo-200/80">
              <Loader2 size={11} className="animate-spin" /> Auto-researching…
            </span>
          )}
        </div>

        {/* Add form */}
        <div className="flex items-center gap-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAdd();
            }}
            placeholder="Competitor name"
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-[11px] text-white/80 placeholder:text-white/25 focus:outline-none focus:border-cyan-500/40"
          />
          <input
            value={newFb}
            onChange={(e) => setNewFb(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAdd();
            }}
            placeholder="FB page URL (optional)"
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-[11px] text-white/80 placeholder:text-white/25 focus:outline-none focus:border-cyan-500/40"
          />
          <button
            onClick={() => void handleAdd()}
            disabled={adding || !newName.trim()}
            className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-all disabled:opacity-40"
            title="Add competitor"
          >
            {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
          </button>
        </div>

        {/* List */}
        <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
          {active.length === 0 && archived.length === 0 ? (
            <p className="text-[11px] text-white/30 font-mono py-3 text-center">
              {bootstrapping ? "Auto-researching competitors…" : "No competitors yet — add one above."}
            </p>
          ) : (
            <>
              {active.map((c) => (
                <CompetitorRow
                  key={c.id}
                  c={c}
                  busy={rowBusy === c.id}
                  onArchive={() => void handleArchiveToggle(c)}
                  onDelete={() => void handleDelete(c)}
                />
              ))}
              {archived.length > 0 && (
                <>
                  <div className="text-[9px] font-mono uppercase tracking-wider text-white/20 px-1 pt-2 flex items-center gap-1">
                    <ChevronDown size={10} /> Archived ({archived.length})
                  </div>
                  {archived.map((c) => (
                    <CompetitorRow
                      key={c.id}
                      c={c}
                      busy={rowBusy === c.id}
                      onArchive={() => void handleArchiveToggle(c)}
                      onDelete={() => void handleDelete(c)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CompetitorRow({
  c,
  busy,
  onArchive,
  onDelete,
}: {
  c: AdConsoleCompetitor;
  busy: boolean;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const dimmed = c.status !== "active";
  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/[0.05] bg-white/[0.02] ${
        dimmed ? "opacity-50" : ""
      }`}
    >
      <span className="text-[11px] text-white/75 truncate flex-1 min-w-0">{c.name}</span>
      {c.source === "auto" && (
        <span className="text-[8px] font-mono uppercase tracking-wider px-1 py-0.5 rounded bg-indigo-500/10 text-indigo-300/70 border border-indigo-500/20 shrink-0">
          auto
        </span>
      )}
      <button
        onClick={onArchive}
        disabled={busy}
        className="shrink-0 text-white/25 hover:text-amber-300 transition-colors disabled:opacity-40"
        title={dimmed ? "Reactivate" : "Archive"}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />}
      </button>
      <button
        onClick={onDelete}
        disabled={busy}
        className="shrink-0 text-white/25 hover:text-rose-400 transition-colors disabled:opacity-40"
        title="Delete"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Guard panel
// ─────────────────────────────────────────────────────────────────────────────

function GuardPanel({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
}) {
  return (
    <div className="max-w-xl mx-auto mt-10 rounded-xl border border-white/[0.06] bg-white/[0.02] px-6 py-8 text-center">
      <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
        <Icon size={20} className="text-white/30" />
      </div>
      <h2 className="text-sm font-semibold text-white/80">{title}</h2>
      <p className="text-xs text-white/40 mt-2 leading-relaxed font-mono">{body}</p>
    </div>
  );
}
