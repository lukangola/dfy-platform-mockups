/**
 * Ad Creative Console — niche seed configs.
 *
 * Each entry is the brand-INDEPENDENT seed for one shared `niche_streams` row
 * (spec §5): the broad category keyword/hashtag lists used for the weekly
 * "niche stream" pull, the niche's well-known leading advertisers (for direct
 * ad-library pulls), the adjacency pain-point keywords used to discover organic
 * content, and the default scoring weights + per-run credit caps.
 *
 * This is reference/config data, not per-tenant data — it's the same for every
 * brand in a niche. `ensureNicheStream(niche)` (server/lib/adConsoleNiche.ts)
 * lazily upserts the matching `niche_streams` row from these seeds the first
 * time a brand of that niche needs it, using ON CONFLICT DO NOTHING so an
 * operator's later tuning of the live row is never clobbered.
 *
 * Adding a second niche is intentionally a config-only change: drop another
 * entry into NICHE_SEEDS and the classifier closed set picks it up.
 *
 * v1 launch niche = `supplement` (the test brand). `skincare` is included as a
 * second, lighter-weight entry purely to prove the "another niche is just
 * another configured stream" seam — supplement is the one tuned for launch.
 */

/** Tunable scoring weights + per-run credit caps for one niche stream. */
export type NicheStreamConfig = {
  /** composite = traction·traction + relevance·relevance + recency·recency (weights sum ~1). */
  weights: { traction: number; relevance: number; recency: number };
  caps: {
    /** Max ad-library items pulled per search query. */
    adsPerQuery: number;
    /** Max organic items pulled per search query. */
    organicPerQuery: number;
    /** Max distinct search queries issued per platform per weekly pull. */
    queriesPerPlatform: number;
    /** Organic eligibility: only posts newer than this many days (spec §7). */
    organicRecencyDays: number;
    /** Ad eligibility: only ads active at some point within this lookback (spec §7). */
    adLookbackDays: number;
  };
};

/** A known leading advertiser in a niche — used for direct ad-library pulls. */
export type SeedAdvertiser = {
  name: string;
  /** Resolved later by the ingest phase (search by name); left null in the seed to avoid fabricating IDs. */
  fbPageUrl?: string | null;
  fbPageId?: string | null;
  igHandle?: string | null;
  tiktokHandle?: string | null;
};

export type NicheSeed = {
  niche: string; // canonical key — matches brands.nicheType + niche_streams.niche
  displayName: string;
  keywords: {
    /** Broad category anchors for the weekly ad-library niche pull (one-word + two-word). */
    adLibrary: string[];
    /** Broad organic search terms for the weekly niche pull. */
    organic: string[];
    /** Hashtags for IG/TikTok organic discovery. */
    hashtags: string[];
  };
  leadingAdvertisers: SeedAdvertiser[];
  /** Adjacency problem/outcome keywords used as organic search queries (spec §5 adjacency). */
  painPointKeywords: string[];
  config: NicheStreamConfig;
};

const DEFAULT_CONFIG: NicheStreamConfig = {
  weights: { relevance: 0.5, traction: 0.35, recency: 0.15 },
  caps: {
    adsPerQuery: 40,
    organicPerQuery: 30,
    queriesPerPlatform: 8,
    organicRecencyDays: 60,
    adLookbackDays: 365,
  },
};

/**
 * The default weights + caps, exported so ingestion can fall back to them for an
 * unseeded niche (e.g. "other"), where there's no `niche_streams.config` to read
 * — competitor-ad pulls still need a sane per-run credit ceiling.
 */
export const DEFAULT_NICHE_CONFIG: NicheStreamConfig = DEFAULT_CONFIG;

const SUPPLEMENT_SEED: NicheSeed = {
  niche: "supplement",
  displayName: "Supplements",
  keywords: {
    adLibrary: [
      "supplement",
      "vitamins",
      "probiotic",
      "collagen",
      "greens powder",
      "magnesium",
      "ashwagandha",
      "gut health",
      "omega 3",
      "multivitamin",
      "electrolytes",
      "creatine",
    ],
    organic: [
      "gut health tips",
      "natural energy boost",
      "supplements that actually work",
      "morning supplement routine",
      "hormone balance naturally",
      "magnesium benefits",
      "reduce bloating fast",
      "what i take daily for energy",
    ],
    hashtags: [
      "#guthealth",
      "#supplements",
      "#wellnesstips",
      "#bloating",
      "#hormonebalance",
      "#magnesium",
      "#greenspowder",
      "#supplementroutine",
      "#womenshealth",
      "#guttok",
    ],
  },
  leadingAdvertisers: [
    { name: "AG1 (Athletic Greens)", igHandle: "drinkag1" },
    { name: "Ritual", igHandle: "ritual" },
    { name: "Seed", igHandle: "seed" },
    { name: "Bloom Nutrition", igHandle: "bloomnu" },
    { name: "Goli Nutrition", igHandle: "goli" },
    { name: "Arrae", igHandle: "arrae" },
    { name: "Moon Juice", igHandle: "moonjuice" },
    { name: "Olipop", igHandle: "drinkolipop" },
  ],
  painPointKeywords: [
    "bloating",
    "low energy",
    "brain fog",
    "poor sleep",
    "chronic stress",
    "hormonal imbalance",
    "slow metabolism",
    "weak immune system",
    "joint pain",
    "hair thinning",
    "afternoon crash",
    "irregular digestion",
  ],
  config: DEFAULT_CONFIG,
};

const SKINCARE_SEED: NicheSeed = {
  niche: "skincare",
  displayName: "Skincare",
  keywords: {
    adLibrary: [
      "skincare",
      "face serum",
      "moisturizer",
      "retinol",
      "vitamin c serum",
      "acne treatment",
      "anti aging cream",
      "hyaluronic acid",
      "sunscreen",
      "eye cream",
    ],
    organic: [
      "skincare routine",
      "how to clear acne",
      "glass skin routine",
      "anti aging skincare",
      "best products for hyperpigmentation",
      "skin barrier repair",
      "dermatologist skincare tips",
    ],
    hashtags: [
      "#skincare",
      "#skincareroutine",
      "#acne",
      "#antiaging",
      "#glassskin",
      "#skintok",
      "#skinbarrier",
      "#hyperpigmentation",
    ],
  },
  leadingAdvertisers: [
    { name: "CeraVe", igHandle: "cerave" },
    { name: "The Ordinary", igHandle: "theordinary" },
    { name: "Bubble Skincare", igHandle: "bubble" },
    { name: "Glow Recipe", igHandle: "glowrecipe" },
    { name: "Medik8", igHandle: "medik8" },
  ],
  painPointKeywords: [
    "acne breakouts",
    "hormonal acne",
    "fine lines",
    "wrinkles",
    "dark spots",
    "hyperpigmentation",
    "dull skin",
    "dry skin",
    "large pores",
    "damaged skin barrier",
    "under eye bags",
    "uneven skin tone",
  ],
  config: DEFAULT_CONFIG,
};

/** Registry of all configured niches, keyed by canonical niche key. */
export const NICHE_SEEDS: Record<string, NicheSeed> = {
  supplement: SUPPLEMENT_SEED,
  skincare: SKINCARE_SEED,
};

/** Closed set the brand niche classifier output is coerced against. */
export const AD_CONSOLE_NICHES = Object.keys(NICHE_SEEDS);

export function getNicheSeed(niche: string): NicheSeed | null {
  return NICHE_SEEDS[niche] ?? null;
}
