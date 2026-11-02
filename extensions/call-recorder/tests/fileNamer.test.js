import { describe, expect, it } from "vitest";
import { buildFileName, buildStagingName, containerMimeType, extensionFromMime, slug } from "../src/domain/fileNamer.js";
import { formatBytes, formatDuration } from "../src/shared/format.js";
describe("fileNamer", () => {
  it("builds a dated, site-tagged file name in local time", () => {
    const startedAt = new Date(2026, 10, 2, 9, 5).getTime();
    expect(buildFileName({ startedAt, siteId: "google-meet", extension: "mp4" })).toBe("call-2026-11-02-0905-google-meet.mp4");
  });
  it("keeps file names safe", () => {
    expect(slug("  Weird/Name: 1!! ")).toBe("weird-name-1");
    const startedAt = new Date(2026, 0, 1, 0, 0).getTime();
    expect(buildFileName({ startedAt, siteId: "../../x", extension: "webm" })).toBe("call-2026-01-01-0000-x.webm");
    expect(buildFileName({ startedAt, siteId: "***", extension: "webm" })).toBe("call-2026-01-01-0000-call.webm");
  });
  it("gives staging files a stable name from the record id", () => {
    expect(buildStagingName("A1/B2")).toBe("rec-a1-b2");
  });
});
describe("download type", () => {
  it("reduces a codec string to the container type Chrome uses to name the file", () => {
    expect(containerMimeType("video/mp4;codecs=avc1,mp4a.40.2")).toBe("video/mp4");
    expect(containerMimeType("video/webm;codecs=vp9,opus")).toBe("video/webm");
    expect(containerMimeType("VIDEO/WEBM")).toBe("video/webm");
  });
  it("never returns an empty or text type, even for odd input", () => {
    expect(containerMimeType("")).toBe("video/webm");
    expect(containerMimeType("text/plain")).toBe("video/webm");
    expect(containerMimeType("video/mp4")).toBe("video/mp4");
  });
  it("agrees with the file extension", () => {
    for (const m of ["video/mp4;codecs=avc1,opus", "video/webm;codecs=vp8,opus"]) {
      expect(containerMimeType(m)).toBe(`video/${extensionFromMime(m)}`);
    }
  });
});
describe("format", () => {
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatDuration(-5)).toBe("0:00");
  });
  it("formats sizes", () => {
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(12_300_000)).toBe("12.3 MB");
    expect(formatBytes(250_000_000)).toBe("250 MB");
    expect(formatBytes(1_500_000_000)).toBe("1.5 GB");
  });
});
