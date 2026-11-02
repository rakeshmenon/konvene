/** Asks this browser what it can encode. Kept apart from the choice itself so the choice stays testable. */
export class BrowserCodecProbe {
  isTypeSupported(mimeType) {
    return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType);
  }
  async hasHardwareH264() {
    if (typeof VideoEncoder === "undefined") return false;
    try {
      const result = await VideoEncoder.isConfigSupported({
        codec: "avc1.42001f",
        width: 1280,
        height: 720,
        bitrate: 800_000,
        framerate: 15,
        hardwareAcceleration: "prefer-hardware",
      });
      return result.supported === true;
    } catch {
      return false;
    }
  }
}
