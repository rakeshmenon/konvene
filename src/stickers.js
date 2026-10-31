// Face stickers that follow your face, expression-triggered effects and reactions.
// Everything is drawn into your own outgoing video, so everyone (and every recording) sees it.

export const STICKERS = {
  none: { label: "None", icon: "∅" },
  shades: { label: "Shades", icon: "\u{1F576}\u{FE0F}" },
  crown: { label: "Crown", icon: "\u{1F451}" },
  cat: { label: "Cat", icon: "\u{1F431}" },
  party: { label: "Party hat", icon: "\u{1F973}" },
  stache: { label: "Moustache", icon: "\u{1F978}" },
  clown: { label: "Clown nose", icon: "\u{1F921}" },
  halo: { label: "Halo", icon: "\u{1F607}" },
  horns: { label: "Devil horns", icon: "\u{1F608}" },
  hearteyes: { label: "Heart eyes", icon: "\u{1F60D}" },
};

export const EXPRESSIONS = [
  { key: "smile", label: "Smile", effect: "hearts float up", icon: "\u{1F60A}" },
  { key: "mouth", label: "Open your mouth wide", effect: "a rainbow pours out", icon: "\u{1F62E}" },
  { key: "brows", label: "Raise your eyebrows", effect: "!! pops up", icon: "\u{1F928}" },
  { key: "wink", label: "Wink", effect: "a sparkle", icon: "\u{1F609}" },
  { key: "kiss", label: "Pucker up", effect: "kisses fly", icon: "\u{1F617}" },
  { key: "puff", label: "Puff your cheeks", effect: "a puff of air", icon: "\u{1F62E}\u{200D}\u{1F4A8}" },
];

export const REACTIONS = ["\u{1F389}", "\u{1F44F}", "\u{1F602}", "\u{2764}\u{FE0F}", "\u{1F525}", "\u{1F44D}"];

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

