// The home page: the sticky nav's hairline, the feature tabs, the route lanes (they move only
// while on screen) and the two sound waves. The call window in the hero is pure CSS.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

export function initHome() {
  const home = $("#prejoin");
  if (!home) return;

  // a hairline under the nav once the page has scrolled
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // feature tabs (arrow keys move between them, like any tab list)
  const tabs = $$('.ex-tabs [role="tab"]', home);
  const select = (t, focus) => {
    for (const x of tabs) {
      const on = x === t;
      x.setAttribute("aria-selected", String(on));
      x.tabIndex = on ? 0 : -1;
      $("#" + x.getAttribute("aria-controls")).hidden = !on;
    }
    if (focus) t.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      const k = e.key;
      let n = null;
      if (k === "ArrowDown" || k === "ArrowRight") n = tabs[(i + 1) % tabs.length];
      else if (k === "ArrowUp" || k === "ArrowLeft") n = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (k === "Home") n = tabs[0];
      else if (k === "End") n = tabs[tabs.length - 1];
      if (n) { e.preventDefault(); select(n, true); }
    });
  });

  // moving parts run only while you can see them
  const lanes = $(".lanes", home), demo = $(".demo-win", home);
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === lanes) lanes.classList.toggle("on", e.isIntersecting);
        if (e.target === demo) demo.classList.toggle("still", !e.isIntersecting);
      }
    }, { threshold: 0.2 });
    if (lanes) io.observe(lanes);
    if (demo) io.observe(demo);
  } else if (lanes) lanes.classList.add("on");

  // the two waves: a noisy room, and the same voice with the noise taken out
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const speech = (x) => {
    // three phrases with pauses between them
    const bursts = [[20, 95], [130, 205], [235, 300]];
    for (const [a, b] of bursts) if (x >= a && x <= b) return Math.sin(((x - a) / (b - a)) * Math.PI);
    return 0;
  };
  const wave = (noise) => {
    let d = "M0 30";
    for (let x = 2; x <= 320; x += 2) {
      const v = speech(x) * 24 * Math.sin(x * 0.9) * (0.6 + rnd() * 0.4) + (noise ? (rnd() - 0.5) * 22 : 0);
      d += ` L${x} ${(30 + v).toFixed(1)}`;
    }
    return d;
  };
  const noisy = $(".w-noisy", home), clean = $(".w-clean", home);
  if (noisy) noisy.setAttribute("d", wave(true));
  if (clean) clean.setAttribute("d", wave(false));
}
