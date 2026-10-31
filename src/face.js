// Face effects from MediaPipe's 478 face landmarks: touch-up, makeup and fun warps.
// Everything here runs on this device. The landmarks only say where parts of the face are;
// nothing identifies who you are.

export const LIPS = {
  none: { label: "None" },
  nude: { label: "Nude", c: [0.74, 0.47, 0.41] },
  rose: { label: "Rose", c: [0.82, 0.37, 0.46] },
  coral: { label: "Coral", c: [0.95, 0.44, 0.36] },
  berry: { label: "Berry", c: [0.56, 0.14, 0.3] },
  red: { label: "Red", c: [0.8, 0.07, 0.12] },
};

export const BLUSH = {
  none: { label: "None" },
  peach: { label: "Peach", c: [1.0, 0.64, 0.52] },
  rose: { label: "Rose", c: [0.98, 0.55, 0.62] },
  bronze: { label: "Bronze", c: [0.84, 0.56, 0.4] },
};

// fun warps (ids match the shader in fx.js)
export const WARPS = {
  none: { label: "None", id: 0 },
  "big-eyes": { label: "Big eyes", id: 1 },
  tiny: { label: "Tiny face", id: 2 },
  bobble: { label: "Bobblehead", id: 3 },
  alien: { label: "Alien", id: 4 },
  squish: { label: "Squish", id: 5 },
  long: { label: "Long face", id: 6 },
};

export const FACE_DEFAULTS = { touchup: 0, eyeBright: 0, teeth: 0, slim: 0, eyeBig: 0, lips: "none", blush: "none", makeup: 0.6, warp: "none" };
export const FACE_KEYS = Object.keys(FACE_DEFAULTS);

// effects that need the face tracker (smoothing alone works without a face, on the whole picture)
export function faceFxOn(s) {
  return s.touchup > 0 || s.eyeBright > 0 || s.teeth > 0 || s.slim > 0 || s.eyeBig > 0 || (s.lips && s.lips !== "none") || (s.blush && s.blush !== "none") || (s.warp && s.warp !== "none");
}

// MediaPipe face mesh contours
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const LIPS_OUT = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const LIPS_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
const EYE_R = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const EYE_L = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const BROW_R = [46, 53, 52, 65, 55, 107, 66, 105, 63, 70];
const BROW_L = [276, 283, 282, 295, 285, 336, 296, 334, 293, 300];
const NOSE_HOLES = [[60, 75, 59, 166, 79, 239, 238, 20], [290, 305, 289, 392, 309, 459, 458, 250]];

const MASK = 256;

export class FaceGeo {
  constructor() {
    this.pts = null; // smoothed landmarks, x,y pairs (0..1 of the frame)
    this.version = 0;
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = MASK;
    this.g = this.canvas.getContext("2d");
    this.skinC = document.createElement("canvas");
    this.mouthC = document.createElement("canvas");
    this.skinC.width = this.skinC.height = this.mouthC.width = this.mouthC.height = MASK;
    this.canFilter = "filter" in this.g;
  }

  reset() { this.pts = null; }

  // lm: landmarks for one face; asp: frame width / height
  update(lm, asp) {
    const n = lm.length;
    if (!this.pts || this.pts.length !== n * 2) {
      this.pts = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { this.pts[i * 2] = lm[i].x; this.pts[i * 2 + 1] = lm[i].y; }
    } else {
      // calm when still, quick when moving: no shimmer on makeup, no lag on turns
      const p = this.pts;
      const dx = (lm[1].x - p[2]) * asp, dy = lm[1].y - p[3];
      const a = Math.min(1, 0.35 + Math.hypot(dx, dy) * 45);
      for (let i = 0; i < n; i++) { p[i * 2] += (lm[i].x - p[i * 2]) * a; p[i * 2 + 1] += (lm[i].y - p[i * 2 + 1]) * a; }
    }
    this.asp = asp;
    this.measure();
    this.drawMasks();
    this.version++;
  }

