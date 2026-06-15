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
