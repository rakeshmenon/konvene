const PAGE = "offscreen.html";
/** Talks to the recorder engine in the offscreen document, and opens that document when it is needed. */
export class OffscreenRecorderGateway {
  call;
  creating = null;
  constructor(call) {
    this.call = call;
  }
  async isRecording() {
    if (!(await this.hasDocument())) return false;
    try {
      return (await this.call("engine/status", {})).recording;
    } catch {
      return false;
    }
  }
  async levels() {
    if (!(await this.hasDocument())) return null;
    try {
      return (await this.call("engine/levels", {})).levels;
    } catch {
      return null;
    }
  }
  async start(req) {
    await this.ensure();
    return this.call("engine/start", req);
  }
  stop() {
    return this.call("engine/stop", {});
  }
  async shareOffer(offer) {
    return (await this.call("engine/share-offer", offer)).answer;
  }
  async shareEnded(shareId) {
    await this.call("engine/share-ended", { shareId });
  }
  async exportFile(stagingName, fileName, mimeType) {
    await this.ensure();
    return this.call("engine/export", { stagingName, fileName, mimeType });
  }
  async release(file, deleteStaging) {
    await this.ensure();
    await this.call("engine/release", { stagingName: file.stagingName, blobUrl: file.blobUrl, deleteStaging });
  }
  async writeToFolder(stagingName, fileName) {
    await this.ensure();
    return this.call("engine/write-to-folder", { stagingName, fileName });
  }
  // ---- the offscreen document ----
  async hasDocument() {
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    return contexts.length > 0;
  }
  async ensure() {
    if (!(await this.hasDocument())) {
      // Only one document may exist, so two callers share one creation.
      this.creating ??= chrome.offscreen
        .createDocument({
          url: PAGE,
          reasons: [chrome.offscreen.Reason.USER_MEDIA],
          justification: "Records the call tab and microphone, and keeps recording while the popup is closed.",
        })
        .finally(() => {
          this.creating = null;
        });
      await this.creating;
    }
    await this.waitUntilAnswering();
  }
  /** A new document needs a moment before its message listener exists. */
  async waitUntilAnswering() {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await this.call("engine/status", {});
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error("The recorder did not start. Reload the extension and try again.");
  }
}
