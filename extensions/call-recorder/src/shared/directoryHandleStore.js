// The chosen output folder is a handle that cannot go in chrome.storage, so it lives in IndexedDB.
// Every extension page and the offscreen engine share the extension's origin, so they all see the same one.
const DB_NAME = "call-recorder";
const STORE = "handles";
const KEY = "output-folder";
function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open the folder store."));
  });
}
async function run(mode, action) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Folder store failed."));
    });
  } finally {
    db.close();
  }
}
export const directoryHandleStore = {
  get: () => run("readonly", (s) => s.get(KEY)),
  set: async (handle) => {
    await run("readwrite", (s) => s.put(handle, KEY));
  },
  clear: async () => {
    await run("readwrite", (s) => s.delete(KEY));
  },
};

/**
 * @typedef {object} DirectoryHandleStore
 * @property {() => Promise<FileSystemDirectoryHandle | undefined>} get
 * @property {(handle: FileSystemDirectoryHandle) => Promise<void>} set
 * @property {() => Promise<void>} clear
 */