const P = (lm, i, W, H) => ({ x: lm[i].x * W, y: lm[i].y * H });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export class Overlay {
  constructor() {
    this.particles = [];
    this.cool = {};
    this.smooth = null;
  }

  emoji(g, ch, x, y, size, rot = 0, alpha = 1) {
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    g.rotate(rot);
    g.font = `${Math.round(size)}px ${EMOJI_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(ch, 0, 0);
    g.restore();
  }

  // face geometry in pixels, lightly smoothed so stickers don't jitter
  geometry(lm, W, H) {
    const raw = {
      eyeL: P(lm, 33, W, H), eyeR: P(lm, 263, W, H),
      eyeLc: lerp(P(lm, 33, W, H), P(lm, 133, W, H), 0.5), eyeRc: lerp(P(lm, 263, W, H), P(lm, 362, W, H), 0.5),
      nose: P(lm, 1, W, H), noseBase: P(lm, 2, W, H), top: P(lm, 10, W, H), chin: P(lm, 152, W, H),
      cheekL: P(lm, 234, W, H), cheekR: P(lm, 454, W, H), lipTop: P(lm, 0, W, H), mouth: lerp(P(lm, 13, W, H), P(lm, 14, W, H), 0.5),
      mouthL: P(lm, 61, W, H), mouthR: P(lm, 291, W, H),
    };
    if (!this.smooth) this.smooth = raw;
    else for (const k of Object.keys(raw)) this.smooth[k] = lerp(this.smooth[k], raw[k], 0.55);
    const s = this.smooth;
    s.width = dist(s.cheekL, s.cheekR);
    s.height = dist(s.top, s.chin);
    s.angle = Math.atan2(s.eyeR.y - s.eyeL.y, s.eyeR.x - s.eyeL.x);
    s.up = { x: Math.sin(s.angle), y: -Math.cos(s.angle) }; // towards the top of the head
    return s;
  }

  drawSticker(g, kind, f) {
    const { angle, width: fw, up } = f;
    const at = (p, du, dside = 0) => ({ x: p.x + up.x * du + Math.cos(angle) * dside, y: p.y + up.y * du + Math.sin(angle) * dside });
    switch (kind) {
      case "shades": {
        const c = lerp(f.eyeLc, f.eyeRc, 0.5);
        const w = dist(f.eyeLc, f.eyeRc);
        g.save(); g.translate(c.x, c.y); g.rotate(angle);
        g.fillStyle = "#111"; g.strokeStyle = "#111"; g.lineWidth = w * 0.06;
        const lw = w * 0.62, lh = w * 0.42;
        for (const sx of [-1, 1]) {
          g.beginPath(); g.roundRect(sx * w * 0.5 - lw / 2, -lh / 2, lw, lh, lh * 0.35); g.fill();
          g.fillStyle = "rgba(255,255,255,0.25)";
          g.beginPath(); g.roundRect(sx * w * 0.5 - lw * 0.35, -lh * 0.32, lw * 0.25, lh * 0.18, 4); g.fill();
          g.fillStyle = "#111";
        }
        g.beginPath(); g.moveTo(-w * 0.2, -lh * 0.15); g.quadraticCurveTo(0, -lh * 0.35, w * 0.2, -lh * 0.15); g.stroke();
        g.beginPath(); g.moveTo(-w * 0.8, -lh * 0.2); g.lineTo(-w * 1.05, -lh * 0.3); g.moveTo(w * 0.8, -lh * 0.2); g.lineTo(w * 1.05, -lh * 0.3); g.stroke();
        g.restore();
        break;
      }
      case "crown": { const p = at(f.top, fw * 0.22); this.emoji(g, "\u{1F451}", p.x, p.y, fw * 0.62, angle); break; }
      case "hearteyes": { for (const e of [f.eyeLc, f.eyeRc]) this.emoji(g, "\u{2764}\u{FE0F}", e.x, e.y, fw * 0.32, angle); break; }
      case "halo": {
        const p = at(f.top, fw * 0.45);
        g.save(); g.translate(p.x, p.y); g.rotate(angle);
        g.strokeStyle = "#ffd75e"; g.lineWidth = fw * 0.07; g.shadowColor = "#fff2a8"; g.shadowBlur = fw * 0.15;
        g.beginPath(); g.ellipse(0, 0, fw * 0.4, fw * 0.11, 0, 0, Math.PI * 2); g.stroke(); g.restore();
        break;
      }
      case "horns": {
        for (const side of [-1, 1]) {
          const base = at(f.top, fw * 0.05, side * fw * 0.28);
          g.save(); g.translate(base.x, base.y); g.rotate(angle + side * 0.25);
          g.fillStyle = "#e0262f";
          g.beginPath(); g.moveTo(-fw * 0.08, 0); g.quadraticCurveTo(side * fw * 0.02, -fw * 0.2, side * fw * 0.1, -fw * 0.32); g.quadraticCurveTo(side * fw * 0.04, -fw * 0.12, fw * 0.08, 0); g.closePath(); g.fill();
          g.restore();
        }
        break;
      }
      case "party": {
        const base = at(f.top, fw * 0.02);
        g.save(); g.translate(base.x, base.y); g.rotate(angle - 0.12);
        const h = fw * 0.8, w = fw * 0.5;
        g.beginPath(); g.moveTo(-w / 2, 0); g.lineTo(0, -h); g.lineTo(w / 2, 0); g.closePath();
        g.fillStyle = "#6c5ce7"; g.fill();
        g.save(); g.clip();
        for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? "#fdcb6e" : "#fd79a8"; g.beginPath(); g.ellipse((i - 2.5) * w * 0.25, -h * (0.15 + i * 0.13), w * 0.08, w * 0.08, 0, 0, Math.PI * 2); g.fill(); }
        g.restore();
        g.fillStyle = "#ffeaa7"; g.beginPath(); g.arc(0, -h, w * 0.12, 0, Math.PI * 2); g.fill();
        g.restore();
        break;
      }
      case "stache": {
        const c = lerp(f.noseBase, f.lipTop, 0.55);
        const w = dist(f.mouthL, f.mouthR) * 1.35;
        g.save(); g.translate(c.x, c.y); g.rotate(angle);
        g.fillStyle = "#3b2416";
        g.beginPath();
        g.moveTo(0, -w * 0.05);
        g.bezierCurveTo(w * 0.2, -w * 0.22, w * 0.42, -w * 0.12, w * 0.55, w * 0.05);
        g.bezierCurveTo(w * 0.42, w * 0.0, w * 0.25, w * 0.12, 0, w * 0.06);
        g.bezierCurveTo(-w * 0.25, w * 0.12, -w * 0.42, w * 0.0, -w * 0.55, w * 0.05);
        g.bezierCurveTo(-w * 0.42, -w * 0.12, -w * 0.2, -w * 0.22, 0, -w * 0.05);
        g.fill(); g.restore();
        break;
      }
      case "clown": {
        g.fillStyle = "#ff2d3a"; g.shadowColor = "rgba(0,0,0,0.3)"; g.shadowBlur = fw * 0.04;
        g.beginPath(); g.arc(f.nose.x, f.nose.y, fw * 0.11, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
        g.fillStyle = "rgba(255,255,255,0.6)"; g.beginPath(); g.arc(f.nose.x - fw * 0.035, f.nose.y - fw * 0.04, fw * 0.03, 0, Math.PI * 2); g.fill();
        g.fillStyle = "rgba(255,80,110,0.28)";
        for (const ch of [lerp(f.cheekL, f.nose, 0.35), lerp(f.cheekR, f.nose, 0.35)]) { g.beginPath(); g.arc(ch.x, ch.y + fw * 0.06, fw * 0.1, 0, Math.PI * 2); g.fill(); }
        break;
      }
      case "cat": {
        for (const side of [-1, 1]) {
          const base = at(f.top, fw * 0.02, side * fw * 0.3);
          g.save(); g.translate(base.x, base.y); g.rotate(angle + side * 0.3);
          g.fillStyle = "#2d2d2d";
          g.beginPath(); g.moveTo(-fw * 0.14, 0); g.lineTo(0, -fw * 0.32); g.lineTo(fw * 0.14, 0); g.closePath(); g.fill();
          g.fillStyle = "#ff9eb5";
          g.beginPath(); g.moveTo(-fw * 0.07, -fw * 0.03); g.lineTo(0, -fw * 0.22); g.lineTo(fw * 0.07, -fw * 0.03); g.closePath(); g.fill();
          g.restore();
        }
        g.fillStyle = "#ff7aa2";
        g.beginPath(); g.ellipse(f.nose.x, f.nose.y, fw * 0.05, fw * 0.035, angle, 0, Math.PI * 2); g.fill();
        g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = Math.max(1.5, fw * 0.01);
        for (const side of [-1, 1]) for (let i = -1; i <= 1; i++) {
          const s0 = { x: f.nose.x + Math.cos(angle) * side * fw * 0.08, y: f.nose.y + Math.sin(angle) * side * fw * 0.08 + fw * 0.03 };
          const a = angle + (side > 0 ? 0 : Math.PI) + i * 0.18 * side;
          g.beginPath(); g.moveTo(s0.x, s0.y); g.lineTo(s0.x + Math.cos(a) * fw * 0.32, s0.y + Math.sin(a) * fw * 0.32); g.stroke();
        }
        break;
      }
      default: break;
    }
  }

  spawn(p) { this.particles.push({ age: 0, rot: 0, vr: 0, ...p }); if (this.particles.length > 220) this.particles.shift(); }

  ready(key, now, ms) {
    if ((this.cool[key] || 0) > now) return false;
    this.cool[key] = now + ms;
    return true;
  }

  // fires once when an expression starts (not continuously), so normal talking stays calm
  edge(key, on, now, cooldownMs) {
    const was = this.held && this.held[key];
    this.held = this.held || {};
    this.held[key] = on;
    return on && !was && this.ready(key, now, cooldownMs);
  }

  expressions(f, shapes, now) {
    const sh = (k) => shapes[k] || 0;
    const smile = (sh("mouthSmileLeft") + sh("mouthSmileRight")) / 2;
    const fw = f.width;
    if (this.edge("smile", smile > 0.7, now, 2500)) {
      for (let i = 0; i < 7; i++) {
        const from = i % 2 ? f.cheekL : f.cheekR;
        this.spawn({ ch: i % 3 ? "\u{2764}\u{FE0F}" : "\u{1F495}", x: from.x, y: from.y, vx: (Math.random() - 0.5) * 50, vy: -60 - Math.random() * 50, size: fw * (0.16 + Math.random() * 0.1), life: 2.2, delay: i * 0.12 });
      }
    }
    if (sh("jawOpen") > 0.62) this.rainbowUntil = Math.max(this.rainbowUntil || 0, this.held && this.held.mouthOpen ? this.rainbowUntil : now + 1500);
    this.held = this.held || {}; this.held.mouthOpen = sh("jawOpen") > 0.62;
    if (sh("jawOpen") > 0.62 && now < (this.rainbowUntil || 0) && this.ready("mouth", now, 30)) {
      const hue = (now / 6) % 360;
      this.spawn({ kind: "blob", color: `hsl(${hue},95%,60%)`, x: f.mouth.x, y: f.mouth.y, vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 80, size: fw * 0.09, life: 1.4, gravity: 260 });
    }
    if (this.edge("brows", (sh("browInnerUp") + sh("browOuterUpLeft") + sh("browOuterUpRight")) / 3 > 0.6, now, 2000)) {
      const p = { x: f.top.x + f.up.x * fw * 0.3, y: f.top.y + f.up.y * fw * 0.3 };
      this.spawn({ ch: "\u{203C}\u{FE0F}", x: p.x, y: p.y, vx: 0, vy: -20, size: fw * 0.45, life: 1.1, pop: true });
    }
    const bl = sh("eyeBlinkLeft"), br = sh("eyeBlinkRight");
    if (this.edge("wink", Math.abs(bl - br) > 0.45 && Math.max(bl, br) > 0.6, now, 1500)) {
      const eye = bl > br ? f.eyeLc : f.eyeRc;
      this.spawn({ ch: "\u{2728}", x: eye.x, y: eye.y, vx: 0, vy: -10, size: fw * 0.35, life: 1, pop: true });
    }
    if (this.edge("kiss", sh("mouthPucker") > 0.75 && smile < 0.3, now, 1500)) {
      this.spawn({ ch: "\u{1F48B}", x: f.mouth.x, y: f.mouth.y, vx: (Math.random() - 0.5) * 80, vy: -70, size: fw * 0.22, life: 1.8, vr: (Math.random() - 0.5) * 2 });
    }
    if (this.edge("puff", sh("cheekPuff") > 0.45, now, 1500)) {
      this.spawn({ ch: "\u{1F4A8}", x: f.mouthR.x + fw * 0.1, y: f.mouth.y, vx: 140, vy: -10, size: fw * 0.3, life: 1.1 });
    }
  }

  react(ch, W, H) {
    if (ch === "\u{1F389}") {
      for (let i = 0; i < 70; i++) this.spawn({ kind: "confetti", color: `hsl(${Math.random() * 360},90%,60%)`, x: W / 2, y: H * 0.85, vx: (Math.random() - 0.5) * 700, vy: -400 - Math.random() * 400, size: 8 + Math.random() * 8, life: 2.4, gravity: 600, vr: (Math.random() - 0.5) * 10 });
      return;
    }
    for (let i = 0; i < 9; i++) {
      this.spawn({ ch, x: W * (0.15 + Math.random() * 0.7), y: H + 20, vx: (Math.random() - 0.5) * 40, vy: -140 - Math.random() * 120, size: 40 + Math.random() * 28, life: 2.6 + Math.random() * 0.6, delay: i * 0.12 });
    }
  }

  // draw stickers and particles onto g (already holding the processed video)
  draw(g, W, H, faceRes, settings, dt, now) {
    let f = null;
    if (faceRes && faceRes.landmarks) {
      f = this.geometry(faceRes.landmarks, W, H);
      if (settings.sticker && settings.sticker !== "none") this.drawSticker(g, settings.sticker, f);
      if (settings.expressions) this.expressions(f, faceRes.shapes || {}, now);
    } else {
      this.smooth = null;
    }
    this.particles = this.particles.filter((p) => {
      if (p.delay > 0) { p.delay -= dt; return true; }
      p.age += dt;
      if (p.age > p.life) return false;
      p.vy += (p.gravity || -10) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += (p.vr || 0) * dt;
      const t = p.age / p.life;
      const alpha = Math.min(1, (1 - t) * 2.5);
      const scale = p.pop ? 0.6 + Math.min(1, p.age * 6) * 0.5 - Math.max(0, t - 0.7) * 0.8 : 1;
      if (p.kind === "blob") {
        g.globalAlpha = alpha; g.fillStyle = p.color;
        g.beginPath(); g.arc(p.x, p.y, p.size * (1 + t * 0.8), 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
      } else if (p.kind === "confetti") {
        g.save(); g.globalAlpha = alpha; g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.color; g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); g.restore();
      } else {
        this.emoji(g, p.ch, p.x + Math.sin(p.age * 4 + p.size) * 8, p.y, p.size * scale, p.rot, alpha);
      }
      return true;
    });
    return f;
  }
}
