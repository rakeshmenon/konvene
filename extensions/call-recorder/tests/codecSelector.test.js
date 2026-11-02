import { describe, expect, it } from "vitest";
import { selectProfile } from "../src/domain/codecSelector.js";
function probe(supported, hardware) {
  return { isTypeSupported: (m) => supported.includes(m), hasHardwareH264: async () => hardware };
}
const MP4_AAC = "video/mp4;codecs=avc1,mp4a.40.2";
const MP4_OPUS = "video/mp4;codecs=avc1,opus";
const WEBM_VP9 = "video/webm;codecs=vp9,opus";
const WEBM_VP8 = "video/webm;codecs=vp8,opus";
describe("selectProfile", () => {
  it("prefers MP4 with H.264 and AAC when a hardware encoder exists", async () => {
    const p = await selectProfile(probe([MP4_AAC, MP4_OPUS, WEBM_VP9], true));
    expect(p.mimeType).toBe(MP4_AAC);
    expect(p.container).toBe("mp4");
    expect(p.extension).toBe("mp4");
  });
  it("falls back to MP4 with Opus when AAC is missing", async () => {
    const p = await selectProfile(probe([MP4_OPUS, WEBM_VP9], true));
    expect(p.mimeType).toBe(MP4_OPUS);
  });
  it("uses WebM with VP9 when there is no hardware H.264, even if MP4 is supported", async () => {
    const p = await selectProfile(probe([MP4_AAC, MP4_OPUS, WEBM_VP9], false));
    expect(p.mimeType).toBe(WEBM_VP9);
    expect(p.container).toBe("webm");
  });
  it("falls back to VP8 when VP9 is missing", async () => {
    const p = await selectProfile(probe([WEBM_VP8], false));
    expect(p.mimeType).toBe(WEBM_VP8);
  });
  it("gives each codec the audio bitrate it needs to sound clear", async () => {
    expect((await selectProfile(probe([MP4_AAC], true))).audioBitsPerSecond).toBe(96_000); // AAC at 32 kbps sounded swishy
    expect((await selectProfile(probe([MP4_OPUS], true))).audioBitsPerSecond).toBe(48_000);
    expect((await selectProfile(probe([WEBM_VP9], false))).audioBitsPerSecond).toBe(48_000);
  });
  it("carries the configured video bitrate", async () => {
    expect((await selectProfile(probe([WEBM_VP9], false))).videoBitsPerSecond).toBe(800_000);
  });
  it("throws a coded error when nothing is supported", async () => {
    await expect(selectProfile(probe([], true))).rejects.toMatchObject({ code: "no-encoder" });
  });
});
