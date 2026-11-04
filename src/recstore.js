// Where recordings live while they're made: this site's private storage on your own disk (the origin
// private file system: no permission prompt, invisible to other sites, never uploaded).
//
// A small worker writes each piece of the file straight into place and flushes it to disk, so if
// the browser crashes or the tab is closed mid-recording, what was recorded so far is still there.
// (The simpler way of writing files only makes them permanent when they're closed.) A short list in
// local storage remembers each file's state:
//   recording  being made (a heartbeat says the tab is still alive)
//   done       finished, not saved yet
//   saved      handed to your Downloads; cleared from here a little later
// The next time Konvene opens, a recording that was never saved is offered back to you.

const DIR = "konvene-recordings";
const KEY = "konvene_recs";
const SAVED_KEEP_MS = 10 * 60 * 1000; // time for a download to finish reading the file
const STALE_MS = 30 * 1000; // no heartbeat for this long: the tab that was recording is gone

function readIndex() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; }
}
function writeIndex(ix) {
  try { localStorage.setItem(KEY, JSON.stringify(ix)); } catch { /* private mode: no rescue */ }
}
// patch a recording's entry; null removes it
export function mark(name, patch) {
  const ix = readIndex();
  if (patch === null) delete ix[name];
  else ix[name] = { ...(ix[name] || {}), ...patch };
  writeIndex(ix);
}

async function folder() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

// the worker: open a file for in-place writing and write pieces at their positions. What's written
// is in the file at once (a browser crash can't take it back); it's also pushed to the disk itself
// every couple of seconds, which costs too much to do for every piece.
const WORKER = `
let h = null, flushed = 0;
onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.op === "open") {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(m.dir, { create: true });
      const fh = await dir.getFileHandle(m.name, { create: true });
      h = await fh.createSyncAccessHandle();
      h.truncate(0);
    } else if (m.op === "write") {
      h.write(new Uint8Array(m.data), { at: m.position });
      if (Date.now() - flushed > 2000) { h.flush(); flushed = Date.now(); }
    } else if (m.op === "close") {
      if (h) { h.flush(); h.close(); h = null; }
    }
    postMessage({ id: m.id, ok: true });
  } catch (err) {
    postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  }
};`;

async function openWithWorker(name) {
  const url = URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  let n = 0;
  const waiting = new Map();
  w.onmessage = (e) => { const p = waiting.get(e.data.id); if (!p) return; waiting.delete(e.data.id); if (e.data.ok) p.resolve(); else p.reject(new Error(e.data.error)); };
  w.onerror = (e) => { for (const p of waiting.values()) p.reject(new Error(e.message || "worker failed")); waiting.clear(); };
  const call = (msg, transfer = []) => new Promise((resolve, reject) => { const id = ++n; waiting.set(id, { resolve, reject }); w.postMessage({ ...msg, id }, transfer); });
  try { await call({ op: "open", dir: DIR, name }); } catch (e) { w.terminate(); throw e; }
  // Pieces that follow on from each other are gathered and sent together, every 256 KB or every
  // second, whichever comes first: one round trip per piece kept the encoders waiting on a busy
  // computer. The recorder only waits when a lot is still on its way to the disk.
  let buf = [], bufPos = -1, bufLen = 0, timer = 0, inflight = 0, failed = null;
  let chain = Promise.resolve();
  const send = () => {
    clearTimeout(timer); timer = 0;
    if (!bufLen) return chain;
    const data = new Uint8Array(bufLen);
    let o = 0;
    for (const b of buf) { data.set(b, o); o += b.length; }
    const position = bufPos, size = data.length;
    buf = []; bufLen = 0; bufPos = -1;
    inflight += size;
    chain = chain.then(() => call({ op: "write", data: data.buffer, position }, [data.buffer]))
      .catch((e) => { failed = failed || e; })
      .finally(() => { inflight -= size; });
    return chain;
  };
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try { await send(); await chain; if (failed) throw failed; await call({ op: "close" }); } finally { w.terminate(); }
  };
  const writable = new WritableStream({
    write(chunk) {
      if (failed) throw failed;
      if (bufLen && chunk.position !== bufPos + bufLen) send();
      if (!bufLen) bufPos = chunk.position;
      const d = chunk.data.slice();
      buf.push(d); bufLen += d.length;
      if (bufLen >= 256 * 1024) send();
      else if (!timer) timer = setTimeout(send, 1000);
      return inflight > 8 * 1024 * 1024 ? chain : undefined;
    },
    close,
    abort: () => close().catch(() => {}),
  });
  return { writable, durable: true, close };
}

