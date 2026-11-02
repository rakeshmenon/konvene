import { AppError } from "../domain/errors.js";
/** Actions on a saved recording. Only files saved through Downloads can be shown or deleted from here. */
export class DownloadsFileGateway {
  async reveal(location) {
    if (location.kind === "folder") {
      throw new AppError("not-found", `This recording is in your chosen folder, "${location.folderName}".`);
    }
    chrome.downloads.show(location.downloadId);
  }
  async remove(location) {
    if (location.kind === "folder") return; // we hold no handle to a single file there, so it is left alone
    try {
      await chrome.downloads.removeFile(location.downloadId);
    } catch {
      /* already deleted by the user */
    }
    await chrome.downloads.erase({ id: location.downloadId });
  }
}
