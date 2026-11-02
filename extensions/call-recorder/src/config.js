// Every tunable number and name lives here, so no module repeats a literal.
import konveneDevOrigins from "./domain/sites/konveneDevOrigins.json";
import konveneOrigins from "./domain/sites/konveneOrigins.json";
// Set by build.mjs. Only the development build knows about localhost, so the store version never asks for it.
const DEV_BUILD = typeof __DEV_BUILD__ !== "undefined" && __DEV_BUILD__;
export const CONFIG = {
  /** Subfolder of the browser's Downloads folder used when no custom folder is chosen. */
  downloadsFolder: "Call Recordings",
  /** Directory in the browser's private file system where live recordings are written. */
  stagingDir: "recordings",
  /** How often the encoder hands over a chunk, so only a second or so is ever held in memory. */
  timesliceMs: 1000,
  video: { maxWidth: 1280, maxHeight: 720, maxFrameRate: 15, bitsPerSecond: 800_000 },
  audio: { sampleRate: 48_000 },
  /** Origins where the Konvene bridge runs. build.mjs copies the same list into the manifest. */
  konveneOrigins: [...konveneOrigins, ...(DEV_BUILD ? konveneDevOrigins : [])],
};