async function openWithWritable(name) {
  const dir = await folder();
  const handle = await dir.getFileHandle(name, { create: true });
  if (!handle.createWritable) throw new Error("no writable files here");
  const writable = await handle.createWritable();
  return { writable, durable: false, close: () => writable.close().catch(() => {}) };
}

// a new file on disk to write a recording into, or null where the browser doesn't allow it here.
// { writable: WritableStream of { type, data, position }, durable, file() }
export async function openRecordingFile(name) {
  if (!navigator.storage || !navigator.storage.getDirectory) return null;
  let f = null;
  try { f = await openWithWorker(name); } catch { /* no in-place writing here */ }
  if (!f) { try { f = await openWithWritable(name); } catch { return null; } }
  f.file = async () => (await (await folder()).getFileHandle(name)).getFile();
  return f;
}

export async function removeRecording(name) {
  mark(name, null);
  try { await (await folder()).removeEntry(name); } catch { /* gone, or busy in another tab */ }
}

// recordings an earlier visit left behind and never saved, newest first:
// [{ name, file, finished, format, at }]. Tidies up what's no longer needed on the way.
export async function leftovers() {
  const out = [];
  try {
    const dir = await folder();
    const ix = readIndex();
    const now = Date.now();
    const seen = new Set();
    for await (const [name, h] of dir.entries()) {
      seen.add(name);
      const info = ix[name];
      // not in the list (an older version's file, or a half-made repair): nothing to offer
      if (!info || info.state === "repairing") { await removeRecording(name); continue; }
      if (info.state === "saved") { if (now - (info.savedAt || 0) > SAVED_KEEP_MS) await removeRecording(name); continue; }
      // another tab is recording it right now (a heartbeat of 0 means its tab closed: offer it)
      const beat = typeof info.beat === "number" ? info.beat : info.at || 0;
      if (info.state === "recording" && now - beat < STALE_MS) continue;
      let file;
      try { file = await h.getFile(); } catch { continue; } // still being written somewhere
      if (!file.size) { await removeRecording(name); continue; }
      out.push({ name, file, finished: info.state === "done", format: info.format || (name.endsWith(".mp4") ? "mp4" : "webm"), at: info.at || file.lastModified });
    }
    for (const name of Object.keys(ix)) if (!seen.has(name)) mark(name, null);
  } catch { /* no private storage here */ }
  return out.sort((a, b) => b.at - a.at);
}

// Rewrite a recording into a plain file with its length and seek index at the end, without
// re-encoding (the pictures and sound are copied as they are). Used when a recording stops (MP4s
// are written in self-contained pieces while recording, so a crash can't ruin them) and for a
// recording rescued after a crash. Returns { name, file }; the original is removed.
export async function repair(lib, name, file, format) {
  const { Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, WebMOutputFormat, StreamTarget, Conversion } = lib;
  const outName = `${name.replace(/\.(mp4|webm)$/, "")}-final.${format}`;
  mark(outName, { state: "repairing", at: Date.now(), format });
  const disk = await openRecordingFile(outName);
  if (!disk) { mark(outName, null); throw new Error("no private storage"); }
  try {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const output = new Output({
      format: format === "mp4" ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
      target: new StreamTarget(disk.writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }),
    });
    const conversion = await Conversion.init({ input, output });
    if (!conversion.isValid) throw new Error("this recording can't be repackaged");
    await conversion.execute();
    const fixed = await disk.file();
    mark(outName, { state: "done", at: Date.now(), format });
    await removeRecording(name);
    return { name: outName, file: fixed };
  } catch (e) {
    try { await disk.close(); } catch { /* closed */ }
    await removeRecording(outName);
    throw e;
  }
}
