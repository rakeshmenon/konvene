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

  meet($("#orbs"));

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

  // three moments in a call: real screenshots, one step at a time
  const moments = $("[data-moments]", home);
  const STEP = 6000;
  let seen = false, hold = false, timer = 0, left = STEP, started = 0;
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  const mTabs = moments ? [...moments.querySelectorAll('[role="tab"]')] : [];
  // the bar under the current step fills over STEP; pausing keeps its place
  const stopClock = () => { if (timer) { clearTimeout(timer); timer = 0; left = Math.max(0, left - (performance.now() - started)); } };
  const sync = () => {
    stopClock();
    const run = seen && !hold && !calm.matches;
    moments.classList.toggle("paused", !run);
    if (run) { started = performance.now(); timer = setTimeout(next, left); }
  };
  const showMoment = (tab, focus) => {
    for (const t of mTabs) { const on = t === tab; t.setAttribute("aria-selected", on); t.tabIndex = on ? 0 : -1; }
    for (const img of moments.querySelectorAll(".m-shot")) img.classList.toggle("on", img.dataset.for === tab.id);
    $("#m-view", moments).setAttribute("aria-labelledby", tab.id);
    if (focus) tab.focus();
    clearTimeout(timer); timer = 0; left = STEP;
    moments.classList.remove("playing"); void moments.offsetWidth; // restart the bar
    if (!calm.matches) moments.classList.add("playing");
    sync();
  };
  const next = () => { timer = 0; const i = mTabs.findIndex((t) => t.getAttribute("aria-selected") === "true"); showMoment(mTabs[(i + 1) % mTabs.length]); };
  if (moments) {
    moments.style.setProperty("--m-time", STEP + "ms");
    mTabs.forEach((t, i) => {
      t.addEventListener("click", () => showMoment(t));
      t.addEventListener("keydown", (e) => {
        const k = e.key; let n = null;
        if (k === "ArrowDown" || k === "ArrowRight") n = mTabs[(i + 1) % mTabs.length];
        else if (k === "ArrowUp" || k === "ArrowLeft") n = mTabs[(i - 1 + mTabs.length) % mTabs.length];
        else if (k === "Home") n = mTabs[0];
        else if (k === "End") n = mTabs[mTabs.length - 1];
        if (n) { e.preventDefault(); showMoment(n, true); }
      });
    });
    // reading or pointing at it holds the current step; leaving carries on from where it was
    moments.addEventListener("pointerenter", () => { hold = true; sync(); });
    moments.addEventListener("pointerleave", () => { hold = false; sync(); });
    moments.addEventListener("focusin", () => { hold = true; sync(); });
    moments.addEventListener("focusout", (e) => { if (!moments.contains(e.relatedTarget)) { hold = false; sync(); } });
    if (!calm.matches) moments.classList.add("playing");
  }

  // moving parts run only while you can see them
  const lanes = $(".lanes", home);
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === lanes) lanes.classList.toggle("on", e.isIntersecting);
        if (e.target === moments) { seen = e.isIntersecting; sync(); }
      }
    }, { threshold: 0.35 });
    if (lanes) io.observe(lanes);
    if (moments) io.observe(moments);
  } else {
    if (lanes) lanes.classList.add("on");
    if (moments) { seen = true; sync(); }
  }

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

// The hero: two circles, you and them, drift together; where they overlap lights up.
// They follow the pointer a little. Nothing here runs when motion is turned off.
function meet(svg) {
  if (!svg) return;
  const you = Array.from(svg.querySelectorAll(".c-you")), them = Array.from(svg.querySelectorAll(".c-them"));
  const lens = svg.querySelector("#lens-fill"), motes = svg.querySelector(".motes"), ripples = svg.querySelectorAll(".ripples circle");
  const tYou = svg.querySelector(".t-you"), tThem = svg.querySelector(".t-them"), glow = svg.querySelector(".lens-g");
  const CX = 720, CY = 640, NEAR = 130, FAR = 330;
  let half = FAR, px = 0, py = 0, tx = 0, ty = 0;
  const draw = () => {
    const cx = CX + px, cy = CY + py;
    for (const c of you) { c.setAttribute("cx", cx - half); c.setAttribute("cy", cy); }
    for (const c of them) { c.setAttribute("cx", cx + half); c.setAttribute("cy", cy); }
    for (const c of ripples) { c.setAttribute("cx", cx); c.setAttribute("cy", cy); }
    if (lens) { lens.setAttribute("cx", cx); lens.setAttribute("cy", cy - 40); }
    if (motes) motes.setAttribute("transform", `translate(${(cx - CX).toFixed(1)} ${(cy - CY).toFixed(1)})`);
    if (tYou) tYou.setAttribute("x", (cx - half - 260).toFixed(1));
    if (tThem) tThem.setAttribute("x", (cx + half + 260).toFixed(1));
  };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { half = NEAR; draw(); if (glow) glow.style.opacity = "1"; svg.classList.add("met"); return; }
  const t0 = performance.now(), DUR = 1800;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  let raf = 0;
  const step = (now) => {
    const t = Math.min(1, (now - t0) / DUR);
    half = FAR + (NEAR - FAR) * ease(t);
    if (glow) glow.style.opacity = String(Math.min(1, Math.max(0, (t - 0.25) / 0.6)));
    px += (tx - px) * 0.06; py += (ty - py) * 0.06;
    draw();
    if (t >= 1) svg.classList.add("met");
    raf = (t < 1 || Math.abs(tx - px) > 0.2 || Math.abs(ty - py) > 0.2) ? requestAnimationFrame(step) : 0;
  };
  raf = requestAnimationFrame(step);
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || scrollY > innerHeight) return;
    tx = (e.clientX / innerWidth - 0.5) * 36;
    ty = (e.clientY / innerHeight - 0.5) * 18;
    if (!raf) raf = requestAnimationFrame(step);
  }, { passive: true });
}
