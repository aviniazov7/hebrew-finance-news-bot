import { describe, expect, it } from "vitest";
import { toHashtag, toHashtags } from "../src/hashtags.ts";

describe("toHashtag", () => {
  it("turns spaces and dashes into underscores and keeps Hebrew gershayim", () => {
    expect(toHashtag("מניות")).toBe("#מניות");
    expect(toHashtag("שער הדולר-שקל")).toBe("#שער_הדולר_שקל");
    expect(toHashtag("שער הדולר־שקל")).toBe("#שער_הדולר_שקל");
    expect(toHashtag("מחיר הנפט")).toBe("#מחיר_הנפט");
    expect(toHashtag('אג"ח')).toBe("#אג״ח");
    expect(toHashtag("אג״ח")).toBe("#אג״ח");
    expect(toHashtag("נסיעות לחו״ל")).toBe("#נסיעות_לחו״ל");
  });

  it("strips characters that would end a Telegram hashtag", () => {
    expect(toHashtag("מניות!")).toBe("#מניות");
    expect(toHashtag("#מניות")).toBe("#מניות");
    expect(toHashtag("ריבית על פיקדונות.")).toBe("#ריבית_על_פיקדונות");
    expect(toHashtag("  מניות   שבבים  ")).toBe("#מניות_שבבים");
    expect(toHashtag("ETF")).toBeNull();
    expect(toHashtag("!!!")).toBeNull();
  });

  it("keeps at most six unique tags", () => {
    expect(
      toHashtags(["מניות", "מניות", "טכנולוגיה", 'אג"ח', "שער הדולר-שקל", "מחיר הנפט", "פיקדונות", "זהב"]),
    ).toEqual(["#מניות", "#טכנולוגיה", "#אג״ח", "#שער_הדולר_שקל", "#מחיר_הנפט", "#פיקדונות"]);
  });
});
