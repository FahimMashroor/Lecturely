import { describe, expect, it } from "vitest";
import { mergeOverlap } from "@/lib/merge";

describe("mergeOverlap", () => {
  it("removes words heard twice in the overlap", () => {
    expect(
      mergeOverlap(
        "Today we will study the law of thermo",
        "the law of thermodynamics and entropy.",
      ),
    ).toBe("Today we will study the law of thermodynamics and entropy.");
  });

  it("drops the half-heard word at the end of the first piece", () => {
    // "photosynth" was cut off; the next piece heard it whole.
    expect(
      mergeOverlap(
        "Plants make food by photosynth",
        "make food by photosynthesis, using sunlight.",
      ),
    ).toBe("Plants make food by photosynthesis, using sunlight.");
  });

  it("ignores case and punctuation when matching", () => {
    expect(
      mergeOverlap("So the key idea is energy.", "the key idea is energy. It is never lost"),
    ).toBe("So the key idea is energy. It is never lost");
  });

  it("just joins the pieces when nothing matches", () => {
    expect(mergeOverlap("First part here.", "Completely new words now")).toBe(
      "First part here. Completely new words now",
    );
  });

  it("does not merge on one or two common words", () => {
    expect(mergeOverlap("We look at the", "the next slide")).toBe("We look at the the next slide");
  });

  it("does not remove real content far from the join", () => {
    const prev = "the speed of light is fast. " + "word ".repeat(20) + "end";
    const next = "end the speed of light is fast again";
    // Only "end" overlaps at the join (too short), so nothing is removed.
    expect(mergeOverlap(prev, next)).toBe(prev + " " + next);
  });

  it("works for Bangla", () => {
    expect(mergeOverlap("আজ আমরা শক্তির সংরক্ষণ সূত্র", "শক্তির সংরক্ষণ সূত্র নিয়ে পড়ব।")).toBe(
      "আজ আমরা শক্তির সংরক্ষণ সূত্র নিয়ে পড়ব।",
    );
  });

  it("works for Chinese, which has no spaces", () => {
    expect(mergeOverlap("今天我们学习能量守恒定律", "能量守恒定律的应用。")).toBe(
      "今天我们学习能量守恒定律的应用。",
    );
  });

  it("handles empty pieces", () => {
    expect(mergeOverlap("", "hello")).toBe("hello");
    expect(mergeOverlap("hello", "")).toBe("hello");
  });
});
