// Runs in a dedicated worker and owns one file in the browser's private file system.
// A synchronous access handle writes straight to disk and can flush, so a crash loses at most the last chunk.
// (A normal writable stream only commits when it is closed, which would lose everything on a crash.)
import { CONFIG } from "../config.js";
const scope = self;
let handle = null;
let offset = 0;
async function open(name) {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(CONFIG.stagingDir, { create: true });
  const file = await dir.getFileHandle(name, { create: true });
  handle = await file.createSyncAccessHandle();
  handle.truncate(0);
  offset = 0;
}
function append(buffer) {
  if (!handle) throw new Error("File is not open.");
  const written = handle.write(new Uint8Array(buffer), { at: offset });
  if (written !== buffer.byteLength) throw new Error("The disk did not accept the whole chunk.");
  offset += written;
  handle.flush();
}
function close() {
  if (!handle) return;
  handle.flush();
  handle.close();
  handle = null;
}
scope.onmessage = async (e) => {
  const req = e.data;
  try {
    if (req.op === "open") await open(req.name);
    else if (req.op === "append") append(req.buffer);
    else close();
    scope.postMessage({ id: req.id, ok: true, bytes: offset });
  } catch (err) {
    scope.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

/**
 * @typedef {{ id: number; op: "open"; name: string } | { id: number; op: "append"; buffer: ArrayBuffer } | { id: number; op: "close" }} Request
 */

/**
 * @typedef {object} SyncHandle
 * @property {(buffer: ArrayBufferView, options: { at: number }) => number} write
 * @property {(size: number) => void} truncate
 * @property {() => void} flush
 * @property {() => void} close
 */
