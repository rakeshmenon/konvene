import { CONFIG } from "../config.js";
import { AppError } from "./errors.js";
/**
 * The order is the policy: lightest on the CPU first. To support another codec, add a line here.
 * Nothing else changes (open for extension, closed for modification).
 */
export const CANDIDATES = [
  { mimeType: "video/mp4;codecs=avc1,mp4a.40.2", container: "mp4", needsHardware: true, audioBitsPerSecond: 96_000 },
  { mimeType: "video/mp4;codecs=avc1,opus", container: "mp4", needsHardware: true, audioBitsPerSecond: 48_000 },
  { mimeType: "video/webm;codecs=vp9,opus", container: "webm", needsHardware: false, audioBitsPerSecond: 48_000 },
  { mimeType: "video/webm;codecs=vp8,opus", container: "webm", needsHardware: false, audioBitsPerSecond: 48_000 },
];
export async function selectProfile(probe) {
  const hardware = await probe.hasHardwareH264();
  const pick = CANDIDATES.find((c) => (!c.needsHardware || hardware) && probe.isTypeSupported(c.mimeType));
  if (!pick) throw new AppError("no-encoder", "This browser cannot record video in a format we support.");
  return {
    mimeType: pick.mimeType,
    container: pick.container,
    extension: pick.container,
    videoBitsPerSecond: CONFIG.video.bitsPerSecond,
    audioBitsPerSecond: pick.audioBitsPerSecond,
  };
}

/**
 * What the browser can do. A port, so the choice below is a pure function that tests can drive.
 * @typedef {object} CodecProbe
 * @property {(mimeType: string) => boolean} isTypeSupported
 * @property {() => Promise<boolean>} hasHardwareH264
 */

/**
 * @typedef {object} Candidate
 * @property {string} mimeType
 * @property {Container} container
 * @property {number} audioBitsPerSecond Speech needs far more bits in AAC than in Opus for the same clarity. A 32 kbps AAC recording of a voice came out swishy, with holes in the high frequencies, so AAC gets 96 kbps and Opus 48 kbps.
 * @property {boolean} needsHardware H.264 only counts when a hardware encoder exists, because software H.264 is no lighter than VP9.
 */
