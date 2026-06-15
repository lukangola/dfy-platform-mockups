import { describe, it, expect, vi } from "vitest";
import { GethookdClient, CreditExhaustedError, type GethookdAd } from "./gethookd.js";

describe("GethookdClient.explore", () => {
  it("builds the /explore URL with filters + bearer auth and parses credits", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "ad1" }], used_credits: 0.5, remaining_credits: 399.5 }),
    });
    const c = new GethookdClient({ apiKey: "k", baseUrl: "https://api.test", fetchImpl });
    const res = await c.explore({ niche: "skincare", location: "US", performanceScores: ["winning", "scaling"], perPage: 50 });
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain("/api/v1/explore");
    expect(url).toContain("niche=skincare");
    expect(url).toContain("per_page=50");
    expect(url).toContain("performance_scores=winning%2Cscaling");
    expect(url).not.toContain("sort_column");
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer k");
    expect(res.credits).toEqual({ used: 0.5, remaining: 399.5 });
  });
  it("throws CreditExhaustedError on 402", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({}) });
    const c = new GethookdClient({ apiKey: "k", baseUrl: "https://api.test", fetchImpl });
    await expect(c.explore({ niche: "x" })).rejects.toBeInstanceOf(CreditExhaustedError);
  });
  it("parses string remaining_credits into a number", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [], used_credits: 0.01, remaining_credits: "397.96" }),
    });
    const c = new GethookdClient({ apiKey: "k", baseUrl: "https://api.test", fetchImpl });
    const res = await c.explore({ perPage: 1 });
    expect(res.credits).toEqual({ used: 0.01, remaining: 397.96 });
  });
});

describe("GethookdClient.getRemainingCredits", () => {
  it("returns the numeric balance when explore reports a string remaining_credits", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [], used_credits: 0.01, remaining_credits: "250.00" }),
    });
    const c = new GethookdClient({ apiKey: "k", baseUrl: "https://api.test", fetchImpl });
    await expect(c.getRemainingCredits()).resolves.toBe(250);
  });

  it("returns 0 when the underlying call 402s (credits exhausted)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({}) });
    const c = new GethookdClient({ apiKey: "k", baseUrl: "https://api.test", fetchImpl });
    await expect(c.getRemainingCredits()).resolves.toBe(0);
  });

  it("returns null on a non-402 failure (e.g. 500)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const c = new GethookdClient({ apiKey: "k", baseUrl: "https://api.test", fetchImpl });
    await expect(c.getRemainingCredits()).resolves.toBeNull();
  });
});

describe("GethookdClient.addBrandSpy", () => {
  it("resolves true on status 200 and posts the brand_id as a NUMBER (internal id)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const c = new GethookdClient({ apiKey: "k", baseUrl: "https://api.test", fetchImpl });
    await expect(c.addBrandSpy("849")).resolves.toBe(true);
    // BrandSpy requires gethookd's internal numeric id — not the page external_id.
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toEqual({ brand_id: 849 });
  });

  it("resolves true on status 409 (already monitored)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });
    const c = new GethookdClient({ apiKey: "k", baseUrl: "https://api.test", fetchImpl });
    await expect(c.addBrandSpy("849")).resolves.toBe(true);
  });

  it("rejects with CreditExhaustedError on status 402", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({}) });
    const c = new GethookdClient({ apiKey: "k", baseUrl: "https://api.test", fetchImpl });
    await expect(c.addBrandSpy("849")).rejects.toBeInstanceOf(CreditExhaustedError);
  });
});

import { normalizeGethookdAd, scoreGethookdTraction } from "./gethookd.js";

// Mirrors the REAL /explore shape: numeric id, top-level copy/cta/landing,
// EMPTY ad_cards, 0..100 banded performance_score.
const ad: GethookdAd = {
  id: 9, title: "T", body: "B", cta_text: "Shop", landing_page: "https://lp/9",
  performance_score: 91, performance_score_title: "winning", ad_spend_range_score_title: "$$$",
  days_active: 84, used_count: 9, active_in_library: 0, start_date: "2026-01-01", end_date: "2026-03-26",
  display_format: "video", share_url: "https://s/9",
  media: [{ type: "video", url: "https://v/9.mp4", thumbnail_url: "https://t/9.jpg" }],
  ad_cards: [],
  brand: { external_id: "b1", name: "Acme" },
};

// No top-level copy/cta/landing — these must fall back to ad_cards[0].
const adCardsFallback: GethookdAd = {
  id: 10, active_in_library: 1,
  media: [{ type: "image", url: "https://i/10.jpg" }],
  ad_cards: [{ body: "FB", cta_text: "Learn", landing_page: "https://lp/fb" }],
};

describe("normalizeGethookdAd", () => {
  it("maps to the ad_creatives field shape (top-level copy/cta/landing)", () => {
    const n = normalizeGethookdAd(ad);
    expect(n.externalId).toBe("9");
    expect(n.advertiserName).toBe("Acme");
    expect(n.format).toBe("video");
    expect(n.mediaUrls).toEqual(["https://v/9.mp4"]);
    expect(n.copy).toBe("B");
    expect(n.cta).toBe("Shop");
    expect(n.landingUrl).toBe("https://lp/9");
    expect(n.isActive).toBe(false);
    expect(n.runtimeDays).toBe(84);
    expect(n.variationCount).toBe(9);
  });

  it("falls back to ad_cards[0] when top-level copy/cta/landing are absent", () => {
    const n = normalizeGethookdAd(adCardsFallback);
    expect(n.copy).toBe("FB");
    expect(n.cta).toBe("Learn");
    expect(n.landingUrl).toBe("https://lp/fb");
  });
});
describe("scoreGethookdTraction", () => {
  it("normalizes performance_score (0..100) to 0..1, dominant", () => {
    expect(scoreGethookdTraction(ad)).toBeCloseTo(0.91, 2);
    expect(scoreGethookdTraction({ id: "x" })).toBe(0);
    expect(scoreGethookdTraction({ id: "y", performance_score: 150 })).toBe(1);
  });
});
