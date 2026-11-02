import { CONFIG } from "../config.js";
/** Reads and deletes the live files in the browser's private file system. */
export class OpfsStagingStore {
  async read(stagingName) {
    const dir = await this.dir();
    const handle = await dir.getFileHandle(stagingName);
    return handle.getFile();
  }
  async remove(stagingName) {
    const dir = await this.dir();
    try {
      await dir.removeEntry(stagingName);
    } catch (e) {
      if (e.name !== "NotFoundError") throw e;
    }
  }
  async dir() {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(CONFIG.stagingDir, { create: true });
  }
}
