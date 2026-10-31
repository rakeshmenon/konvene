// Virtual backgrounds, drawn in code (no image files, no downloads).
export const BACKGROUNDS = {
  none: { label: "None" },
  "blur-light": { label: "Light blur" },
  "blur-strong": { label: "Strong blur" },
  studio: { label: "Studio", swatch: "linear-gradient(160deg,#5b5f73,#23252f)" },
  sunset: { label: "Sunset", swatch: "linear-gradient(180deg,#ff9a5a,#ff5e7e 55%,#5b2a6e)" },
  space: { label: "Space", swatch: "radial-gradient(circle at 70% 30%,#6a4bc4,#120c2b 60%)" },
  pastel: { label: "Pastel", swatch: "linear-gradient(135deg,#ffd6e8,#c9e7ff 50%,#e2ffd6)" },
  ocean: { label: "Ocean", swatch: "linear-gradient(180deg,#8fd6ff,#2a7fd4 55%,#0f3e7a)" },
  forest: { label: "Forest", swatch: "linear-gradient(180deg,#cfe9b3,#3f7d4a 60%,#1f3d2a)" },
  upload: { label: "Your image" },
};

function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

export function drawBackground(key, W, H) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const r = rng(7);
  const grad = (stops, x0 = 0, y0 = 0, x1 = 0, y1 = H) => { const l = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, col]) => l.addColorStop(o, col)); return l; };
  switch (key) {
    case "studio": {
      g.fillStyle = grad([[0, "#6b6f85"], [1, "#22242e"]]); g.fillRect(0, 0, W, H);
      const rg = g.createRadialGradient(W * 0.5, H * 0.35, 10, W * 0.5, H * 0.4, W * 0.6);
      rg.addColorStop(0, "rgba(255,255,255,0.35)"); rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
      break;
    }
    case "sunset": {
      g.fillStyle = grad([[0, "#ffb36b"], [0.45, "#ff6f7f"], [1, "#4a2366"]]); g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(255,240,200,0.9)"; g.beginPath(); g.arc(W * 0.68, H * 0.5, H * 0.16, 0, Math.PI * 2); g.fill();
      const ridge = (y, amp, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += W / 24) g.lineTo(x, y + Math.sin(x * 0.006 + y) * amp + (r() - 0.5) * amp); g.lineTo(W, H); g.closePath(); g.fill(); };
      ridge(H * 0.62, 40, "#7d3a6e"); ridge(H * 0.72, 30, "#5a2758"); ridge(H * 0.84, 22, "#3b1a40");
      break;
    }
    case "space": {
      g.fillStyle = grad([[0, "#1b1240"], [1, "#05030f"]]); g.fillRect(0, 0, W, H);
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`; g.fillRect(r() * W, r() * H, r() < 0.1 ? 2.5 : 1.5, r() < 0.1 ? 2.5 : 1.5); }
      const neb = g.createRadialGradient(W * 0.25, H * 0.3, 10, W * 0.25, H * 0.3, W * 0.4);
      neb.addColorStop(0, "rgba(180,90,255,0.35)"); neb.addColorStop(1, "rgba(180,90,255,0)"); g.fillStyle = neb; g.fillRect(0, 0, W, H);
      const pg = g.createRadialGradient(W * 0.82, H * 0.28, 5, W * 0.8, H * 0.3, H * 0.2);
      pg.addColorStop(0, "#ffc27a"); pg.addColorStop(1, "#c4553d"); g.fillStyle = pg; g.beginPath(); g.arc(W * 0.8, H * 0.3, H * 0.18, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "rgba(255,220,180,0.6)"; g.lineWidth = 6; g.beginPath(); g.ellipse(W * 0.8, H * 0.3, H * 0.3, H * 0.06, -0.3, 0, Math.PI * 2); g.stroke();
      break;
    }
    case "pastel": {
      g.fillStyle = "#fbe9f3"; g.fillRect(0, 0, W, H);
      const blob = (x, y, rad, col) => { const b = g.createRadialGradient(x, y, 0, x, y, rad); b.addColorStop(0, col); b.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = b; g.fillRect(0, 0, W, H); };
      blob(W * 0.2, H * 0.3, W * 0.45, "rgba(255,170,210,0.9)"); blob(W * 0.8, H * 0.25, W * 0.45, "rgba(160,210,255,0.9)"); blob(W * 0.55, H * 0.9, W * 0.5, "rgba(190,255,190,0.8)");
      break;
    }
    case "ocean": {
      g.fillStyle = grad([[0, "#9fe0ff"], [0.5, "#4aa3e8"], [1, "#0d3a74"]]); g.fillRect(0, 0, W, H);
      for (let i = 0; i < 9; i++) { g.strokeStyle = `rgba(255,255,255,${0.08 + i * 0.02})`; g.lineWidth = 3; g.beginPath(); for (let x = 0; x <= W; x += 20) g.lineTo(x, H * 0.55 + i * 28 + Math.sin(x * 0.02 + i) * 8); g.stroke(); }
      g.fillStyle = "rgba(255,255,255,0.8)"; g.beginPath(); g.arc(W * 0.2, H * 0.2, H * 0.08, 0, Math.PI * 2); g.fill();
      break;
    }
    case "forest": {
      g.fillStyle = grad([[0, "#dff3c4"], [0.55, "#7fb36b"], [1, "#1c3a26"]]); g.fillRect(0, 0, W, H);
      for (let layer = 0; layer < 3; layer++) {
        g.fillStyle = ["#5e9a5c", "#3b7347", "#214a30"][layer];
        for (let i = 0; i < 14; i++) {
          const x = r() * W, h = H * (0.25 + layer * 0.12 + r() * 0.15), base = H * (0.6 + layer * 0.15);
          g.beginPath(); g.moveTo(x, base - h); g.lineTo(x - h * 0.28, base); g.lineTo(x + h * 0.28, base); g.closePath(); g.fill();
        }
      }
      break;
    }
    default: return null;
  }
  return c;
}