  P(i) { return [this.pts[i * 2], this.pts[i * 2 + 1]]; }
  // distance in "aspect space", where x is scaled so both axes use the same unit
  dist(i, j) { const a = this.P(i), b = this.P(j); return Math.hypot((a[0] - b[0]) * this.asp, a[1] - b[1]); }
  mid(...ids) { let x = 0, y = 0; for (const i of ids) { x += this.pts[i * 2]; y += this.pts[i * 2 + 1]; } return [x / ids.length, y / ids.length]; }

  measure() {
    const asp = this.asp;
    const a = this.P(234), b = this.P(454);
    this.roll = Math.atan2(b[1] - a[1], (b[0] - a[0]) * asp);
    this.faceW = this.dist(234, 454);
    this.faceH = this.dist(10, 152);
    this.center = this.mid(234, 454, 10, 152);
    // eyes: centre, half width, half height
    const eye = (c1, c2, up, down) => { const c = this.mid(c1, c2, up, down); return [c[0], c[1], Math.max(0.004, this.dist(c1, c2) / 2), Math.max(0.002, this.dist(up, down) / 2)]; };
    this.eyeR = eye(33, 133, 159, 145);
    this.eyeL = eye(362, 263, 386, 374);
    const m = this.mid(13, 14);
    this.mouth = [m[0], m[1], this.dist(61, 291) / 2];
    const cr = this.faceW * 0.15;
    this.cheekR = [...this.mid(50, 117, 205), cr];
    this.cheekL = [...this.mid(280, 346, 425), cr];
    // mask box around the face, a little larger than the face outline
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const i of OVAL) { const [x, y] = this.P(i); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const px = (x1 - x0) * 0.12, py = (y1 - y0) * 0.12;
    this.box = [x0 - px, y0 - py, x1 - x0 + 2 * px, y1 - y0 + 2 * py];
  }

  // skin (red), lips (green) and the inside of the mouth (blue), soft-edged, in the face box
  drawMasks() {
    const [bx, by, bw, bh] = this.box;
    const path = (g, ids) => {
      g.beginPath();
      ids.forEach((i, k) => { const x = ((this.pts[i * 2] - bx) / bw) * MASK, y = ((this.pts[i * 2 + 1] - by) / bh) * MASK; if (k) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath();
    };
    const line = Math.max(1.5, MASK * 0.012);
    const s = this.skinC.getContext("2d");
    s.globalCompositeOperation = "source-over";
    s.clearRect(0, 0, MASK, MASK);
    s.fillStyle = "#f00"; path(s, OVAL); s.fill();
    s.globalCompositeOperation = "destination-out";
    s.fillStyle = s.strokeStyle = "#000"; s.lineJoin = "round";
    for (const part of [EYE_R, EYE_L, BROW_R, BROW_L, LIPS_OUT, ...NOSE_HOLES]) { path(s, part); s.fill(); s.lineWidth = part === BROW_R || part === BROW_L ? line * 2.2 : line * 1.6; s.stroke(); }
    const m = this.mouthC.getContext("2d");
    m.clearRect(0, 0, MASK, MASK);
    m.fillStyle = "#0f0"; path(m, LIPS_OUT); m.fill();
    m.fillStyle = "#00f"; path(m, LIPS_IN); m.fill();
    const g = this.g;
    g.globalCompositeOperation = "source-over";
    g.filter = "none";
    g.fillStyle = "#000"; g.fillRect(0, 0, MASK, MASK);
    g.globalCompositeOperation = "lighter";
    if (this.canFilter) g.filter = `blur(${(MASK * 0.014).toFixed(1)}px)`;
    g.drawImage(this.skinC, 0, 0);
    if (this.canFilter) g.filter = `blur(${(MASK * 0.005).toFixed(1)}px)`;
    g.drawImage(this.mouthC, 0, 0);
    g.filter = "none";
    g.globalCompositeOperation = "source-over";
  }
}
