// Your camera, processed on this device: camera -> vision -> effects -> stickers -> outgoing stream.
import { Fx } from "./fx.js";
import { Vision } from "./vision.js";
import { Overlay } from "./stickers.js";
import { drawBackground } from "./backgrounds.js";
import { MatteCleaner } from "./matte.js";
import { FaceGeo, FACE_DEFAULTS, FACE_KEYS, faceFxOn } from "./face.js";


export class Pipeline {
  constructor() {
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.out = document.createElement("canvas");
    this.W = 800; this.H = 450;
    this.out.width = this.W; this.out.height = this.H;
    this.g = this.out.getContext("2d");
    this.fx = null;
    // ?seg=land or ?seg=multi pins the cutout model (for testing); otherwise it picks by speed
    const seg = new URLSearchParams(location.search).get("seg");
    this.vision = new Vision(seg === "land" || seg === "multi" ? { segKind: seg } : {});
    this.matte = new MatteCleaner();
    this.faceGeo = new FaceGeo();
    this.overlay = new Overlay();
    this.settings = {
      bg: "none", look: "natural", light: "off", brightness: 0, sticker: "none", expressions: false,
      ...FACE_DEFAULTS, // touch-up, makeup and fun warps (face.js)
      // smart features, all worked out on this device
      autoAway: true, // no face for a while: show "stepped away" instead of your video
      autoFrame: false, // gently zoom and follow your face
      autoLight: true, // brighten a dark room
      mutedHint: true, // tell you when you talk while muted (handled in main.js)
    };
    this.away = false; this.onAway = null;
    this.lastFaceAt = 0; this.faceSince = 0;
    this.crop = { x: 0, y: 0, w: 1 };
    this.lumaCanvas = document.createElement("canvas"); this.lumaCanvas.width = 32; this.lumaCanvas.height = 18;
    this.lumaCtx = this.lumaCanvas.getContext("2d", { willReadFrequently: true });
    this.lastLumaAt = 0; this.gain = 1;
    this.camOn = false;
    this.camStream = null;
    this.micStream = null;
    this.stream = null; // what peers receive: processed video + mic
    this.last = 0;
    this.frameMs = 1000 / 30;
    this.onFace = null;
    this.running = false;
    this.bgImageKey = null;
  }

  static camConstraints(id) {
    // ask for full HD; most laptop cameras give 1280x720 or 1920x1080
    const v = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
    if (id) v.deviceId = { exact: id }; else v.facingMode = "user";
    return { video: v, audio: false };
  }

  static micConstraints(id) {
    const a = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (id) a.deviceId = { exact: id };
    return { audio: a, video: false };
  }

  // Nothing is opened here: camera and microphone stay off until you turn them on (or join).
  async start() {
    this.micOn = false;
    this.camOn = false;
    this.resize(1280, 720);
    this.stream = this.out.captureStream(30);
    this.applySettings(this.settings);
    this.running = true;
    const tick = (now) => {
      if (!this.running) return;
      requestAnimationFrame(tick);
      const before = this.last, t0 = performance.now();
      this.frame(now);
      if (this.last !== before) this.watchSpeed(performance.now() - t0);
    };
    requestAnimationFrame(tick);
    // keep frames flowing to peers even when this tab is in the background
    this.bgTimer = setInterval(() => { if (document.hidden) this.frame(performance.now()); }, 66);
  }

  // A computer that can't keep up at full HD gets a smaller picture instead of a stuttering one:
  // if frames take longer than a 30 fps budget for a few seconds, step down to 1280, then 960 wide.
  watchSpeed(ms) {
    if (!this.camOn || this.away || this.W <= 960) { this.speed = null; return; }
    const now = performance.now();
    const sp = this.speed || (this.speed = { n: 0, sum: 0, from: now });
    sp.n++;
    if (sp.n <= 45) { sp.from = now; return; } // let the models warm up first
    sp.sum += ms;
    const m = sp.n - 45;
    // decide after 45 frames, or after 4 seconds on a computer that's far too slow for that
    if (m < 45 && !(now - sp.from > 4000 && m >= 8)) return;
    const avg = sp.sum / m;
    this.speed = null;
    if (avg > 34) {
      this.maxW = this.W > 1280 ? 1280 : 960;
      console.info(`video: ${avg.toFixed(0)} ms per frame at ${this.W} wide, using ${this.maxW}`);
      this.resize(this.video.videoWidth, this.video.videoHeight);
    }
  }

