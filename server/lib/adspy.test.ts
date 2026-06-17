import { describe, it, expect, vi } from "vitest";
import {
  AdspyClient,
  AdspyAuthError,
  normalizeAdspyAd,
  scoreAdspyTraction,
  adspySeenBetween,
  adMatchesCompetitor,
  type AdspyAd,
} from "./adspy.js";

describe("AdspyClient.searchAds", () => {
  it("POSTs /api/ad with bearer + JSON body and returns the array", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [{ id: 1 }, { id: 2 }] });
    const c = new AdspyClient({ apiKey: "tok", baseUrl: "https://api.test", fetchImpl });
    const ads = await c.searchAds({
      searches: [{ type: "texts", value: "gut health" }],
      countries: ["US", "CA", "UK", "AU"],
      orderBy: "total_shares",
      page: 1,
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://api.test/api/ad");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.searches).toEqual([{ type: "texts", value: "gut health", locked: false }]);
    expect(body.countries).toEqual(["US", "CA", "UK", "AU"]);
    expect(body.orderBy).toBe("total_shares");
    expect(body.page).toBe(1);
    expect(ads).toHaveLength(2);
  });

  it("sends page:0 (0-indexed — the top-shares page, must not be dropped)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const c = new AdspyClient({ apiKey: "tok", baseUrl: "https://api.test", fetchImpl });
    await c.searchAds({ searches: [{ type: "texts", value: "x" }], orderBy: "total_shares", page: 0 });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    const body = JSON.parse(init.body as string);
    expect(body.page).toBe(0);
  });

  it("throws AdspyAuthError on 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const c = new AdspyClient({ apiKey: "tok", baseUrl: "https://api.test", fetchImpl });
    await expect(c.searchAds({ userId: "1" })).rejects.toBeInstanceOf(AdspyAuthError);
  });

  it("throws on other non-ok statuses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const c = new AdspyClient({ apiKey: "tok", baseUrl: "https://api.test", fetchImpl });
    await expect(c.searchAds({ userId: "1" })).rejects.toThrow(/500/);
  });
});

const fbAd: AdspyAd = {
  id: 971,
  isIg: false,
  adType: "Video",
  text: "Try our greens",
  createdOn: "2026-04-28T12:06:59",
  actor: { userId: "100082299859730", name: "Kapiva", username: "kapivahealth" },
  snapshot: { shareNum: 3026, likeNum: 174337 },
  mainAttachment: {
    type: "Video",
    videoUrl: "https://c/x.mp4",
    imageUrl: "https://c/x.jpg",
    actionLinkTitle: "Shop now",
    url: "https://kapiva.in/x",
    state: "active",
  },
  linkToAd: "https://www.facebook.com/100082299859730/posts/971",
};

const igAd: AdspyAd = {
  id: 55,
  isIg: true,
  adType: "Image",
  text: "glow",
  actor: { userId: "777", name: "Glow", username: "GlowRecipe" },
  snapshot: { shareNum: 10 },
  mainAttachment: { type: "Image", imageUrl: "https://c/g.jpg", url: "https://glow/x", state: "inactive" },
  linkToAd: "https://www.instagram.com/p/abc",
};

describe("normalizeAdspyAd", () => {
  it("maps an FB video ad incl. deep link, advertiser id, shares", () => {
    const n = normalizeAdspyAd(fbAd);
    expect(n.externalId).toBe("971");
    expect(n.advertiserId).toBe("100082299859730");
    expect(n.pageId).toBe("100082299859730");
    expect(n.advertiserUsername).toBe("kapivahealth");
    expect(n.deepLinkUrl).toBe("https://www.facebook.com/100082299859730/posts/971");
    expect(n.format).toBe("video");
    expect(n.copy).toBe("Try our greens");
    expect(n.cta).toBe("Shop now");
    expect(n.landingUrl).toBe("https://kapiva.in/x");
    expect(n.shares).toBe(3026);
    expect(n.likes).toBe(174337);
    expect(n.isActive).toBe(true);
    expect(n.isIg).toBe(false);
    expect(n.mediaUrls).toContain("https://c/x.mp4");
  });

  it("maps an IG image ad (isIg, static, inactive)", () => {
    const n = normalizeAdspyAd(igAd);
    expect(n.isIg).toBe(true);
    expect(n.format).toBe("static");
    expect(n.isActive).toBe(false);
    expect(n.advertiserUsername).toBe("GlowRecipe");
    expect(n.shares).toBe(10);
  });
});

describe("scoreAdspyTraction", () => {
  it("log-scales shares to 0..1", () => {
    expect(scoreAdspyTraction(0)).toBe(0);
    expect(scoreAdspyTraction(100000)).toBe(1);
    const mid = scoreAdspyTraction(1000);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe("adspySeenBetween", () => {
  it("returns a two-element DD-MMM-YYYY range", () => {
    const [start, end] = adspySeenBetween(365);
    expect(start).toMatch(/^\d{2}-[A-Z][a-z]{2}-\d{4}$/);
    expect(end).toMatch(/^\d{2}-[A-Z][a-z]{2}-\d{4}$/);
  });
});

describe("adMatchesCompetitor", () => {
  it("matches on FB page id (advertiserId === fbPageId)", () => {
    expect(adMatchesCompetitor(normalizeAdspyAd(fbAd), { fbPageId: "100082299859730", igHandle: null })).toBe(true);
  });
  it("matches on IG handle, case-insensitive, @ stripped", () => {
    expect(adMatchesCompetitor(normalizeAdspyAd(igAd), { fbPageId: null, igHandle: "@glowrecipe" })).toBe(true);
  });
  it("rejects when neither id nor handle matches", () => {
    expect(adMatchesCompetitor(normalizeAdspyAd(fbAd), { fbPageId: "999", igHandle: "other" })).toBe(false);
  });
});
