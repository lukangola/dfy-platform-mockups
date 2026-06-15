import { describe, it, expect, vi } from "vitest";
import { GethookdClient, CreditExhaustedError } from "./gethookd.js";

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
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer k");
    expect(res.credits).toEqual({ used: 0.5, remaining: 399.5 });
  });
  it("throws CreditExhaustedError on 402", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({}) });
    const c = new GethookdClient({ apiKey: "k", baseUrl: "https://api.test", fetchImpl });
    await expect(c.explore({ niche: "x" })).rejects.toBeInstanceOf(CreditExhaustedError);
  });
});

describe("GethookdClient.addBrandSpy", () => {
  it("resolves true on status 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const c = new GethookdClient({ apiKey: "k", baseUrl: "https://api.test", fetchImpl });
    await expect(c.addBrandSpy("brand123")).resolves.toBe(true);
  });

  it("resolves true on status 409 (already monitored)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });
    const c = new GethookdClient({ apiKey: "k", baseUrl: "https://api.test", fetchImpl });
    await expect(c.addBrandSpy("brand123")).resolves.toBe(true);
  });

  it("rejects with CreditExhaustedError on status 402", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({}) });
    const c = new GethookdClient({ apiKey: "k", baseUrl: "https://api.test", fetchImpl });
    await expect(c.addBrandSpy("brand123")).rejects.toBeInstanceOf(CreditExhaustedError);
  });
});

import { normalizeGethookdAd, scoreGethookdTraction } from "./gethookd.js";

const ad: GethookdAd = {
  id: "9", performance_score: 9.2, performance_score_title: "winning", ad_spend_range_score_title: "$$$",
  days_active: 84, used_count: 9, active_in_library: 0, start_date: "2026-01-01", end_date: "2026-03-26",
  display_format: "video", page_type: "vsl_page", share_url: "https://s/9",
  media: [{ type: "video", url: "https://v/9.mp4", thumbnail_url: "https://t/9.jpg" }],
  ad_cards: [{ body: "B", cta_text: "Shop", landing_page: "https://lp/9" }],
  brand: { external_id: "b1", name: "Acme" },
};
describe("normalizeGethookdAd", () => {
  it("maps to the ad_creatives field shape", () => {
    const n = normalizeGethookdAd(ad);
    expect(n.externalId).toBe("9");
    expect(n.advertiserName).toBe("Acme");
    expect(n.format).toBe("video");
    expect(n.mediaUrls).toEqual(["https://v/9.mp4"]);
    expect(n.landingUrl).toBe("https://lp/9");
    expect(n.isActive).toBe(false);
    expect(n.runtimeDays).toBe(84);
    expect(n.variationCount).toBe(9);
  });
});
describe("scoreGethookdTraction", () => {
  it("normalizes performance_score (0..10) to 0..1, dominant", () => {
    expect(scoreGethookdTraction(ad)).toBeCloseTo(0.92, 2);
    expect(scoreGethookdTraction({ id: "x" })).toBe(0);
  });
});