  // the processed picture is as sharp as the camera allows, up to 1920 wide (full HD)
  resize(w, h) {
    const W = Math.min(this.maxW || 1920, Math.round(w / 2) * 2), H = Math.round((W * h) / w / 2) * 2;
    if (W === this.W && H === this.H && this.fx) return;
    this.W = W; this.H = H;
    this.out.width = W; this.out.height = H;
    try { this.fx = new Fx(W, H); } catch (e) { this.fx = null; console.warn(e); }
    this.thumbFx = null; this.bgImageKey = null;
    this.applySettings({});
  }

  static async get(make, id) {
    try { return await navigator.mediaDevices.getUserMedia(make(id)); }
    catch (e) { if (id && e.name !== "NotAllowedError") return navigator.mediaDevices.getUserMedia(make()); throw e; }
  }

  // open (or switch) the camera; the outgoing video is our canvas, so peers need nothing new
  async openCamera(id) {
    const next = await Pipeline.get(Pipeline.camConstraints, id);
    const old = this.camStream;
    this.camStream = next;
    this.video.srcObject = next;
    await this.video.play().catch(() => {});
    if (old) old.getTracks().forEach((t) => t.stop());
    if (this.video.videoWidth) this.resize(this.video.videoWidth, this.video.videoHeight);
    this.camError = null;
  }

  // camera off means the camera is really off (its light goes out), not just hidden
  closeCamera() {
    if (this.camStream) this.camStream.getTracks().forEach((t) => t.stop());
    this.camStream = null;
    this.video.srcObject = null;
    this.camOn = false;
  }

  async setCam(on, id) {
    if (on) {
      if (!this.camStream) await this.openCamera(id);
      this.camOn = true;
    } else this.closeCamera();
  }

  // open (or switch) the microphone. Peers get a copy of its track, so muting silences what they
  // hear while we can still notice you talking (for the "you're muted" reminder).
  async openMic(id) {
    const next = await Pipeline.get(Pipeline.micConstraints, id);
    const old = this.micStream;
    const oldTrack = this.sendTrack;
    const newTrack = next.getAudioTracks()[0].clone();
    newTrack.enabled = this.micOn;
    if (oldTrack) this.stream.removeTrack(oldTrack);
    this.stream.addTrack(newTrack);
    this.micStream = next;
    this.sendTrack = newTrack;
    return { oldTrack, newTrack, stop: () => { if (old) old.getTracks().forEach((t) => t.stop()); if (oldTrack) oldTrack.stop(); } };
  }

  applySettings(s) {
    Object.assign(this.settings, s);
    const st = this.settings;
    if (this.fx) Object.assign(this.fx.settings, Pipeline.fxSettings(st));
    if (st.bg !== "none") this.vision.needSeg();
    // face position also tells the background cutout which region is you
    if (st.sticker !== "none" || st.expressions || st.light !== "off" || st.bg !== "none" || faceFxOn(st)) this.vision.needFace();
    if (this.fx && st.bg !== "none" && !st.bg.startsWith("blur") && st.bg !== this.bgImageKey) {
      this.bgImageKey = st.bg;
      const src = st.bg === "upload" && this.uploaded ? this.uploaded : drawBackground(st.bg, 1280, 720);
      if (src) this.fx.setImage(src);
    }
  }

  static fxSettings(st) {
    const o = { bg: st.bg, look: st.look, light: st.light, brightness: st.brightness };
    for (const k of FACE_KEYS) o[k] = st[k];
    return o;
  }

  setUpload(img) {
    this.uploaded = img;
    this.bgImageKey = null;
    this.applySettings({ bg: "upload" });
  }

  setMic(on) { this.micOn = on; if (this.sendTrack) this.sendTrack.enabled = on; }

  get camId() { const t = this.camStream && this.camStream.getVideoTracks()[0]; return t ? t.getSettings().deviceId : null; }
  get micId() { const t = this.micStream && this.micStream.getAudioTracks()[0]; return t ? t.getSettings().deviceId : null; }

  react(ch) { this.overlay.react(ch, this.W, this.H); }

