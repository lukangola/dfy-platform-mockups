import { describe, it, expect } from "vitest";
import { normalizeInviteBrandIds, filterGrantableBrandIds } from "./inviteBrands.js";

const TEAM = new Set(["b1", "b2", "b3"]);

describe("normalizeInviteBrandIds", () => {
  it("returns null for admin invites regardless of payload", () => {
    expect(normalizeInviteBrandIds(["b1"], "admin", TEAM)).toEqual({ ok: true, brandIds: null });
  });

  it("returns null when brandIds is absent or empty", () => {
    expect(normalizeInviteBrandIds(undefined, "member", TEAM)).toEqual({ ok: true, brandIds: null });
    expect(normalizeInviteBrandIds([], "member", TEAM)).toEqual({ ok: true, brandIds: null });
  });

  it("rejects a non-array payload", () => {
    const r = normalizeInviteBrandIds("b1", "member", TEAM);
    expect(r.ok).toBe(false);
  });

  it("rejects when any id is not a team brand, listing the foreign ids", () => {
    const r = normalizeInviteBrandIds(["b1", "nope", "also-nope"], "member", TEAM);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("nope");
      expect(r.error).toContain("also-nope");
    }
  });

  it("dedupes and drops non-string entries, keeping order", () => {
    const r = normalizeInviteBrandIds(["b2", "b2", 42, "b1"], "manager", TEAM);
    expect(r).toEqual({ ok: true, brandIds: ["b2", "b1"] });
  });
});

describe("filterGrantableBrandIds", () => {
  it("keeps only ids that still exist on the team", () => {
    expect(filterGrantableBrandIds(["b1", "deleted", "b3"], TEAM)).toEqual(["b1", "b3"]);
  });

  it("tolerates malformed stored jsonb (null / non-array / junk entries)", () => {
    expect(filterGrantableBrandIds(null, TEAM)).toEqual([]);
    expect(filterGrantableBrandIds("garbage", TEAM)).toEqual([]);
    expect(filterGrantableBrandIds([1, {}, "b2"], TEAM)).toEqual(["b2"]);
  });
});
