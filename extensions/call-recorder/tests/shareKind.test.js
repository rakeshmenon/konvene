import { describe, expect, it } from "vitest";
import { noSoundAdvice, shareKindOf, soundPlanFor } from "../src/domain/shareKind.js";
describe("shareKindOf", () => {
  it("reads what Chrome reports for the shared surface", () => {
    expect(shareKindOf("browser")).toBe("tab");
    expect(shareKindOf("monitor")).toBe("screen");
    expect(shareKindOf("window")).toBe("window");
  });
  it("does not guess when Chrome says nothing", () => {
    expect(shareKindOf(undefined)).toBe("unknown");
    expect(shareKindOf("something-new")).toBe("unknown");
  });
});
describe("soundPlanFor", () => {
  it("keeps the call tab's copy for a shared tab, whose sound does not hold the call", () => {
    expect(soundPlanFor("tab").keepCallTabCopy).toBe(true);
  });
  it("drops the call tab's copy for a whole screen, whose sound holds the call already", () => {
    expect(soundPlanFor("screen").keepCallTabCopy).toBe(false);
  });
  it("keeps the copy when unsure, because a missing call is worse than a doubled one", () => {
    expect(soundPlanFor("unknown").keepCallTabCopy).toBe(true);
    expect(soundPlanFor("window").keepCallTabCopy).toBe(true);
  });
});
describe("noSoundAdvice", () => {
  it("says what to do differently for each kind of share", () => {
    expect(noSoundAdvice("window")).toMatch(/window/i);
    expect(noSoundAdvice("screen")).toMatch(/system audio/i);
    expect(noSoundAdvice("tab")).toMatch(/tab or Entire screen/);
  });
});
