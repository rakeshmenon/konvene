// Records the call in this browser: everyone's video laid out like the call screen, plus all voices.
//
// The file is a proper MP4 (H.264 video, AAC sound), so it has a length and a seek bar in any
// player. Browsers that can't make MP4 make a WebM (VP9, Opus), also seekable. Video is encoded at
// a constant quality where the browser allows it: a still picture of people talking costs very
// few bytes, so files stay small without looking worse.
//
// While recording, the file is written to this site's private storage on your disk (the origin
// private file system: no permission prompt, invisible to other sites), not kept in memory, so a
// long call doesn't fill your computer's memory. When you stop, you save it as a normal download.
// Leftovers from an earlier visit are cleared the next time you open Konvene or record.
//
// Where the browser can't encode video itself (WebCodecs), the older built-in recorder is used.

// Mediabunny (src/encode.js) arrives only when the first recording starts; build.mjs fills in its path
let lib = null;
const loadLib = () => (lib ||= import(__ENCODE_JS__));

const DIR = "konvene-recordings";
const FPS = 30;

// the call screen's look (styles.css)
const C = {
  bg: "#f3f3ef", video: "#0f1f1a", screen: "#0b1713", avatar: "#24453a",
  label: "rgba(20, 20, 22, 0.55)", text: "#ffffff", muted: "#ff8b8e", brass: "#e0a93c",
  hair: "rgba(255, 255, 255, 0.06)",
};
const FONT = '"Instrument Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MIC_OFF = typeof Path2D !== "undefined"
  ? new Path2D("M15 9V6a3 3 0 0 0-5.8-1M9 9v2.5a3 3 0 0 0 4.8 2.4M18 11.5a6 6 0 0 1-1 3.3M6 11.5a6 6 0 0 0 9.2 5.1M12 17.5V21M4 4l16 16")
  : null;

const HAS_CODECS = typeof window !== "undefined" && "VideoEncoder" in window && "AudioEncoder" in window
  && ("MediaStreamTrackProcessor" in window || "AudioWorkletNode" in window);

// best choice this browser can actually encode: [container, video codec, audio codec, width, height]
async function choosePlan() {
  if (!HAS_CODECS) return null;
  try {
    const { canEncodeVideo, canEncodeAudio, Quality } = await loadLib();
    // tests only: test browsers have no AAC, so the MP4 path is checked with Opus sound
    const forced = window.__konveneRecPlan;
    if (forced) return { format: forced.format, video: forced.video, audio: forced.audio, W: forced.W, H: forced.H, quality: new Quality({ quantizer: 26, bitrate: 2_200_000, bitrateMode: "variable" }), latency: forced.latency || "quality" };
    // H.264 + AAC in MP4 plays everywhere (QuickTime, Windows, phones); usually hardware-encoded
    if (await canEncodeVideo("avc", { width: 1920, height: 1080 }) && await canEncodeAudio("aac")) {
      return { format: "mp4", video: "avc", audio: "aac", W: 1920, H: 1080, quality: new Quality({ quantizer: 26, bitrate: 2_200_000, bitrateMode: "variable" }), latency: "quality" };
    }
    // otherwise WebM; VP9 is usually encoded in software, so 720p keeps the computer cool
    const audio = (await canEncodeAudio("opus")) ? "opus" : null;
    if (audio) {
      for (const video of ["vp9", "vp8"]) {
        if (await canEncodeVideo(video, { width: 1280, height: 720 })) {
          return { format: "webm", video, audio, W: 1280, H: 720, quality: new Quality({ quality: 0.6, bitrateMode: "variable" }), latency: "realtime" };
        }
      }
    }
  } catch { /* fall through */ }
  return null;
}