  frame(now) {
    if (now - this.last < this.frameMs - 2) return;
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    const g = this.g;
    const s = this.settings;
    const W = this.W, H = this.H;
    const camLive = this.camOn && this.camStream && this.video.readyState >= 2;
    let face = null;
    if (camLive) {
      const wantSeg = (s.bg !== "none" || this.forceSeg) && !this.away;
      if (this.forceSeg) this.vision.needSeg();
      const faceFx = faceFxOn(s) || this.forceFace;
      const wantFace = s.sticker !== "none" || s.expressions || s.light !== "off" || wantSeg || s.autoAway || s.autoFrame || faceFx;
      if (wantFace) this.vision.needFace();
      const res = this.vision.run(this.video, now, { wantFace, wantSeg });
      face = res.face || (wantFace ? this.vision.lastFace : null);
      let facePt = null;
      if (face) {
        const lm = face.landmarks;
        facePt = [(lm[234].x + lm[454].x) / 2, (lm[10].y + lm[152].y) / 2];
        if (this.fx) this.fx.facePos = facePt;
        if (faceFx) this.faceGeo.update(lm, this.video.videoWidth / this.video.videoHeight);
      } else this.faceGeo.reset();
      if (this.fx) this.fx.setFace(face && faceFx ? this.faceGeo : null);
      this.trackAway(now, !!res.face, wantFace && !!this.vision.face);
      if (res.mask && this.fx) {
        // the multiclass model is sure about you and unsure about chairs, so half-sure areas must touch
        // sure ones; the fast model is never that sure, so it uses plain 50% instead
        this.matte.strong = this.vision.segKind === "multi" ? 0.92 : 0.5;
        this.fx.setMask(this.matte.process(res.mask.data, res.mask.w, res.mask.h, facePt), res.mask.w, res.mask.h);
      }
      if (!wantSeg && this.fx) this.fx.hasMask = false;
      this.trackLight(now);
    } else if (this.away) this.setAway(false);

    // the card is text, so the mirrored self view must not flip it (see makeLocalView)
    this.showingCard = !camLive || this.away;
    if (!camLive || this.away) {
      // camera off, or you stepped away: a calm card with your initial
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = "#13241e"; g.fillRect(0, 0, W, H);
      const r = Math.min(W, H) * 0.17;
      const cy = this.away ? H / 2 - r * 0.25 : H / 2;
      g.fillStyle = "#2b4a3f"; g.beginPath(); g.arc(W / 2, cy, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#fff"; g.font = `600 ${Math.round(r * 0.9)}px "Instrument Sans", system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText((this.name || "?").slice(0, 1).toUpperCase(), W / 2, cy + r * 0.04);
      if (this.away) {
        g.fillStyle = "rgba(255,255,255,0.75)"; g.font = `500 ${Math.round(H * 0.045)}px "Instrument Sans", system-ui, sans-serif`;
        g.fillText("Stepped away", W / 2, cy + r + H * 0.08);
      }
      this.overlay.draw(g, W, H, null, s, dt, now);
      return;
    }

    // keep you in frame: a slow, gentle digital zoom that follows your face
    const c = this.crop;
    let tw = 1, tx = 0, ty = 0;
    if (s.autoFrame && face) {
      const lm = face.landmarks;
      const fh = Math.abs(lm[152].y - lm[10].y);
      tw = Math.min(1, Math.max(0.6, fh / 0.34));
      const fx = (lm[234].x + lm[454].x) / 2, fy = (lm[10].y + lm[152].y) / 2;
      tx = Math.min(1 - tw, Math.max(0, fx - tw / 2));
      ty = Math.min(1 - tw, Math.max(0, fy - tw * 0.42));
    } else if (s.autoFrame && !face) { tw = c.w; tx = c.x; ty = c.y; }
    const k = Math.min(1, dt * 1.6);
    if (Math.abs(tw - c.w) > 0.02 || Math.abs(tx - c.x) > 0.02 || Math.abs(ty - c.y) > 0.02 || !s.autoFrame) {
      c.w += (tw - c.w) * k; c.x += (tx - c.x) * k; c.y += (ty - c.y) * k;
    }
    const src = this.fx ? this.fx.render(this.video) : null;
    const framed = c.w < 0.995;
    if (src) {
      if (framed) g.drawImage(src, c.x * W, c.y * H, c.w * W, c.w * H, 0, 0, W, H);
      else g.drawImage(src, 0, 0, W, H);
    } else {
      const vw = this.video.videoWidth, vh = this.video.videoHeight;
      const sc = Math.max(W / vw, H / vh);
      g.drawImage(this.video, (W - vw * sc) / 2, (H - vh * sc) / 2, vw * sc, vh * sc);
    }
    // stickers follow the same zoom
    if (framed) { const z = 1 / c.w; g.setTransform(z, 0, 0, z, -c.x * W * z, -c.y * H * z); }
    this.overlay.draw(g, W, H, face, s, dt, now);
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.onFace) this.onFace(!!face);
    this.thumbStep();
  }

