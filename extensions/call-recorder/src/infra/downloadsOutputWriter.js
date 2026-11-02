import { CONFIG } from "../config.js";
/** Saves into Downloads/Call Recordings. No permission prompt, and it works on every machine. */
export class DownloadsOutputWriter {
  async write(file) {
    const downloadId = await chrome.downloads.download({
      url: file.blobUrl,
      filename: `${CONFIG.downloadsFolder}/${file.fileName}`,
      conflictAction: "uniquify",
      saveAs: false,
    });
    const item = await this.untilFinished(downloadId);
    return { kind: "downloads", downloadId, path: item.filename };
  }
  /** Resolves when the file is fully on disk. The object URL must stay alive until then. */
  untilFinished(id) {
    return new Promise((resolve, reject) => {
      const check = async () => {
        const [item] = await chrome.downloads.search({ id });
        if (!item) return fail(new Error("The download disappeared."));
        if (item.state === "complete") return done(item);
        if (item.state === "interrupted") return fail(new Error(item.error ?? "The download was interrupted."));
      };
      const onChanged = (delta) => {
        if (delta.id === id) void check().catch(fail);
      };
      const cleanup = () => chrome.downloads.onChanged.removeListener(onChanged);
      const done = (item) => {
        cleanup();
        resolve(item);
      };
      const fail = (e) => {
        cleanup();
        reject(e);
      };
      chrome.downloads.onChanged.addListener(onChanged);
      void check().catch(fail); // it may already be finished
    });
  }
}
