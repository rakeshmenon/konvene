import { DEFAULT_SETTINGS } from "../../src/domain/types.js";
export class MemoryStore {
  data = new Map();
  async get(key) {
    return structuredClone(this.data.get(key));
  }
  async set(key, value) {
    this.data.set(key, structuredClone(value));
  }
}
export class MemoryRepository {
  items = new Map();
  async all() {
    return [...this.items.values()].map((r) => ({ ...r }));
  }
  async get(id) {
    const r = this.items.get(id);
    return r ? { ...r } : undefined;
  }
  async save(record) {
    this.items.set(record.id, { ...record });
  }
  async remove(id) {
    this.items.delete(id);
  }
}
export class FakeTabs {
  url;
  title;
  sent = [];
  failSend = false;
  /** When true the page receives the message but never confirms its badge, like an older Konvene. */
  noAck = false;
  failCapture = false;
  constructor(url = "https://meet.google.com/abc-defg-hij", title = "Meet - abc") {
    this.url = url;
    this.title = title;
  }
  async describe() {
    return { url: this.url, title: this.title };
  }
  async captureStreamId() {
    if (this.failCapture) throw new Error("tab not capturable");
    return "stream-1";
  }
  async send(tabId, message) {
    if (this.failSend) throw new Error("Receiving end does not exist");
    this.sent.push({ tabId, message });
    return this.noAck ? undefined : { shown: true };
  }
}
export class FakeRecorder {
  recording = false;
  started = [];
  released = [];
  failStart = false;
  failExport = false;
  noiseReductionSeen = null;
  capture = { stagingName: "", sizeBytes: 5_000_000, durationMs: 62_000, mimeType: "video/mp4;codecs=avc1,mp4a.40.2", soundDetected: true };
  async isRecording() {
    return this.recording;
  }
  offers = [];
  endedShares = [];
  failShare = false;
  async shareOffer(offer) {
    if (this.failShare) throw new Error("no sound");
    this.offers.push(offer);
    return `answer-for-${offer.shareId}`;
  }
  async shareEnded(shareId) {
    this.endedShares.push(shareId);
  }
  async levels() {
    return this.recording ? { micIn: 0.1, mic: 0.1, tab: 0.05, shared: 0, sharedActive: false, noiseReductionBypassed: false } : null;
  }
  async start(req) {
    if (this.failStart) throw new Error("encoder failed");
    this.recording = true;
    this.started.push(req);
    this.noiseReductionSeen = req.noiseReduction;
    return { mimeType: "video/mp4;codecs=avc1,mp4a.40.2", extension: "mp4" };
  }
  async stop() {
    this.recording = false;
    return { ...this.capture, stagingName: this.started.at(-1)?.stagingName ?? "" };
  }
  async exportFile(stagingName, fileName, mimeType) {
    if (this.failExport) throw new Error("no such file");
    return { stagingName, fileName, mimeType, sizeBytes: this.capture.sizeBytes, blobUrl: `blob:${stagingName}` };
  }
  async release(file, deleteStaging) {
    this.released.push({ stagingName: file.stagingName, deleteStaging });
  }
  async writeToFolder() {
    return { folderName: "Calls" };
  }
}
export class FakeOutput {
  written = [];
  fail = false;
  async write(file) {
    if (this.fail) throw new Error("disk full");
    this.written.push(file);
    return { kind: "downloads", downloadId: 9, path: `/Downloads/Call Recordings/${file.fileName}` };
  }
}
export class FakeFiles {
  revealed = [];
  removed = [];
  async reveal(l) {
    this.revealed.push(l);
  }
  async remove(l) {
    this.removed.push(l);
  }
}
export class FakeClock {
  t;
  constructor(t = new Date(2026, 10, 2, 11, 5).getTime()) {
    this.t = t;
  }
  now() {
    return this.t;
  }
  advance(ms) {
    this.t += ms;
  }
}
export class CountingIds {
  n = 0;
  next() {
    this.n += 1;
    return `id${this.n}`;
  }
}
export class FakeSettings {
  value;
  constructor(value = { ...DEFAULT_SETTINGS }) {
    this.value = value;
  }
  async read() {
    return { ...this.value };
  }
  async write(patch) {
    this.value = { ...this.value, ...patch };
    return { ...this.value };
  }
}
