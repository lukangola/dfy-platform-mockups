import { describe, it, expect } from "vitest";
import { isDurableCoverUrl } from "./adConsoleCovers.js";

describe("isDurableCoverUrl", () => {
  it("treats fal.media / fal.storage URLs as durable (skip re-hosting)", () => {
    expect(isDurableCoverUrl("https://v3b.fal.media/files/b/abc/cover.jpg")).toBe(true);
    expect(isDurableCoverUrl("https://fal.storage/xyz.png")).toBe(true);
  });

  it("treats expiring TikTok/IG signed URLs as NOT durable (must re-host)", () => {
    expect(isDurableCoverUrl("https://p16-common-sign.tiktokcdn-us.com/tos-useast8-p-0068-tx2/oAAO")).toBe(false);
    expect(isDurableCoverUrl("https://scontent.cdninstagram.com/v/t51.2885-15/xyz.jpg")).toBe(false);
  });

  it("is false for null / empty", () => {
    expect(isDurableCoverUrl(null)).toBe(false);
    expect(isDurableCoverUrl(undefined)).toBe(false);
    expect(isDurableCoverUrl("")).toBe(false);
  });
});