// a file in the origin private file system, or null where the browser doesn't offer it here
async function openDiskFile(name) {
  try {
    if (!navigator.storage || !navigator.storage.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(DIR, { create: true });
    const handle = await dir.getFileHandle(name, { create: true });
    if (!handle.createWritable) return null;
    const writable = await handle.createWritable();
    return { dir, handle, writable };
  } catch {
    return null;
  }
}

// remove recordings left on disk by an earlier visit (one being written by another tab is locked
// and simply stays)
export async function clearOldRecordings(keep = null) {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(DIR, { create: true });
    for await (const name of dir.keys()) {
      if (name !== keep) await dir.removeEntry(name).catch(() => {});
    }
  } catch { /* no private storage here */ }
}

export class CallRecorder {
  constructor(audioCtx) {
    this.ctx = audioCtx;
    this.dest = audioCtx.createMediaStreamDestination();
    this.sources = new Map();
    this.canvas = document.createElement("canvas");
    this.W = 1920; this.H = 1080;
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.g = this.canvas.getContext("2d");
    this.startedAt = 0;
    this.drawnAt = 0;
    this.active = false;
    this.job = null; // { output, video, audio, disk, plan } or { rec, chunks, mime }
    this.planPromise = null; // worked out on the first recording (choosePlan)
    this.mime = ["video/mp4;codecs=avc1,mp4a", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
      .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
    this.supported = !!(this.canvas.captureStream && (HAS_CODECS || (window.MediaRecorder && this.mime)));
    if (document.fonts && document.fonts.load) document.fonts.load(`500 24px ${FONT}`).catch(() => {});
  }

  addAudio(id, stream) {
    if (this.sources.has(id) || !stream.getAudioTracks().length) return;
    try {
      const src = this.ctx.createMediaStreamSource(stream);
      src.connect(this.dest);
      this.sources.set(id, src);
    } catch { /* stream without audio */ }
  }

  removeAudio(id) {
    const s = this.sources.get(id);
    if (s) { try { s.disconnect(); } catch { /* gone */ } this.sources.delete(id); }
  }

  get recording() { return this.active; }

  // what the file is made with, for the save dialog and tests
  get kind() { return this.job ? (this.job.plan ? `${this.job.plan.format} ${this.job.plan.video}` : "mediarecorder") : null; }

  async start() {
    if (!this.supported || this.active) return false;
    this.active = true;
    if (!this.planPromise) this.planPromise = choosePlan();
    const plan = await this.planPromise;
    try {
      if (plan) await this.startEncoded(plan);
      else this.startBuiltIn();
    } catch (e) {
      console.warn("recording couldn't start", e);
      this.active = false; this.job = null;
      return false;
    }
    this.startedAt = performance.now();
    return true;
  }

  async startEncoded(plan) {
    const { Output, Mp4OutputFormat, WebMOutputFormat, StreamTarget, BufferTarget, MediaStreamVideoTrackSource, MediaStreamAudioTrackSource, Quality } = await loadLib();
    this.setSize(plan.W, plan.H);
    this.paint([]); // the video track needs a first frame
    const name = `rec-${Date.now()}.${plan.format}`;
    await clearOldRecordings();
    const disk = await openDiskFile(name);
    const target = disk ? new StreamTarget(disk.writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }) : new BufferTarget();
    // metadata at the end: written once, at the finish, so nothing has to be held back in memory
    const format = plan.format === "mp4" ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat();
    const output = new Output({ format, target });
    const vtrack = this.canvas.captureStream(FPS).getVideoTracks()[0];
    const video = new MediaStreamVideoTrackSource(vtrack, {
      codec: plan.video, quality: plan.quality, keyFrameInterval: 4, latencyMode: plan.latency, contentHint: "detail",
    });
    output.addVideoTrack(video, { frameRate: FPS });
    const atrack = this.dest.stream.getAudioTracks()[0];
    const audio = new MediaStreamAudioTrackSource(atrack, { codec: plan.audio, quality: new Quality({ bitrate: 96_000 }) });
    output.addAudioTrack(audio);
    await output.start();
    this.job = { output, video, audio, vtrack, disk, plan, name, failed: null };
    for (const s of [video, audio]) s.errorPromise.catch((e) => { if (this.job) this.job.failed = e; console.warn("recording problem", e); });
  }

