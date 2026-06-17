import { describe, it, expect } from "vitest";
import { isLikelyEnglish } from "./adConsoleOrganic.js";

describe("isLikelyEnglish", () => {
  it("keeps English captions", () => {
    expect(isLikelyEnglish("the best sunscreen for sensitive skin, my honest review")).toBe(true);
    expect(isLikelyEnglish("how to get rid of white cast with mineral spf")).toBe(true);
    expect(isLikelyEnglish("best sunscreen ever 🔥🔥")).toBe(true);
  });

  it("drops clearly non-English Latin languages", () => {
    expect(isLikelyEnglish("el mejor protector solar para piel sensible y con rosacea")).toBe(false); // es
    expect(isLikelyEnglish("o melhor protetor solar para pele oleosa, não deixa a pele branca")).toBe(false); // pt
    expect(isLikelyEnglish("die beste sonnencreme für empfindliche haut, nicht fettig")).toBe(false); // de
  });

  it("drops non-Latin scripts", () => {
    expect(isLikelyEnglish("최고의 선크림 추천 화이트 캐스트 없는")).toBe(false); // ko
    expect(isLikelyEnglish("أفضل واقي شمس للبشرة الحساسة")).toBe(false); // ar
    expect(isLikelyEnglish("ครีมกันแดดที่ดีที่สุดสำหรับผิวแพ้ง่าย")).toBe(false); // th
  });

  it("keeps ambiguous / hashtag-only / empty captions (keep-bias)", () => {
    expect(isLikelyEnglish("#sunscreen #skincare #spf ☀️🧴")).toBe(true);
    expect(isLikelyEnglish(null)).toBe(true);
    expect(isLikelyEnglish("")).toBe(true);
  });
});
