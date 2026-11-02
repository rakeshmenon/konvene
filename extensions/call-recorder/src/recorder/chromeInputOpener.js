import { CONFIG } from "../config.js";
import { AppError } from "../domain/errors.js";
import { onAnyTrackEnded } from "./trackEvents.js";
/** The microphone request, in one place so the extension and the test harness ask for exactly the same thing. */
export function openMicrophone(media, options) {
  return media.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: options.browserNoiseSuppression, autoGainControl: true },
  });
}
/** Opens the captured tab (from the stream id the service worker got) and the microphone. */
export class ChromeInputOpener {
  media;
  constructor(media = navigator.mediaDevices) {
    this.media = media;
  }
  async open(streamId, options) {
    const { maxWidth, maxHeight, maxFrameRate } = CONFIG.video;
    // Chrome's tab capture still uses the old "mandatory" constraint form, which the DOM typings do not know.
    const tabConstraints = {
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
      video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId, maxWidth, maxHeight, maxFrameRate } },
    };
    const tab = await this.media.getUserMedia(tabConstraints);
    let mic;
    try {
      mic = await openMicrophone(this.media, options);
    } catch {
      tab.getTracks().forEach((t) => t.stop());
      // A recording without your own voice would be a surprise, so we stop here instead.
      throw new AppError("capture-failed", "Microphone access is needed. Open the setup page and allow the microphone.");
    }
    const tracks = [...tab.getTracks()];
    return {
      tab,
      mic,
      onTabEnded: (callback) => onAnyTrackEnded(tracks, callback),
      close: () => [...tab.getTracks(), ...mic.getTracks()].forEach((t) => t.stop()),
    };
  }
}