  startBuiltIn() {
    const stream = this.canvas.captureStream(FPS);
    this.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 2_500_000 });
    const job = { rec, chunks: [], mime: this.mime };
    rec.ondataavailable = (e) => { if (e.data && e.data.size) job.chunks.push(e.data); };
    rec.start(1000);
    this.job = job;
  }

  // resolves with the finished file (a Blob backed by the file on disk where possible), or null
  async stop() {
    if (!this.active) return null;
    this.active = false;
    const job = this.job;
    this.job = null;
    if (!job) return null;
    if (job.rec) {
      return new Promise((resolve) => {
        job.rec.onstop = () => resolve(new Blob(job.chunks, { type: job.mime.split(";")[0] }));
        try { job.rec.stop(); } catch { resolve(null); }
      });
    }
    const type = job.plan.format === "mp4" ? "video/mp4" : "video/webm";
    try {
      await job.output.finalize();
    } catch (e) {
      console.warn("recording couldn't be finished", e);
      try { await job.output.cancel(); } catch { /* already gone */ }
      return null;
    } finally {
      job.vtrack.stop();
    }
    if (job.disk) {
      const file = await job.disk.handle.getFile();
      // a Blob over the file on disk: saving it streams from disk, nothing is copied into memory
      return new Blob([file], { type });
    }
    return new Blob([job.output.target.buffer], { type });
  }

  setSize(W, H) {
    this.W = W; this.H = H;
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
  }

  // tiles: [{ source: video|canvas|null, name, initial, big, contain, speaking, micOff }]. Drawn at up to
  // 30 frames a second. A "big" tile (a shared screen) fills most of the frame, with people beside it.
  frame(tiles, now = performance.now()) {
    if (!this.active || !this.job) return;
    if (now - this.drawnAt < 1000 / FPS - 2) return;
    this.drawnAt = now;
    this.paint(tiles);
  }

  // where each tile goes, in pixels: [[tile, x, y, w, h], ...]
  layout(tiles) {
    const { W, H } = this;
    const pad = Math.round(H * 0.035), gap = Math.round(H * 0.018);
    const big = tiles.find((t) => t.big);
    const rest = tiles.filter((t) => t !== big);
    const boxes = [];
    if (big) {
      const colW = rest.length ? Math.round(W * 0.2) : 0;
      boxes.push([big, pad, pad, W - pad * 2 - (colW ? colW + gap : 0), H - pad * 2]);
      const ch = Math.round(colW * 9 / 16);
      const n = Math.min(rest.length, Math.floor((H - pad * 2 + gap) / (ch + gap)));
      const y0 = Math.round((H - (n * ch + (n - 1) * gap)) / 2);
      rest.slice(0, n).forEach((t, i) => boxes.push([t, W - pad - colW, y0 + i * (ch + gap), colW, ch]));
      return boxes;
    }
    const n = Math.max(1, rest.length);
    const cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    // tiles are 16:9 when they fit, and up to 4:3 to fill the frame (two people side by side would
    // otherwise sit in a thin strip); the picture is cropped a little at the sides, never squashed
    let cw = (W - pad * 2 - gap * (cols - 1)) / cols;
    const maxH = (H - pad * 2 - gap * (rows - 1)) / rows;
    let ch = Math.min(maxH, cw * 3 / 4);
    if (ch < cw * 9 / 16) cw = ch * 16 / 9;
    cw = Math.round(cw); ch = Math.round(ch);
    const y0 = Math.round((H - (rows * ch + (rows - 1) * gap)) / 2);
    rest.forEach((t, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const inRow = r === rows - 1 ? n - r * cols : cols;
      const rowW = inRow * cw + (inRow - 1) * gap;
      boxes.push([t, Math.round((W - rowW) / 2) + c * (cw + gap), y0 + r * (ch + gap), cw, ch]);
    });
    return boxes;
  }

  paint(tiles) {
    const g = this.g, { W, H } = this;
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    g.imageSmoothingQuality = "high";
    for (const [t, x, y, w, h] of this.layout(tiles)) this.tile(t, x, y, w, h);
  }

  tile(t, x, y, w, h) {
    const g = this.g;
    const r = Math.max(10, Math.min(24, Math.min(w, h) * 0.05));
    g.save();
    g.beginPath(); g.roundRect(x, y, w, h, r); g.clip();
    g.fillStyle = t.contain ? C.screen : C.video;
    g.fillRect(x, y, w, h);
    const src = t.source;
    const sw = src ? src.videoWidth || src.width : 0, sh = src ? src.videoHeight || src.height : 0;
    if (sw && sh) {
      const sc = t.contain ? Math.min(w / sw, h / sh) : Math.max(w / sw, h / sh);
      const dw = sw * sc, dh = sh * sc;
      g.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      // no picture from them (yet): their initial, like the call screen
      const d = Math.min(h * 0.38, 150);
      g.fillStyle = C.avatar;
      g.beginPath(); g.arc(x + w / 2, y + h / 2, d / 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = C.text; g.font = `600 ${Math.round(d * 0.42)}px ${FONT}`;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(t.initial || "?", x + w / 2, y + h / 2 + d * 0.02);
      g.textAlign = "start";
    }
    // a hairline edge, and the brass ring while they speak
    g.lineWidth = 2; g.strokeStyle = C.hair;
    g.beginPath(); g.roundRect(x + 1, y + 1, w - 2, h - 2, r - 1); g.stroke();
    if (t.speaking) {
      const lw = Math.max(3, Math.round(this.H / 300));
      g.lineWidth = lw; g.strokeStyle = C.brass;
      g.beginPath(); g.roundRect(x + lw / 2, y + lw / 2, w - lw, h - lw, r - lw / 2); g.stroke();
    }
    g.restore();
    if (t.name) this.label(t, x, y, w, h);
  }

  // the name in a dark rounded label at the bottom left, vertically centred on the text's capitals
  label(t, x, y, w, h) {
    const g = this.g;
    const fs = Math.round(Math.max(this.H / 60, Math.min(this.H / 40, h * 0.07)));
    g.font = `500 ${fs}px ${FONT}`;
    g.textBaseline = "alphabetic";
    const cap = g.measureText("H").actualBoundingBoxAscent || fs * 0.7;
    const padX = Math.round(fs * 0.62), padY = Math.round(fs * 0.42), inset = Math.round(fs * 0.7);
    const icon = t.micOff && MIC_OFF ? Math.round(fs * 1.05) : 0;
    const iconGap = icon ? Math.round(fs * 0.35) : 0;
    const maxText = w - inset * 2 - padX * 2 - icon - iconGap;
    let name = t.name;
    while (name.length > 1 && g.measureText(name).width > maxText) name = name.slice(0, -2) + "…";
    const tw = g.measureText(name).width;
    const lh = Math.round(cap + padY * 2 + fs * 0.32);
    const lx = x + inset, ly = y + h - inset - lh;
    g.fillStyle = C.label;
    g.beginPath(); g.roundRect(lx, ly, padX * 2 + icon + iconGap + tw, lh, Math.round(lh * 0.3)); g.fill();
    const cy = ly + lh / 2;
    if (icon) {
      g.save();
      g.translate(lx + padX, cy - icon / 2);
      g.scale(icon / 24, icon / 24);
      g.strokeStyle = C.muted; g.lineWidth = 2; g.lineCap = "round";
      g.stroke(MIC_OFF);
      g.restore();
    }
    g.fillStyle = C.text;
    g.fillText(name, lx + padX + icon + iconGap, Math.round(cy + cap / 2));
  }
}
