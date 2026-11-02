import { describe, expect, it } from "vitest";
import { VoiceGuard } from "../src/domain/voiceGuard.js";
const STEP = 250;
/** Feeds the guard a steady pair of levels for some seconds and returns whether it asked for a bypass. */
function feed(guard, raw, processed, seconds) {
  let result = false;
  for (let t = 0; t < seconds * 1000; t += STEP) result = guard.observe(raw, processed, STEP);
  return result;
}
describe("VoiceGuard", () => {
  it("asks for a bypass when the microphone is loud but the cleaned sound stays silent for a short while", () => {
    expect(feed(new VoiceGuard(), 0.08, 0, 2)).toBe(true);
  });
  it("stays quiet when the cleaned sound follows the microphone", () => {
    expect(feed(new VoiceGuard(), 0.08, 0.06, 30)).toBe(false);
  });
  it("stays quiet when the room is silent, because there is nothing to lose", () => {
    expect(feed(new VoiceGuard(), 0.001, 0, 30)).toBe(false);
  });
  it("is not triggered by a short gap, such as a cough that noise reduction removes", () => {
    const guard = new VoiceGuard();
    expect(feed(guard, 0.08, 0, 1)).toBe(false);
    expect(feed(guard, 0.08, 0.05, 1)).toBe(false); // voice came through again, so the count starts over
    expect(feed(guard, 0.08, 0, 1)).toBe(false);
  });
  it("adds up loud-in, nothing-out time across the pauses between words", () => {
    const guard = new VoiceGuard();
    let tripped = false;
    // one second of speech swallowed, one second of quiet, repeated
    for (let second = 0; second < 8 && !tripped; second++) {
      tripped = feed(guard, second % 2 === 0 ? 0.08 : 0.001, 0, 1);
    }
    expect(tripped).toBe(true);
  });
  it("stays bypassed once it has asked", () => {
    const guard = new VoiceGuard();
    feed(guard, 0.08, 0, 4);
    expect(guard.bypassed).toBe(true);
    expect(feed(guard, 0.08, 0.08, 10)).toBe(true);
  });
});
