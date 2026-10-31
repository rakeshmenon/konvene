// Cleans up the person mask before it reaches the GPU (runs on the small mask, about 320x180):
// 1. steadies it over time, following quickly where you move and holding still where you don't
// 2. keeps only the regions that are actually you (the one under your face, plus large body parts),
//    so a bright window or a poster the model mistook for a person is dropped
// 3. fills small holes inside you (a dark shirt patch the model missed)
// Half-sure areas only count as you if they sit right next to areas the model is sure about.
// A real edge fades from sure to unsure over a pixel or two; a chair headrest is a wide
// half-sure band, so it gets dropped.

const FOLLOW_LO = 0.06, FOLLOW_HI = 0.35; // per-pixel change that counts as real movement
const HOLD = 0.4; // how much of a still pixel's new value is taken each frame

export class MatteCleaner {
  constructor(opts = {}) {
    this.strong = opts.strong ?? 0.92; // "sure" confidence
    this.reach = opts.reach ?? 3; // how far (mask pixels) a half-sure area may extend from a sure one
    this.w = 0; this.h = 0;
    this.acc = null; this.labels = null; this.stack = null; this.out = null; this.keep = null; this.tmp = null;
    this.lastPt = null;
  }

  alloc(w, h) {
    const n = w * h;
    this.w = w; this.h = h;
    this.acc = new Float32Array(n);
    this.labels = new Int32Array(n);
    this.stack = new Int32Array(n);
    this.out = new Uint8Array(n);
    this.keep = new Uint8Array(n);
    this.tmp = new Uint8Array(n);
    this.list = new Int32Array(n);
    this.ok = new Uint8Array(n);
    this.ok2 = new Uint8Array(n);
    this.first = true;
  }