  // no face for 8 seconds: you've stepped away. Back for a moment: you're back.
  trackAway(now, seen, tracking) {
    if (!this.settings.autoAway || !tracking) { this.lastFaceAt = now; if (this.away) this.setAway(false); return; }
    if (!this.lastFaceAt) this.lastFaceAt = now;
    if (seen) {
      this.lastFaceAt = now;
      if (!this.faceSince) this.faceSince = now;
      if (this.away && now - this.faceSince > 600) this.setAway(false);
    } else {
      this.faceSince = 0;
      if (!this.away && now - this.lastFaceAt > 8000) this.setAway(true);
    }
  }

  setAway(on) {
    if (this.away === on) return;
    this.away = on;
    if (this.onAway) this.onAway(on);
  }

  // a dark room: lift the exposure a little, once a second
  trackLight(now) {
    if (!this.fx) return;
    if (!this.settings.autoLight) { this.gain = 1; this.fx.gain = 1; return; }
    if (now - this.lastLumaAt > 1000) {
      this.lastLumaAt = now;
      try {
        this.lumaCtx.drawImage(this.video, 0, 0, 32, 18);
        const d = this.lumaCtx.getImageData(0, 0, 32, 18).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        const mean = sum / (d.length / 4) / 255;
        this.targetGain = Math.min(1.8, Math.max(1, Math.pow(0.42 / Math.max(mean, 0.05), 0.75)));
      } catch { this.targetGain = 1; }
    }
    this.gain += ((this.targetGain || 1) - this.gain) * 0.05;
    this.fx.gain = this.gain;
  }

  // Live previews: render the camera with other settings into small canvases. Every frame we
  // update as many as fit in a few milliseconds, taking turns, so they all stay smooth and the
  // main video never waits.
  queueThumbs(items) {
    this.thumbItems = items.slice();
    if (this.thumbIdx >= this.thumbItems.length) this.thumbIdx = 0;
  }

  thumbStep() {
    const items = this.thumbItems;
    if (!items || !items.length || !this.camOn || this.away || this.video.readyState < 2) return;
    if (!this.thumbFx) {
      try { this.thumbFx = new Fx(320, Math.round((320 * this.H) / this.W / 2) * 2); } catch { this.thumbItems = []; return; }
      this.thumbBg = {};
      this.thumbIdx = 0;
    }
    const tf = this.thumbFx;
    if (this.fx) tf.copyMaskFrom(this.fx);
    tf.gain = this.gain;
    const t0 = performance.now();
    let done = 0;
    while (done < items.length && (done === 0 || performance.now() - t0 < 5)) {
      const item = items[this.thumbIdx % items.length];
      this.thumbIdx = (this.thumbIdx + 1) % items.length;
      done++;
      if (!item.canvas.isConnected) continue;
      const st = { ...this.settings, ...item.patch };
      if (st.bg !== "none" || item.needSeg) this.vision.needSeg();
      if (st.bg !== "none" && !st.bg.startsWith("blur")) {
        if (!this.thumbBg[st.bg]) this.thumbBg[st.bg] = st.bg === "upload" ? this.uploaded : drawBackground(st.bg, 640, 360);
        const img = this.thumbBg[st.bg];
        if (img) tf.useImage(st.bg === "upload" ? "upload:" + (img.src || "") : st.bg, img);
      }
      Object.assign(tf.settings, Pipeline.fxSettings(st));
      tf.setFace(this.fx && this.fx.face);
      const src = tf.render(this.video, done > 1);
      const g = item.canvas.getContext("2d");
      const f = this.fx && this.fx.face;
      if (item.faceCrop) {
        // face options show a close-up of your face
        if (!f) continue;
        const side = Math.min(src.height, f.faceH * 1.75 * src.height);
        const cx = f.center[0] * src.width, cy = f.center[1] * src.height;
        const sx = Math.max(0, Math.min(src.width - side, cx - side / 2)), sy = Math.max(0, Math.min(src.height - side, cy - side / 2));
        g.drawImage(src, sx, sy, side, side, 0, 0, item.canvas.width, item.canvas.height);
      } else {
        if (item.canvas.width !== src.width) { item.canvas.width = src.width; item.canvas.height = src.height; }
        g.drawImage(src, 0, 0);
      }
      item.canvas.classList.add("live");
    }
  }

  stop() {
    this.running = false;
    clearInterval(this.bgTimer);
    for (const st of [this.camStream, this.micStream]) if (st) st.getTracks().forEach((t) => t.stop());
    if (this.sendTrack) this.sendTrack.stop();
  }
}
