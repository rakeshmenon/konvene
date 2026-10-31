// On-device vision: person segmentation (for background effects) and face landmarks
// (for face stickers, lighting position and expression effects). Loaded only when needed.
import { FilesetResolver, FaceLandmarker, ImageSegmenter } from "@mediapipe/tasks-vision";

const WASM = new URL("/vendor/mediapipe/wasm", location.href).href;
const FACE_MODEL = new URL("/models/face_landmarker.task", location.href).href;
// Person cutout: Google's multiclass selfie model (knows hair, skin, clothes vs background, so it
// rarely mistakes a poster or furniture for you). If a computer is too slow for it, we switch to the
// small landscape model, which is about 60 times smaller and much faster.
const SEG_MODELS = {
  multi: new URL("/models/selfie_multiclass_256x256.tflite", location.href).href,
  land: new URL("/models/selfie_segmenter_landscape.tflite", location.href).href,
};
const SLOW_MS = 30; // average segmentation time above which we switch to the fast model
// The segmenter sees a small copy of the frame, so its mask comes back small and cheap to clean up.
const SEG_W = 320;

let filesetPromise = null;
function fileset() {
  if (!filesetPromise) filesetPromise = FilesetResolver.forVisionTasks(WASM);
  return filesetPromise;
}

async function create(Kind, opts) {
  const fs = await fileset();
  try { return await Kind.createFromOptions(fs, { ...opts, baseOptions: { ...opts.baseOptions, delegate: "GPU" } }); }
  catch { return await Kind.createFromOptions(fs, { ...opts, baseOptions: { ...opts.baseOptions, delegate: "CPU" } }); }
}

export class Vision {
  constructor(opts = {}) {
    this.segModel = opts.segModel || null; // a fixed model path (tests)
    this.segKind = opts.segKind || "multi"; // "multi" or "land"
    this.segAuto = !opts.segModel && !opts.segKind; // allow falling back to the fast model
    this.segMs = 0; this.segFrames = 0;
    this.segW = opts.segW || SEG_W;
    this.segCanvas = document.createElement("canvas");
    this.segCtx = this.segCanvas.getContext("2d", { alpha: false });
    this.face = null;
    this.seg = null;
    this.loadingFace = null;
    this.loadingSeg = null;
    this.lastFace = null;
    this.lastTs = 0;
  }

  needFace() {
    if (!this.loadingFace) {
      this.loadingFace = create(FaceLandmarker, {
        baseOptions: { modelAssetPath: FACE_MODEL },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
      }).then((f) => { this.face = f; }).catch((e) => console.warn("face tracking unavailable", e));
    }
    return this.loadingFace;
  }

  loadSeg(path) {
    return create(ImageSegmenter, {
      baseOptions: { modelAssetPath: path },
      runningMode: "VIDEO",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  }

  needSeg() {
    if (!this.loadingSeg) {
      const first = this.segModel || SEG_MODELS[this.segKind];
      this.loadingSeg = this.loadSeg(first)
        .catch((e) => {
          if (this.segModel || this.segKind === "land") throw e;
          console.warn("multiclass segmenter unavailable, using the fast one", e);
          this.segKind = "land";
          return this.loadSeg(SEG_MODELS.land);
        })
        .then((s) => { this.seg = s; this.segMs = 0; this.segFrames = 0; })
        .catch((e) => console.warn("segmentation unavailable", e));
    }
    return this.loadingSeg;
  }

  // too slow on this computer: load the fast model, keep using the current one until it's ready
  fallBack() {
    if (this.switching || this.segKind === "land") return;
    this.switching = true;
    console.info(`person cutout: ${this.segMs.toFixed(1)} ms per frame, switching to the fast model`);
    this.loadSeg(SEG_MODELS.land).then((s) => {
      const old = this.seg;
      this.seg = s; this.segKind = "land"; this.segMs = 0; this.segFrames = 0; this.slowHits = 0; this.switching = false;
      try { old.close(); } catch { /* already gone */ }
    }).catch((e) => { console.warn("fast segmenter unavailable", e); this.switching = false; this.segAuto = false; });
  }

  // returns { mask: {data,w,h} | null, face: {landmarks, shapes} | null }
  run(video, now, { wantFace, wantSeg }) {
    const ts = Math.max(now, this.lastTs + 1);
    this.lastTs = ts;
    const out = { mask: null, face: null };
    if (wantSeg && this.seg && !this.switching) { // while switching models, the last mask stays
      try {
        const vw = video.videoWidth || video.naturalWidth || video.width, vh = video.videoHeight || video.naturalHeight || video.height;
        const sw = this.segW, sh = Math.max(2, Math.round((sw * vh) / vw));
        const c = this.segCanvas;
        if (c.width !== sw || c.height !== sh) { c.width = sw; c.height = sh; }
        this.segCtx.drawImage(video, 0, 0, sw, sh);
        const t0 = performance.now();
        this.seg.segmentForVideo(c, ts, (r) => {
          const ms = r.confidenceMasks;
          if (!ms || !ms.length) return;
          const m = ms[0];
          if (ms.length > 1) {
            // multiclass model: class 0 is background, so "you" is everything else
            const bg = m.getAsFloat32Array(), d = new Float32Array(bg.length);
            for (let i = 0; i < bg.length; i++) d[i] = 1 - bg[i];
            out.mask = { data: d, w: m.width, h: m.height };
          } else out.mask = { data: new Float32Array(m.getAsFloat32Array()), w: m.width, h: m.height };
        });
        // time it (the first frames include warm-up). Switch quickly if this computer struggles:
        // two very slow frames, or a slow average over a couple of seconds.
        const dt = performance.now() - t0;
        this.segFrames++;
        if (this.segFrames <= 10) { if (this.segAuto && dt > 3000 && !document.hidden) this.fallBack(); } // warm-up: only give up if hopeless
        else {
          this.segMs = this.segMs ? this.segMs * 0.95 + dt * 0.05 : dt;
          this.slowHits = dt > 100 ? (this.slowHits || 0) + 1 : 0; // consecutive very slow frames
          if (this.segAuto && !document.hidden && (this.slowHits >= 5 || (this.segFrames > 90 && this.segMs > SLOW_MS))) this.fallBack();
        }
      } catch (e) { /* skip a frame */ }
    }
    if (wantFace && this.face) {
      try {
        const r = this.face.detectForVideo(video, ts + 0.5);
        if (r.faceLandmarks && r.faceLandmarks[0]) {
          const shapes = {};
          if (r.faceBlendshapes && r.faceBlendshapes[0]) for (const c of r.faceBlendshapes[0].categories) shapes[c.categoryName] = c.score;
          out.face = { landmarks: r.faceLandmarks[0], shapes };
          this.lastFace = out.face;
        } else {
          this.lastFace = null;
        }
      } catch (e) { /* skip a frame */ }
    }
    return out;
  }
}