  // f32: person confidence 0..1 (w*h). facePt: [x, y] in 0..1 or null. Returns Uint8Array (w*h).
  process(f32, w, h, facePt) {
    if (w !== this.w || h !== this.h || !this.acc) this.alloc(w, h);
    const n = w * h, acc = this.acc;

    // 1. adaptive temporal smoothing
    if (this.first) { acc.set(f32); this.first = false; }
    else {
      for (let i = 0; i < n; i++) {
        const x = f32[i], d = Math.abs(x - acc[i]);
        let t = (d - FOLLOW_LO) / (FOLLOW_HI - FOLLOW_LO);
        t = t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
        const a = HOLD + (1 - HOLD) * t;
        acc[i] += (x - acc[i]) * a;
      }
    }

    // 2. person pixels: at least half sure, and within reach of a sure pixel
    let ok = this.ok, ok2 = this.ok2;
    for (let i = 0; i < n; i++) ok[i] = acc[i] >= this.strong ? 1 : 0;
    for (let r = 0; r < this.reach; r++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          ok2[p] = ok[p] || (x > 0 && ok[p - 1]) || (x < w - 1 && ok[p + 1]) || (y > 0 && ok[p - w]) || (y < h - 1 && ok[p + w]) ? 1 : 0;
        }
      }
      const t = ok; ok = ok2; ok2 = t;
    }
    for (let i = 0; i < n; i++) ok[i] = ok[i] && acc[i] >= 0.5 ? 1 : 0;

    // connected regions of person pixels (4-connected)
    const labels = this.labels, stack = this.stack;
    labels.fill(0);
    const comps = [null];
    for (let s = 0; s < n; s++) {
      if (labels[s] || !ok[s]) continue;
      const id = comps.length;
      let sp = 0, area = 0, bottom = false, sx = 0, sy = 0;
      stack[sp++] = s; labels[s] = id;
      while (sp) {
        const p = stack[--sp];
        const x = p % w, y = (p - x) / w;
        area++; sx += x; sy += y;
        if (y === h - 1) bottom = true;
        if (x > 0 && !labels[p - 1] && ok[p - 1]) { labels[p - 1] = id; stack[sp++] = p - 1; }
        if (x < w - 1 && !labels[p + 1] && ok[p + 1]) { labels[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && !labels[p - w] && ok[p - w]) { labels[p - w] = id; stack[sp++] = p - w; }
        if (y < h - 1 && !labels[p + w] && ok[p + w]) { labels[p + w] = id; stack[sp++] = p + w; }
      }
      comps.push({ area, bottom, cx: sx / area / w, cy: sy / area / h });
    }

    const out = this.out, keep = this.keep;
    if (comps.length === 1) { out.fill(0); this.lastPt = null; return out; }

    // the main region: the one under your face; otherwise the biggest one touching the bottom edge
    let main = 0;
    const pt = facePt || this.lastPt;
    if (pt) main = this.labelNear(pt[0] * w, pt[1] * h, 3);
    if (!main) {
      let best = -1;
      for (let i = 1; i < comps.length; i++) {
        const score = comps[i].area * (comps[i].bottom ? 2 : 1);
        if (score > best) { best = score; main = i; }
      }
    }
    const mainArea = comps[main].area;
    const keepId = new Uint8Array(comps.length);
    keepId[main] = 1;
    for (let i = 1; i < comps.length; i++) {
      const c = comps[i];
      if (c.area >= mainArea * 0.35 || (c.bottom && c.area >= Math.max(mainArea * 0.12, n * 0.01))) keepId[i] = 1;
    }
    if (facePt) this.lastPt = facePt;
    else this.lastPt = [comps[main].cx, comps[main].cy];

    for (let i = 0; i < n; i++) keep[i] = keepId[labels[i]];

    // 3a. half-sure patches mostly surrounded by you are you (a shadowed arm), unlike a headrest,
    // which sits on your outline with background on its other side
    {
      const tmp = this.tmp, list = this.list;
      tmp.fill(0);
      for (let s = 0; s < n; s++) {
        if (keep[s] || tmp[s] || acc[s] < 0.5) continue;
        let sp = 0, area = 0, inner = 0, outer = 0;
        stack[sp++] = s; tmp[s] = 1;
        while (sp) {
          const p = stack[--sp];
          list[area++] = p;
          const x = p % w, y = (p - x) / w;
          for (let k = 0; k < 4; k++) {
            let q;
            if (k === 0) { if (x === 0) { outer++; continue; } q = p - 1; }
            else if (k === 1) { if (x === w - 1) { outer++; continue; } q = p + 1; }
            else if (k === 2) { if (y === 0) { outer++; continue; } q = p - w; }
            else { if (y === h - 1) { inner++; continue; } q = p + w; } // the bottom edge is where your body continues
            if (keep[q]) inner++;
            else if (acc[q] < 0.5) outer++;
            else if (!tmp[q]) { tmp[q] = 1; stack[sp++] = q; }
          }
        }
        if (inner >= (inner + outer) * 0.7) for (let k = 0; k < area; k++) keep[list[k]] = 1;
      }
    }

    // 3b. fill small holes that sit fully inside kept regions (a dark shirt patch the model missed)
    const holeMax = n * 0.006;
    const tmp = this.tmp, list = this.list;
    tmp.fill(0); // 1 = visited background
    for (let s = 0; s < n; s++) {
      if (keep[s] || tmp[s]) continue;
      let sp = 0, area = 0, inside = true, sum = 0;
      stack[sp++] = s; tmp[s] = 1;
      while (sp) {
        const p = stack[--sp];
        list[area++] = p;
        sum += acc[p];
        const x = p % w, y = (p - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) inside = false;
        for (let k = 0; k < 4; k++) {
          let q;
          if (k === 0) { if (x === 0) continue; q = p - 1; }
          else if (k === 1) { if (x === w - 1) continue; q = p + 1; }
          else if (k === 2) { if (y === 0) continue; q = p - w; }
          else { if (y === h - 1) continue; q = p + w; }
          if (keep[q]) continue;
          if (!tmp[q]) { tmp[q] = 1; stack[sp++] = q; }
        }
      }
      // a small hole, or any enclosed area the model was unsure about (real gaps, like between
      // your arm and your side, come back as confident background and stay open)
      if (inside && (area <= holeMax || sum / area >= 0.35)) for (let k = 0; k < area; k++) keep[list[k]] = 2;
    }

    // 4. output: soft values next to the kept regions (so edges stay soft), nothing elsewhere
    // grow "keep" by 2 pixels so the soft fringe around you survives
    tmp.set(keep);
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? keep : tmp, dst = pass === 0 ? tmp : keep;
      if (pass === 1) dst.set(src);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (src[p]) continue;
          if ((x > 0 && src[p - 1]) || (x < w - 1 && src[p + 1]) || (y > 0 && src[p - w]) || (y < h - 1 && src[p + w])) dst[p] = 3;
        }
      }
    }
    // keep now: 0 drop, 1 kept region, 2 filled hole, 3 fringe
    for (let i = 0; i < n; i++) {
      const k = keep[i];
      // fringe pixels keep their soft fall-off but can't count as you on their own
      out[i] = k === 0 ? 0 : k === 2 ? 255 : k === 3 ? (Math.min(acc[i], 0.4) * 255 + 0.5) | 0 : (acc[i] * 255 + 0.5) | 0;
    }
    return out;
  }

  labelNear(fx, fy, r) {
    const w = this.w, h = this.h, labels = this.labels;
    const x0 = Math.round(fx), y0 = Math.round(fy);
    for (let rr = 0; rr <= r; rr++) {
      for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const l = labels[y * w + x];
        if (l) return l;
      }
    }
    return 0;
  }
}
