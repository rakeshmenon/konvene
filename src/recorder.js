// Records the call in this browser: everyone's video in a grid, with names, plus all voices.
// The file stays on this device until you save it.
export class CallRecorder {
  constructor(audioCtx) {
    this.ctx = audioCtx;
    this.dest = audioCtx.createMediaStreamDestination();
    this.sources = new Map();
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.g = this.canvas.getContext("2d");
    this.rec = null;
    this.chunks = [];
    this.startedAt = 0;
    this.mime = ["video/mp4;codecs=avc1,mp4a", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
      .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
    this.supported = !!(window.MediaRecorder && this.canvas.captureStream && this.mime);
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

  get recording() { return !!this.rec; }

  start() {
    if (!this.supported || this.rec) return false;
    this.chunks = [];
    const stream = this.canvas.captureStream(30);
    this.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    try { this.rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 3_000_000 }); }
    catch { this.rec = null; return false; }
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000);
    this.startedAt = performance.now();
    return true;
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.rec) return resolve(null);
      const r = this.rec;
      this.rec = null;
      r.onstop = () => resolve(new Blob(this.chunks, { type: this.mime.split(";")[0] }));
      try { r.stop(); } catch { resolve(null); }
    });
  }

  // tiles: [{ source: video|canvas, name, mirror, big, contain }]. A "big" tile (a shared screen)
  // fills most of the frame with everyone else in a column beside it.
  frame(tiles) {
    if (!this.rec) return;
    const g = this.g, W = 1280, H = 720;
    g.fillStyle = "#221a15"; g.fillRect(0, 0, W, H);
    const gap = 10, pad = 14;
    const big = tiles.find((t) => t.big);
    const rest = tiles.filter((t) => t !== big);
    const boxes = [];
    if (big) {
      const colW = rest.length ? 240 : 0;
      boxes.push([big, pad, pad, W - pad * 2 - (colW ? colW + gap : 0), H - pad * 2]);
      const ch = colW * 9 / 16;
      const n = Math.min(rest.length, Math.floor((H - pad * 2 + gap) / (ch + gap)));
      const y0 = (H - (n * ch + (n - 1) * gap)) / 2;
      rest.slice(0, n).forEach((t, i) => boxes.push([t, W - pad - colW, y0 + i * (ch + gap), colW, ch]));
    } else {
      const n = Math.max(1, rest.length);
      const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
      const rows = Math.ceil(n / cols);
      const cw = (W - pad * 2 - gap * (cols - 1)) / cols;
      const ch = Math.min((H - pad * 2 - gap * (rows - 1)) / rows, cw * 9 / 16);
      const y0 = (H - (rows * ch + (rows - 1) * gap)) / 2;
      rest.forEach((t, i) => {
        const r = Math.floor(i / cols), c = i % cols;
        const inRow = r === rows - 1 ? n - r * cols : cols;
        const rowW = inRow * cw + (inRow - 1) * gap;
        boxes.push([t, (W - rowW) / 2 + c * (cw + gap), y0 + r * (ch + gap), cw, ch]);
      });
    }
    for (const [t, x, y, cw, ch] of boxes) {
      g.save();
      g.beginPath(); g.roundRect(x, y, cw, ch, 12); g.clip();
      g.fillStyle = "#2c231d"; g.fillRect(x, y, cw, ch);
      const src = t.source;
      const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
      if (sw && sh) {
        const sc = t.contain ? Math.min(cw / sw, ch / sh) : Math.max(cw / sw, ch / sh);
        const dw = sw * sc, dh = sh * sc;
        if (t.mirror) { g.translate(x + cw, y); g.scale(-1, 1); g.drawImage(src, (cw - dw) / 2, (ch - dh) / 2, dw, dh); }
        else g.drawImage(src, x + (cw - dw) / 2, y + (ch - dh) / 2, dw, dh);
      }
      g.restore();
      const fs = ch < 200 ? 13 : 16;
      g.font = `500 ${fs}px Inter, system-ui, sans-serif`;
      const tw = g.measureText(t.name).width;
      g.fillStyle = "rgba(20,20,22,0.6)"; g.beginPath(); g.roundRect(x + 8, y + ch - fs - 18, tw + 18, fs + 10, 7); g.fill();
      g.fillStyle = "#fff"; g.textBaseline = "middle"; g.fillText(t.name, x + 17, y + ch - fs / 2 - 8);
    }
    const secs = Math.floor((performance.now() - this.startedAt) / 1000);
    g.fillStyle = "#e5484d"; g.beginPath(); g.arc(30, 30, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff"; g.font = "600 17px Inter, system-ui, sans-serif"; g.textBaseline = "middle";
    g.fillText(`REC ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, 46, 31);
  }
}
