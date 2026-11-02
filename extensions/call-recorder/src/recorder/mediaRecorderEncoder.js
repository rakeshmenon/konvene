import { CONFIG } from "../config.js";
/** Encodes with the browser's own MediaRecorder, so the hardware encoder is used when there is one. */
export class MediaRecorderEncoder {
  recorder = null;
  start(stream, profile, onChunk, onFail) {
    const recorder = new MediaRecorder(stream, {
      mimeType: profile.mimeType,
      videoBitsPerSecond: profile.videoBitsPerSecond,
      audioBitsPerSecond: profile.audioBitsPerSecond,
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) onChunk(e.data);
    };
    recorder.onerror = (e) => onFail(new Error(e.error?.message ?? "The encoder failed."));
    recorder.start(CONFIG.timesliceMs);
    this.recorder = recorder;
  }
  stop() {
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder || recorder.state === "inactive") return Promise.resolve();
    return new Promise((resolve) => {
      // The last chunk is delivered just before this event fires.
      recorder.onstop = () => resolve();
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
  }
}
