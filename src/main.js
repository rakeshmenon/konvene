import { dlog } from "./debug.js"; // first, so it sees every connection
import { Pipeline } from "./pipeline.js";
import { Pip, PIP_DOC, PIP_VIDEO } from "./pip.js";
import { join, makeRoomCode } from "./net.js";
import { iceServers } from "./config.js";
import { CallRecorder } from "./recorder.js";
import { LOOKS, LIGHTS } from "./fx.js";
import { BACKGROUNDS } from "./backgrounds.js";
import { EXPRESSIONS, REACTIONS } from "./stickers.js";
import { LIPS, BLUSH, WARPS, FACE_DEFAULTS } from "./face.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
// the call's tiles can move into a picture-in-picture window, so look them up from the stage itself
const stageEl = () => state.stageEl || (state.stageEl = document.getElementById("stage"));
const LOCAL = new URLSearchParams(location.search).has("local");
const MAX_PEOPLE = 6;
const FX_KEY = "gr_fx";
const DEV_KEY = "gr_devices";

const state = {
  name: "",
  room: null,
  code: null,
  selfId: "me",
  me: null,
  peers: new Map(), // id -> { id, name, mic, cam, hand, stream, video, tile, analyser, screen: { id, stream, video, tile } }
  mic: false, // camera and microphone are off until you turn them on
  cam: false,
  hand: false,
  screen: null, // our shared screen stream
  screenTile: null,
  pinned: null, // tile key the user pinned
  panel: null, // "chat" | "people" | "settings"
  unread: 0,
  sinkId: "",
  devices: loadDevices(),
  pipe: new Pipeline(),
  audio: null,
  recorder: null,
  recBy: new Map(),
  actions: null,
  inCall: false,
};

/* ---------------- small helpers ---------------- */

function toast(msg, ms = 3000) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
function say(msg) { const l = $("#live"); l.textContent = ""; setTimeout(() => { l.textContent = msg; }, 30); }
// calls live at clean links: https://site/abc-def-ghj (old #abc-def-ghj links still work)
const CODE_RE = /^([a-z0-9]{3}-[a-z0-9]{3}-[a-z0-9]{3})$/;
function codeFromHash() {
  const p = location.pathname.replace(/^\/+|\/+$/g, "");
  if (CODE_RE.test(p)) return p;
  const h = location.hash.replace(/^#/, "");
  return CODE_RE.test(h) ? h : null;
}
function goTo(code) { history.replaceState(null, "", (code ? "/" + code : "/") + location.search); }
// invite links keep test settings (?local) but not your own troubleshooting log (?debug)
function link(code) { const q = new URLSearchParams(location.search); q.delete("debug"); const s = q.toString().replace(/=(&|$)/g, "$1"); return location.origin + "/" + code + (s ? "?" + s : ""); }
function loadFx() {
  try {
    const s = JSON.parse(localStorage.getItem(FX_KEY) || "{}");
    if (!s.v) delete s.expressions; // expression effects are off by default since v2
    if (!s.v || s.v < 3) s.sticker = "none"; // v3 replaced face stickers with the Face tab
    delete s.v;
    return s;
  } catch { return {}; }
}
function saveFx() { try { localStorage.setItem(FX_KEY, JSON.stringify({ ...state.pipe.settings, v: 3 })); } catch { /* private mode */ } }
function loadDevices() { try { return JSON.parse(localStorage.getItem(DEV_KEY) || "{}"); } catch { return {}; } }
function saveDevices() { try { localStorage.setItem(DEV_KEY, JSON.stringify(state.devices)); } catch { /* private mode */ } }
function icon(id) { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("aria-hidden", "true"); const u = document.createElementNS("http://www.w3.org/2000/svg", "use"); u.setAttribute("href", "#" + id); s.appendChild(u); return s; }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function person(id) { return id === state.selfId ? state.me : state.peers.get(id); }
function nameOf(id) { const p = person(id); return (p && p.name) || "Guest"; }

/* ---------------- effects panel ---------------- */

const THUMB_GROUPS = new Set(["bg", "look", "light", "warp"]);
const thumbs = []; // { canvas, patch }

function optionButton(container, group, value, label, visual, current) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "opt";
  b.dataset.group = group;
  b.dataset.value = value;
  b.setAttribute("aria-pressed", String(current === value));
  const v = document.createElement("span");
  v.className = "opt-visual";
  if (visual.swatch) v.style.background = visual.swatch;
  if (THUMB_GROUPS.has(group) && value !== "upload") {
    const c = document.createElement("canvas");
    c.className = "thumb mirror";
    const face = group === "warp";
    c.width = face ? 200 : 320; c.height = face ? 200 : 180;
    v.appendChild(c);
    thumbs.push({ canvas: c, patch: { [group]: value }, faceCrop: face });
  } else if (visual.icon) {
    const i = document.createElement("span");
    i.className = "opt-icon";
    i.textContent = visual.icon;
    v.appendChild(i);
  }
  const l = document.createElement("span");
  l.className = "opt-label";
  l.textContent = label;
  b.append(v, l);
  container.appendChild(b);
}

const LOOK_SWATCH = {
  natural: "linear-gradient(135deg,#c9a58c,#5c4a40)", warm: "linear-gradient(135deg,#d9a878,#7a4a30)", cool: "linear-gradient(135deg,#9fb6c9,#3e5468)",
  vivid: "linear-gradient(135deg,#d97b6c,#c9a85c,#5ca88f)", noir: "linear-gradient(135deg,#d6d3cf,#1a1918)", vintage: "linear-gradient(135deg,#d9c3a0,#6e5a40)",
  neon: "linear-gradient(135deg,#a05cc9,#4a6ec9)", comic: "linear-gradient(135deg,#e0b84a,#c95c6e)", dream: "linear-gradient(135deg,#e6cfe0,#a99cc9)",
};
const LIGHT_SWATCH = {
  off: "#2a2826", studio: "radial-gradient(circle at 50% 40%,#f2e3cc,#4a4038)", boost: "radial-gradient(circle at 50% 40%,#f5f2ec,#7a766f)",
  ring: "radial-gradient(circle,#2a2826 30%,#efe9df 32% 44%,#2a2826 46%)", golden: "radial-gradient(circle at 30% 30%,#e8a95c,#4a2a18)",
  rim: "linear-gradient(90deg,#a04a9a,#1d1b1a 40% 60%,#3a8fb0)", spot: "radial-gradient(circle at 50% 40%,#efe9df 0 18%,#151413 45%)",
};
const BG_SWATCH = { none: "#2a2826", "blur-light": "linear-gradient(135deg,#6b6f7a,#a89a8f)", "blur-strong": "linear-gradient(135deg,#7a7d85,#9e958d)" };

const SIGNATURES = [
  { key: "natural", label: "Natural", patch: { bg: "none", look: "natural", light: "off" } },
  { key: "studio", label: "Studio", patch: { bg: "blur-light", look: "natural", light: "studio" } },
  { key: "golden", label: "Golden hour", patch: { bg: "blur-light", look: "warm", light: "golden" } },
  { key: "noir", label: "Noir", patch: { bg: "blur-strong", look: "noir", light: "spot" } },
];

function buildSignatures() {
  const row = $("#sig-row");
  if (!row) return;
  row.innerHTML = "";
  for (const sg of SIGNATURES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sig";
    b.dataset.sig = sg.key;
    const v = document.createElement("span");
    v.className = "opt-visual";
    const c = document.createElement("canvas");
    c.className = "thumb mirror";
    c.width = 320; c.height = 180;
    v.appendChild(c);
    thumbs.push({ canvas: c, patch: sg.patch, sig: true });
    const l = document.createElement("span");
    l.className = "opt-label";
    l.textContent = sg.label;
    b.append(v, l);
    b.addEventListener("click", () => { setFx(sg.patch); buildPanel(); });
    row.appendChild(b);
  }
  syncSignatures();
}

function syncSignatures() {
  const s = state.pipe.settings;
  $$(".sig").forEach((b) => {
    const sg = SIGNATURES.find((x) => x.key === b.dataset.sig);
    const on = Object.entries(sg.patch).every(([k, v]) => s[k] === v);
    b.setAttribute("aria-pressed", String(on));
  });
}

function buildPanel() {
  const s = state.pipe.settings;
  for (let i = thumbs.length - 1; i >= 0; i--) if (!thumbs[i].sig) thumbs.splice(i, 1);
  const bg = $("#opts-bg"); bg.innerHTML = "";
  for (const [k, v] of Object.entries(BACKGROUNDS)) {
    const visual = k === "upload" ? { icon: "+" } : { swatch: v.swatch || BG_SWATCH[k] };
    optionButton(bg, "bg", k, v.label, visual, s.bg);
  }
  const lk = $("#opts-look"); lk.innerHTML = "";
  for (const [k, v] of Object.entries(LOOKS)) optionButton(lk, "look", k, v.label, { swatch: LOOK_SWATCH[k] }, s.look);
  const li = $("#opts-light"); li.innerHTML = "";
  for (const [k, v] of Object.entries(LIGHTS)) optionButton(li, "light", k, v.label, { swatch: LIGHT_SWATCH[k] }, s.light);
  const wp = $("#opts-warp"); wp.innerHTML = "";
  for (const [k, v] of Object.entries(WARPS)) optionButton(wp, "warp", k, v.label, {}, s.warp);
  swatches($("#sw-lips"), "lips", LIPS, s.lips);
  swatches($("#sw-blush"), "blush", BLUSH, s.blush);
  for (const r of $$("[data-face]")) r.value = s[r.dataset.face];
  $("#brightness").value = s.brightness;
  $("#expr-toggle").checked = !!s.expressions;
  for (const c of $$("[data-smart]")) c.checked = !!s[c.dataset.smart];
  const ex = $("#expr-list"); ex.innerHTML = "";
  for (const e of EXPRESSIONS) {
    const li2 = document.createElement("li");
    const ic = document.createElement("span"); ic.className = "ex-icon"; ic.textContent = e.icon;
    const tx = document.createElement("span");
    const strong = document.createElement("strong"); strong.textContent = e.label;
    const eff = document.createElement("span"); eff.textContent = e.effect;
    tx.append(strong, eff);
    li2.append(ic, tx);
    ex.appendChild(li2);
  }
}

const rgb = (c) => `rgb(${c.map((x) => Math.round(Math.min(1, x) * 255)).join(",")})`;
function swatches(box, group, table, current) {
  box.innerHTML = "";
  for (const [k, v] of Object.entries(table)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sw" + (v.c ? "" : " none");
    b.dataset.group = group; b.dataset.value = k;
    b.setAttribute("aria-pressed", String(current === k));
    b.setAttribute("aria-label", v.label); b.title = v.label;
    if (v.c) b.style.setProperty("--sw", rgb(v.c));
    box.appendChild(b);
  }
}

// which live previews are on screen (the pipeline keeps them all moving)
setInterval(() => {
  const visible = thumbs.filter((t) => t.canvas.isConnected && t.canvas.offsetParent !== null);
  if (visible.length) state.pipe.queueThumbs(visible);
  else state.pipe.queueThumbs([]);
  state.pipe.forceSeg = visible.some((t) => t.patch.bg && t.patch.bg !== "none");
  state.pipe.forceFace = visible.some((t) => t.faceCrop);
}, 250);

function setFx(patch) {
  state.pipe.applySettings(patch);
  saveFx();
  syncSignatures();
  for (const b of $$(".opt, .sw")) {
    const g = b.dataset.group;
    b.setAttribute("aria-pressed", String(state.pipe.settings[g] === b.dataset.value));
  }
}

function openFx() {
  if (state.panel) closePanel();
  const p = $("#fx-panel");
  p.hidden = false;
  document.body.classList.add("fx-open", "panel-open");
  $("#fx-preview").appendChild(makeLocalView(true));
  $$("[data-open-fx]").forEach((b) => b.setAttribute("aria-expanded", "true"));
  $("#fx-close").focus();
}
function closeFx() {
  $("#fx-panel").hidden = true;
  document.body.classList.remove("fx-open");
  if (!state.panel) document.body.classList.remove("panel-open");
  $("#fx-preview").innerHTML = "";
  $$("[data-open-fx]").forEach((b) => b.setAttribute("aria-expanded", "false"));
}

function initPanel() {
  buildPanel();
  $("#fx-panel").addEventListener("click", (e) => {
    const b = e.target.closest(".opt, .sw");
    if (!b) return;
    if (b.dataset.group === "bg" && b.dataset.value === "upload") { $("#bg-file").click(); return; }
    setFx({ [b.dataset.group]: b.dataset.value });
  });
  $("#bg-file").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => { state.pipe.setUpload(img); setFx({ bg: "upload" }); };
    img.src = URL.createObjectURL(f);
  });
  $("#brightness").addEventListener("input", (e) => setFx({ brightness: +e.target.value }));
  for (const r of $$("[data-face]")) r.addEventListener("input", () => setFx({ [r.dataset.face]: +r.value }));
  $("#expr-toggle").addEventListener("change", (e) => setFx({ expressions: e.target.checked }));
  for (const c of $$("[data-smart]")) c.addEventListener("change", () => setFx({ [c.dataset.smart]: c.checked }));
  $("#reset-fx").addEventListener("click", () => {
    setFx({ bg: "none", look: "natural", light: "off", brightness: 0, ...FACE_DEFAULTS, sticker: "none", expressions: false, autoAway: true, autoFrame: false, autoLight: true, mutedHint: true });
    buildPanel();
  });
  $$("[data-open-fx]").forEach((b) => b.addEventListener("click", () => ($("#fx-panel").hidden ? openFx() : closeFx())));
  $("#fx-close").addEventListener("click", closeFx);
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#fx-panel").hidden) closeFx(); });
  // tabs
  const tabs = $$('[role="tab"]');
  const select = (t) => {
    tabs.forEach((x) => { const on = x === t; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; $("#" + x.getAttribute("aria-controls")).hidden = !on; });
    t.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") select(tabs[(i + 1) % tabs.length]);
      if (e.key === "ArrowLeft") select(tabs[(i - 1 + tabs.length) % tabs.length]);
    });
  });
}

/* ---------------- devices: camera, microphone, speakers ---------------- */

const KINDS = [
  { kind: "videoinput", key: "cam", label: "Camera", icon: "i-cam" },
  { kind: "audioinput", key: "mic", label: "Microphone", icon: "i-mic" },
  { kind: "audiooutput", key: "speaker", label: "Speakers", icon: "i-speaker" },
];
const canPickSpeaker = "setSinkId" in HTMLMediaElement.prototype;

function buildDevicePickers(container) {
  container.innerHTML = "";
  for (const k of KINDS) {
    const f = el("label", "field");
    f.append(el("span", null, k.label));
    const w = el("span", "select-wrap");
    const sel = document.createElement("select");
    sel.dataset.kind = k.key;
    sel.setAttribute("aria-label", k.label);
    w.append(icon(k.icon), sel);
    f.append(w);
    if (k.key === "mic") { const m = el("span", "meter"); m.append(el("i")); f.append(m); }
    container.append(f);
  }
}

async function refreshDevices() {
  let list = [];
  try { list = await navigator.mediaDevices.enumerateDevices(); } catch { /* no devices API */ }
  const current = { cam: state.pipe.camId, mic: state.pipe.micId, speaker: state.sinkId || "default" };
  for (const k of KINDS) {
    const devs = list.filter((d) => d.kind === k.kind && d.deviceId);
    for (const sel of $$(`select[data-kind="${k.key}"]`)) {
      sel.innerHTML = "";
      if (k.key === "speaker" && !canPickSpeaker) {
        sel.append(new Option("Set by your system", ""));
        sel.disabled = true;
        continue;
      }
      if (!devs.length || devs.every((d) => !d.label)) { sel.append(new Option(k.key === "speaker" ? "System default" : `Turn your ${k.label.toLowerCase()} on to choose`, "")); sel.disabled = k.key !== "speaker"; continue; }
      sel.disabled = false;
      devs.forEach((d, i) => sel.append(new Option(d.label || `${k.label} ${i + 1}`, d.deviceId)));
      if (current[k.key] && devs.some((d) => d.deviceId === current[k.key])) sel.value = current[k.key];
    }
  }
}

async function switchDevice(kind, id) {
  try {
    if (kind === "cam") {
      if (state.cam) await state.pipe.openCamera(id); // otherwise it's used next time you turn it on
    } else if (kind === "mic") {
      if (state.pipe.micStream) await swapMic(id);
    } else if (kind === "speaker") {
      state.sinkId = id;
      for (const v of $$("#tiles video, #spotlight video", stageEl())) if (v.setSinkId) v.setSinkId(id).catch(() => {});
    }
    state.devices[kind] = id;
    saveDevices();
    refreshDevices();
  } catch (e) {
    toast(kind === "cam" ? "That camera couldn't be opened. Is another app using it?" : "That device couldn't be opened.");
    refreshDevices();
  }
}

// open (or switch) the microphone and tell the call about the new track
async function swapMic(id) {
  const { oldTrack, newTrack, stop } = await state.pipe.openMic(id);
  if (state.room && oldTrack) state.room.replaceTrack(oldTrack, newTrack);
  else if (state.room && !oldTrack) state.room.addStream(state.pipe.stream, { metadata: { kind: "camera" } });
  stop();
  hookMic();
}

// joining needs a working microphone (you still join muted)
async function ensureMic() {
  if (state.pipe.micStream) return true;
  try { await swapMic(state.devices.mic); refreshDevices(); return true; }
  catch (e) {
    state.micError = e && e.name;
    return false;
  }
}

function showHint(text) { if (text && state.inCall) { toast(text, 6000); return; } const h = $("#cam-hint"); h.textContent = text; h.hidden = !text; }

// microphone level: meters in the pickers, the speaking ring, and the recording mix
let micAnalyser = null;
function hookMic() {
  const ms = state.pipe.micStream;
  micAnalyser = null;
  if (!ms) return;
  try {
    const a = state.audio.createAnalyser(); a.fftSize = 512;
    state.audio.createMediaStreamSource(ms).connect(a);
    micAnalyser = a;
    if (state.me) state.me.analyser = a;
  } catch { /* no audio */ }
  // record what others hear (silent while you're muted), not the raw microphone
  if (state.recorder && state.pipe.sendTrack) { state.recorder.removeAudio("me"); state.recorder.addAudio("me", new MediaStream([state.pipe.sendTrack])); }
}

// the small arrow next to the mic and camera buttons: a menu of devices, like in Meet
async function openDeviceMenu(btn) {
  const menu = $("#dev-menu");
  if (!menu.hidden && menu.dataset.for === btn.dataset.menu) { closeDeviceMenu(); return; }
  closeDeviceMenu();
  let list = [];
  try { list = await navigator.mediaDevices.enumerateDevices(); } catch { /* none */ }
  const groups = btn.dataset.menu === "cam" ? [KINDS[0]] : [KINDS[1], ...(canPickSpeaker ? [KINDS[2]] : [])];
  const current = { cam: state.pipe.camId, mic: state.pipe.micId, speaker: state.sinkId || "default" };
  menu.innerHTML = "";
  for (const k of groups) {
    menu.append(el("h3", null, k.label));
    const devs = list.filter((d) => d.kind === k.kind && d.deviceId);
    if (!devs.length || devs.every((d) => !d.label)) { menu.append(el("p", "empty", k.key === "cam" ? "Turn your camera on to choose one." : "Turn your microphone on to choose one.")); continue; }
    const hasCurrent = devs.some((d) => d.deviceId === current[k.key]);
    devs.forEach((d, i) => {
      const item = el("button");
      item.type = "button";
      item.setAttribute("role", "menuitemradio");
      const on = hasCurrent ? d.deviceId === current[k.key] : i === 0;
      item.setAttribute("aria-checked", String(on));
      item.append(icon("i-check"), el("span", null, d.label || `${k.label} ${i + 1}`));
      item.addEventListener("click", () => { closeDeviceMenu(); if (!on) switchDevice(k.key, d.deviceId); });
      menu.append(item);
    });
  }
  menu.dataset.for = btn.dataset.menu;
  menu.hidden = false;
  btn.setAttribute("aria-expanded", "true");
  // sit just above the dock, lined up with the button
  const r = btn.closest(".split").getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, r.left))}px`;
  if (r.top > h + 20) { menu.style.top = "auto"; menu.style.bottom = `${innerHeight - r.top + 10}px`; }
  else { menu.style.bottom = "auto"; menu.style.top = `${Math.min(r.bottom + 10, innerHeight - h - 12)}px`; }
  const first = menu.querySelector('[aria-checked="true"]') || menu.querySelector("button");
  if (first) first.focus();
}
function closeDeviceMenu() {
  const menu = $("#dev-menu");
  if (menu.hidden) return;
  menu.hidden = true;
  $$("[data-menu]").forEach((b) => b.setAttribute("aria-expanded", "false"));
}

// the home page headline: "just us." with your live (processed) camera showing through the letters
function heroWord() {
  const c = $("#hero-word");
  if (!c) return;
  const g = c.getContext("2d");
  let fit = null;
  const draw = () => {
    if (state.inCall) return;
    requestAnimationFrame(draw);
    if (document.hidden || c.offsetParent === null) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
    if (!W || !H) return;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; fit = null; }
    const word = codeFromHash() ? "join us." : "just us.";
    if (!fit || fit.word !== word) {
      g.font = '700 100px "Instrument Sans"';
      const m = g.measureText(word);
      const size = Math.min((100 * W) / m.width, (100 * H * 0.98) / (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent));
      g.font = `700 ${size}px "Instrument Sans"`;
      const mm = g.measureText(word);
      fit = { word, size, x: 0, y: (H + mm.actualBoundingBoxAscent - mm.actualBoundingBoxDescent) / 2 };
    }
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, W, H);
    g.font = `700 ${fit.size}px "Instrument Sans"`;
    g.fillStyle = "#e7eee9";
    g.fillText(word, fit.x, fit.y);
    const src = state.pipe.out;
    const live = state.cam && state.pipe.camOn && !state.pipe.showingCard && src.width > 0;
    // "That's you, live" only makes sense while your camera fills the letters
    const cap = $("#word-caption");
    if (cap && cap.style.visibility !== (live ? "visible" : "hidden")) cap.style.visibility = live ? "visible" : "hidden";
    if (live) {
      g.globalCompositeOperation = "source-in";
      const sc = Math.max(W / src.width, H / src.height);
      const dw = src.width * sc, dh = src.height * sc;
      g.save(); g.translate(W, 0); g.scale(-1, 1);
      g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
      g.restore();
      g.globalCompositeOperation = "source-over";
    }
  };
  document.fonts.load('700 100px "Instrument Sans"').finally(() => requestAnimationFrame(draw));
}

/* ---------------- tiles and layout ---------------- */

// a live mirror of your processed video (several places can show it at once)
function makeLocalView(mirror) {
  const c = document.createElement("canvas");
  c.className = "local-view" + (mirror ? " mirror" : "");
  c.width = state.pipe.out.width; c.height = state.pipe.out.height;
  const g = c.getContext("2d");
  const draw = () => {
    if (!c.isConnected) return;
    if (c.width !== state.pipe.out.width || c.height !== state.pipe.out.height) { c.width = state.pipe.out.width; c.height = state.pipe.out.height; }
    g.drawImage(state.pipe.out, 0, 0);
    // your camera is shown mirrored, like a mirror; the "camera off" card has text, so it isn't
    if (mirror) c.classList.toggle("mirror", !state.pipe.showingCard);
    // drawn by the window it's in (the picture-in-picture window keeps going when this tab is hidden)
    (c.ownerDocument.defaultView || window).requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return c;
}

// key: a person's id, or "screen:" + id for their shared screen
function makeTile(key, { screen = false, me = false } = {}) {
  const li = el("li", "tile" + (me ? " me" : "") + (screen ? " screen" : ""));
  li.dataset.key = key;
  const media = el("div", "tile-media");
  const label = el("p", "tile-name");
  const muted = el("span", "muted-icon");
  muted.append(icon("i-mic-off"));
  muted.setAttribute("aria-label", "Microphone off");
  label.append(muted, el("span"));
  const hand = el("span", "hand-badge");
  hand.append(icon("i-hand"), el("span", null, "Hand raised"));
  const actions = el("div", "tile-actions");
  const pin = el("button", "round glass");
  pin.type = "button"; pin.dataset.act = "pin"; pin.setAttribute("aria-pressed", "false"); pin.setAttribute("aria-label", "Pin"); pin.title = "Pin";
  pin.append(icon("i-pin"));
  const full = el("button", "round glass");
  full.type = "button"; full.dataset.act = "full"; full.setAttribute("aria-label", "Full screen"); full.title = "Full screen";
  full.append(icon("i-expand"));
  actions.append(pin, full);
  li.append(media, hand, label, actions);
  $("#tiles", stageEl()).appendChild(li);
  return li;
}

function setMedia(li, node) {
  const media = $(".tile-media", li);
  if (media.firstChild === node) return;
  media.innerHTML = "";
  media.appendChild(node);
}

function placeholder(name) {
  const ph = el("div", "placeholder");
  ph.append(el("span", null, (name || "?").slice(0, 1).toUpperCase()));
  return ph;
}

function renderTile(id) {
  const p = person(id);
  if (!p) return;
  const me = id === state.selfId;
  if (!p.tile) p.tile = makeTile(id, { me });
  const li = p.tile;
  if (me) { if (!$(".tile-media canvas", li)) setMedia(li, makeLocalView(true)); }
  else if (p.video) setMedia(li, p.video);
  else if (!$(".tile-media > *", li)) setMedia(li, placeholder(p.name));
  $(".tile-name span:last-child", li).textContent = (p.name || "Guest") + (me ? " (you)" : "");
  li.classList.toggle("mic-off", p.mic === false);
  li.classList.toggle("hand", !!p.hand);
  layout();
}

function renderScreenTile(id) {
  const me = id === state.selfId;
  const holder = me ? state : state.peers.get(id);
  const sc = me ? (state.screen && { stream: state.screen, video: state.screenVideo }) : holder && holder.screen;
  if (!sc || !sc.video) return;
  let li = me ? state.screenTile : sc.tile;
  if (!li) {
    li = makeTile("screen:" + id, { screen: true });
    if (me) state.screenTile = li; else sc.tile = li;
    // a new screen share takes the spotlight unless you've pinned something
    state.autoSpot = "screen:" + id;
  }
  setMedia(li, sc.video);
  $(".tile-name span:last-child", li).textContent = me ? "You are presenting" : `${nameOf(id)} is presenting`;
  layout();
}

function removeScreenTile(id) {
  const me = id === state.selfId;
  const li = me ? state.screenTile : state.peers.get(id) && state.peers.get(id).screen && state.peers.get(id).screen.tile;
  if (li) li.remove();
  if (me) state.screenTile = null;
  const key = "screen:" + id;
  if (state.pinned === key) state.pinned = null;
  if (state.autoSpot === key) state.autoSpot = null;
  layout();
}

function removeTile(id) {
  const p = state.peers.get(id);
  if (p && p.tile) p.tile.remove();
  if (state.pinned === id) state.pinned = null;
  layout();
}

function allTiles() { return $$("#tiles .tile, #spotlight .tile", stageEl()); }

function layout() {
  const tiles = allTiles();
  // what gets the big spot: your pin, else the newest shared screen
  let spotKey = state.pinned && tiles.some((t) => t.dataset.key === state.pinned) ? state.pinned : null;
  if (!spotKey && state.autoSpot && tiles.some((t) => t.dataset.key === state.autoSpot)) spotKey = state.autoSpot;
  if (!spotKey) { const s = tiles.find((t) => t.classList.contains("screen")); if (s) spotKey = s.dataset.key; }
  // only worth a spotlight when someone else is around, or you're sharing
  if (spotKey && tiles.length < 2) spotKey = null;
  const spot = $("#spotlight", stageEl()), list = $("#tiles", stageEl());
  for (const t of tiles) {
    const target = t.dataset.key === spotKey ? spot : list;
    if (t.parentElement !== target) {
      target.appendChild(t);
      const v = $("video", t); if (v) v.play().catch(() => {});
    }
    const pin = $('[data-act="pin"]', t);
    const on = state.pinned === t.dataset.key;
    pin.setAttribute("aria-pressed", String(on));
    pin.setAttribute("aria-label", on ? "Unpin" : "Pin");
    pin.title = on ? "Unpin" : "Pin";
  }
  spot.hidden = !spotKey;
  stageEl().classList.toggle("has-spot", !!spotKey);
  const n = $$("#tiles .tile", stageEl()).length;
  list.dataset.n = String(Math.min(n, 7));
  const people = 1 + state.peers.size;
  $("#count").textContent = people === 1 ? "Just you" : `${people} in the call`;
  $("#people-n").textContent = String(people);
  if (state.panel === "people") renderPeople();
}

function onTileAction(e) {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const li = b.closest(".tile");
  if (b.dataset.act === "pin") {
    state.pinned = state.pinned === li.dataset.key ? null : li.dataset.key;
    if (!state.pinned) state.autoSpot = null;
    layout();
  } else if (b.dataset.act === "full") {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (li.requestFullscreen) li.requestFullscreen().catch(() => toast("Full screen isn't available here."));
  }
}

/* ---------------- audio: speaking rings and recording mix ---------------- */

function watchLevel(id, stream) {
  if (!stream.getAudioTracks().length) return;
  const a = state.audio.createAnalyser();
  a.fftSize = 512;
  try { state.audio.createMediaStreamSource(stream).connect(a); } catch { return; }
  const p = person(id);
  if (p) p.analyser = a;
}

const levelBuf = new Float32Array(512);
function rms(a) {
  a.getFloatTimeDomainData(levelBuf);
  let sum = 0;
  for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
  return Math.sqrt(sum / levelBuf.length);
}
let meterLevel = 0;
function speakingLoop() {
  requestAnimationFrame(speakingLoop);
  if (micAnalyser) {
    meterLevel = meterLevel * 0.7 + Math.min(1, rms(micAnalyser) * 9) * 0.3;
    const w = state.mic ? `${Math.round(meterLevel * 100)}%` : "0%";
    for (const m of $$(".meter i")) if (m.offsetParent !== null && m.style.width !== w) m.style.width = w;
    const lvl = state.mic ? meterLevel.toFixed(2) : "0";
    for (const b of $$('[data-toggle="mic"]')) if (b.style.getPropertyValue("--lvl") !== lvl) b.style.setProperty("--lvl", lvl);
  }
  if (!state.inCall) return;
  mutedReminder();
  const all = [[state.selfId, state.me], ...state.peers];
  for (const [, p] of all) {
    if (!p || !p.analyser || !p.tile) continue;
    p.level = (p.level || 0) * 0.8 + rms(p.analyser) * 0.2;
    p.tile.classList.toggle("speaking", p.mic !== false && p.level > 0.015);
  }
  if (state.recorder && state.recorder.recording) {
    const tiles = [];
    if (state.screen && state.screenVideo) tiles.push({ source: state.screenVideo, name: `${state.name}'s screen`, big: true, contain: true });
    for (const [id, p] of state.peers) if (p.screen && p.screen.video) tiles.push({ source: p.screen.video, name: `${nameOf(id)}'s screen`, big: !tiles.some((t) => t.big), contain: true });
    tiles.push({ source: state.pipe.out, name: state.name });
    for (const [, p] of state.peers) if (p.video) tiles.push({ source: p.video, name: p.name || "Guest" });
    state.recorder.frame(tiles);
    const secs = Math.floor((performance.now() - state.recorder.startedAt) / 1000);
    const t = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    if ($("#rec-time").textContent !== t) $("#rec-time").textContent = t;
  }
}

// you're talking but muted: say so (once in a while, never nagging)
let talkingSince = 0, lastHint = 0;
function mutedReminder() {
  if (state.mic || !state.pipe.settings.mutedHint || !micAnalyser) { talkingSince = 0; return; }
  const now = performance.now();
  if (meterLevel > 0.3) {
    if (!talkingSince) talkingSince = now;
    if (now - talkingSince > 700 && now - lastHint > 20000) {
      lastHint = now;
      toast(`You're muted. Press ${/Mac/.test(navigator.platform) ? "Cmd" : "Ctrl"}+D to unmute, or hold Space to talk.`, 4500);
    }
  } else talkingSince = 0;
}

/* ---------------- room ---------------- */

function newVideo(muted) {
  const v = document.createElement("video");
  v.autoplay = true; v.playsInline = true; v.muted = !!muted;
  if (!muted && state.sinkId && v.setSinkId) v.setSinkId(state.sinkId).catch(() => {});
  return v;
}

function joinRoom(code) {
  state.code = code;
  const room = join(code, { local: LOCAL, turn: state.turn || [] });
  state.room = room;
  state.selfId = room.selfId;
  state.me = { id: state.selfId, name: state.name, mic: state.mic, cam: state.cam, hand: state.hand };
  const hello = room.makeAction("hello");
  const status = room.makeAction("status");
  const rec = room.makeAction("rec");
  const share = room.makeAction("share");
  const chat = room.makeAction("chat");
  state.actions = { hello, status, rec, share, chat };

  const me = () => ({ name: state.name, mic: state.mic, cam: state.cam, hand: state.hand, away: state.pipe.away, rec: !!(state.recorder && state.recorder.recording), share: state.screen ? state.screen.id : null });

  hello.onMessage = (d, { peerId }) => {
    dlog(`hello from ${peerId}`);
    const p = state.peers.get(peerId) || { id: peerId };
    p.name = String((d && d.name) || "Guest").slice(0, 20);
    p.mic = d.mic !== false; p.cam = d.cam !== false; p.hand = !!d.hand; p.away = !!d.away;
    if (d.share) p.shareId = d.share;
    const isNew = !state.peers.has(peerId) || !p.greeted;
    p.greeted = true;
    state.peers.set(peerId, p);
    if (isNew) { toast(`${p.name} joined`); say(`${p.name} joined the call`); }
    if (d.rec) setRecBy(peerId, true);
    renderTile(peerId);
  };
  status.onMessage = (d, { peerId }) => {
    const p = state.peers.get(peerId);
    if (!p) return;
    const raised = !p.hand && d.hand;
    p.mic = d.mic !== false; p.cam = d.cam !== false; p.hand = !!d.hand; p.away = !!d.away;
    if (raised) { toast(`${p.name || "Someone"} raised their hand`); say(`${p.name || "Someone"} raised their hand`); }
    renderTile(peerId);
  };
  rec.onMessage = (d, { peerId }) => setRecBy(peerId, !!d.on);
  share.onMessage = (d, { peerId }) => {
    const p = state.peers.get(peerId);
    if (!p) return;
    if (d.on) { p.shareId = d.id; say(`${p.name || "Someone"} started presenting`); }
    else { p.shareId = null; if (p.screen) { removeScreenTile(peerId); p.screen = null; } }
  };
  chat.onMessage = (d, { peerId }) => {
    const text = String((d && d.text) || "").slice(0, 500);
    if (text) addMessage(nameOf(peerId), text, false);
  };

  // Adding video makes the connection renegotiate. If both people do it at the same moment
  // ("glare"), Safari on iPhone drops the connection, it reconnects, and the call flickers
  // between one and two people. So only one side starts: the one with the smaller id sends
  // straight away, the other sends once that video has arrived (or after 4 s at most).
  state.mediaWait = new Map();
  const sendMedia = (peerId) => {
    const t = state.mediaWait.get(peerId);
    if (t === "sent" || !state.room || state.room !== room) return;
    clearTimeout(t);
    state.mediaWait.set(peerId, "sent");
    dlog(`sending my video to ${peerId}`);
    room.addStream(state.pipe.stream, { target: peerId, metadata: { kind: "camera" } });
    if (state.screen) room.addStream(state.screen, { target: peerId, metadata: { kind: "screen" } });
  };
  room.onPeerJoin = (peerId) => {
    dlog(`peer ${peerId} joined`);
    if (state.peers.size + 1 >= MAX_PEOPLE && !state.peers.has(peerId)) toast("This call is full (6 people).");
    hello.send(me(), { target: peerId });
    state.mediaWait.delete(peerId);
    if (state.selfId < peerId) sendMedia(peerId);
    else state.mediaWait.set(peerId, setTimeout(() => sendMedia(peerId), 4000));
  };
  room.onPeerLeave = (peerId) => {
    dlog(`peer ${peerId} left`);
    clearTimeout(state.mediaWait.get(peerId));
    state.mediaWait.delete(peerId);
    const p = state.peers.get(peerId);
    if (p) { toast(`${p.name || "Someone"} left`); say(`${p.name || "Someone"} left the call`); }
    setRecBy(peerId, false);
    if (p && p.screen) removeScreenTile(peerId);
    removeTile(peerId);
    if (state.recorder) { state.recorder.removeAudio(peerId); state.recorder.removeAudio("screen:" + peerId); }
    state.peers.delete(peerId);
    layout();
  };
  room.onPeerStream = (stream, peerId, meta) => {
    dlog(`video from ${peerId}${meta && meta.kind ? " (" + meta.kind + ")" : ""}`);
    // their video arrived, so it's our turn (once their renegotiation has settled)
    if (state.mediaWait.has(peerId) && state.mediaWait.get(peerId) !== "sent") setTimeout(() => sendMedia(peerId), 600);
    const p = state.peers.get(peerId) || { id: peerId, name: "Guest", mic: true, cam: true };
    state.peers.set(peerId, p);
    const isScreen = (meta && meta.kind === "screen") || (p.shareId && stream.id === p.shareId);
    if (isScreen) {
      if (!p.screen) p.screen = { id: stream.id };
      if (p.screen.stream !== stream) {
        p.screen.stream = stream;
        if (!p.screen.video) p.screen.video = newVideo(false);
        p.screen.video.srcObject = stream;
        p.screen.video.play().catch(() => {});
        if (state.recorder) state.recorder.addAudio("screen:" + peerId, stream);
        toast(`${p.name || "Someone"} is presenting`);
      }
      renderScreenTile(peerId);
      return;
    }
    if (!p.video) p.video = newVideo(false);
    if (p.stream !== stream) {
      p.stream = stream;
      p.video.srcObject = stream;
      p.video.play().catch(() => toast("Tap anywhere to hear everyone", 5000));
      watchLevel(peerId, stream);
      if (state.recorder) state.recorder.addAudio(peerId, stream);
    }
    renderTile(peerId);
  };
  room.addStream(state.pipe.stream, { metadata: { kind: "camera" } });
  state.broadcastStatus = () => status.send({ mic: state.mic, cam: state.cam, hand: state.hand, away: state.pipe.away });
}

// sharp video like Meet: give the camera a generous bitrate, shared out as the call grows
// (everyone sends a separate copy to each person, so more people means less per copy)
function tuneBitrate() {
  if (!state.room || !state.room.connections) return;
  const n = Math.max(1, state.peers.size);
  const bps = n === 1 ? 2_500_000 : n === 2 ? 1_800_000 : n === 3 ? 1_300_000 : 1_000_000;
  const camTrack = state.pipe.stream.getVideoTracks()[0];
  for (const pc of state.room.connections()) {
    for (const snd of pc.getSenders ? pc.getSenders() : []) {
      if (snd.track !== camTrack) continue;
      const p = snd.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      if (p.encodings[0].maxBitrate === bps) continue;
      p.encodings[0].maxBitrate = bps;
      p.degradationPreference = "balanced";
      snd.setParameters(p).catch(() => {});
    }
  }
}
setInterval(tuneBitrate, 3000);

function setRecBy(id, on) {
  if (on) state.recBy.set(id, true); else state.recBy.delete(id);
  const names = [...state.recBy.keys()].map((k) => (k === state.selfId ? "You are" : `${nameOf(k)} is`));
  $("#rec-badge").hidden = !names.length;
  $("#rec-text").textContent = names.length ? `${names.join(", ")} recording` : "";
  if (on && id !== state.selfId) say(`${nameOf(id)} started recording`);
}

/* ---------------- screen sharing ---------------- */

async function toggleShare() {
  if (state.screen) { stopShare(); return; }
  if (!navigator.mediaDevices.getDisplayMedia) { toast("Screen sharing isn't supported in this browser."); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true }); }
  catch (e) { if (e && e.name !== "NotAllowedError" && e.name !== "AbortError") toast("Screen sharing couldn't start."); return; }
  state.screen = stream;
  state.screenVideo = newVideo(true);
  state.screenVideo.srcObject = stream;
  state.screenVideo.play().catch(() => {});
  const v = stream.getVideoTracks()[0];
  if (v) { v.contentHint = "detail"; v.addEventListener("ended", stopShare); }
  state.room.addStream(stream, { metadata: { kind: "screen" } });
  state.actions.share.send({ on: true, id: stream.id });
  if (state.recorder && stream.getAudioTracks().length) state.recorder.addAudio("screen:me", stream);
  $("#share-btn").setAttribute("aria-pressed", "true");
  $("#share-btn").setAttribute("aria-label", "Stop sharing");
  $("#share-btn").title = "Stop sharing";
  renderScreenTile(state.selfId);
  say("You are presenting");
}

function stopShare() {
  const stream = state.screen;
  if (!stream) return;
  state.screen = null;
  try { state.room.removeStream(stream); } catch { /* already gone */ }
  stream.getTracks().forEach((t) => t.stop());
  state.actions.share.send({ on: false });
  if (state.recorder) state.recorder.removeAudio("screen:me");
  $("#share-btn").setAttribute("aria-pressed", "false");
  $("#share-btn").setAttribute("aria-label", "Share your screen");
  $("#share-btn").title = "Share your screen";
  removeScreenTile(state.selfId);
  state.screenVideo = null;
}

/* ---------------- chat, people, settings panel ---------------- */

const PANEL_TITLES = { chat: "Chat", people: "People", settings: "Camera, microphone, speakers" };

function openPanel(which) {
  if (state.panel === which) { closePanel(); return; }
  closeFx();
  state.panel = which;
  $("#side-panel").hidden = false;
  document.body.classList.add("panel-open");
  $("#side-title").textContent = PANEL_TITLES[which];
  for (const k of Object.keys(PANEL_TITLES)) $("#pane-" + k).hidden = k !== which;
  $$("[data-panel]").forEach((b) => b.setAttribute("aria-expanded", String(b.dataset.panel === which)));
  if (which === "chat") { state.unread = 0; $("#chat-dot").hidden = true; const m = $("#messages"); m.scrollTop = m.scrollHeight; $("#chat-input").focus(); }
  if (which === "people") renderPeople();
  if (which === "settings") refreshDevices();
}
function closePanel() {
  state.panel = null;
  $("#side-panel").hidden = true;
  if ($("#fx-panel").hidden) document.body.classList.remove("panel-open");
  $$("[data-panel]").forEach((b) => b.setAttribute("aria-expanded", "false"));
}

function addMessage(who, text, mine) {
  const li = el("li", mine ? "mine" : "");
  const meta = el("p", "meta");
  const strong = el("strong", null, mine ? "You" : who);
  const d = new Date();
  meta.append(strong, document.createTextNode(`${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`));
  const body = el("p", "text", text);
  li.append(meta, body);
  const list = $("#messages");
  const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.append(li);
  if (atEnd || mine) list.scrollTop = list.scrollHeight;
  if (!mine && state.panel !== "chat") {
    state.unread++;
    $("#chat-dot").hidden = false;
    toast(`${who}: ${text.length > 70 ? text.slice(0, 70) + "..." : text}`, 4000);
  }
  if (!mine) say(`${who} says: ${text}`);
}

function renderPeople() {
  const ul = $("#people-list");
  ul.innerHTML = "";
  const rows = [[state.selfId, state.me], ...state.peers];
  for (const [id, p] of rows) {
    if (!p) continue;
    const li = el("li");
    const av = el("span", "avatar", (p.name || "?").slice(0, 1).toUpperCase());
    const who = el("span", "who", p.name || "Guest");
    if (id === state.selfId) who.append(el("small", null, "You"));
    if ((id === state.selfId ? state.pipe.away : p.away)) who.append(el("small", null, "Stepped away"));
    const st = el("span", "state");
    if (p.hand) { const h = icon("i-hand"); h.classList.add("hand"); h.setAttribute("aria-hidden", "false"); h.setAttribute("aria-label", "Hand raised"); st.append(h); }
    const m = icon(p.mic === false ? "i-mic-off" : "i-mic"); if (p.mic === false) m.classList.add("off"); st.append(m);
    const c = icon(p.cam === false ? "i-cam-off" : "i-cam"); if (p.cam === false) c.classList.add("off"); st.append(c);
    li.append(av, who, st);
    ul.append(li);
  }
}

/* ---------------- controls ---------------- */

async function setMic(on) {
  if (on && !(await ensureMic())) {
    showHint(state.micError === "NotAllowedError" ? "Microphone blocked. Allow it in the address bar (the camera icon), then try again." : "No microphone found. Plug one in and try again.");
    on = false;
  }
  state.mic = on;
  state.pipe.setMic(on);
  if (state.me) state.me.mic = on;
  $$('[data-toggle="mic"]').forEach((b) => { b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", on ? "Turn off microphone" : "Turn on microphone"); $("use", b).setAttribute("href", on ? "#i-mic" : "#i-mic-off"); b.classList.toggle("off", !on); });
  if (state.inCall) { renderTile(state.selfId); state.broadcastStatus(); }
  if (state.pip) state.pip.sync();
}
async function setCam(on) {
  if (on) {
    try { await state.pipe.setCam(true, state.devices.cam); showHint(""); refreshDevices(); }
    catch (e) {
      showHint(e && e.name === "NotAllowedError" ? "Camera blocked. Allow it in the address bar (the camera icon), then try again." : "Your camera couldn't be opened. Is another app using it?");
      on = false;
    }
  } else state.pipe.setCam(false);
  state.cam = on;
  if (state.me) state.me.cam = on;
  $$('[data-toggle="cam"]').forEach((b) => { b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", on ? "Turn off camera" : "Turn on camera"); $("use", b).setAttribute("href", on ? "#i-cam" : "#i-cam-off"); b.classList.toggle("off", !on); });
  if (state.inCall) { state.broadcastStatus(); if (state.panel === "people") renderPeople(); }
  if (state.pip) state.pip.sync();
}
function setHand(on) {
  state.hand = on;
  if (state.me) state.me.hand = on;
  const b = $("#hand-btn");
  b.setAttribute("aria-pressed", String(on));
  b.setAttribute("aria-label", on ? "Lower hand" : "Raise hand");
  b.title = on ? "Lower hand" : "Raise hand";
  if (state.inCall) { renderTile(state.selfId); state.broadcastStatus(); }
}

async function toggleRecording() {
  if (!state.recorder.supported) { toast("Recording isn't supported in this browser."); return; }
  if (state.recorder.recording) {
    const blob = await state.recorder.stop();
    $("#rec-btn").setAttribute("aria-pressed", "false");
    $("#rec-btn").setAttribute("aria-label", "Record");
    $("#rec-time").hidden = true;
    setRecBy(state.selfId, false);
    state.actions.rec.send({ on: false });
    if (blob && blob.size) {
      state.lastRecording = blob;
      const mb = (blob.size / 1e6).toFixed(1);
      $("#saved-info").textContent = `${mb} MB, kept in this browser for now. If you close it without saving, it's gone.`;
      $("#saved-dialog").showModal();
    }
    return;
  }
  const d = $("#rec-dialog");
  d.returnValue = "";
  d.showModal();
  d.addEventListener("close", function onClose() {
    d.removeEventListener("close", onClose);
    if (d.returnValue !== "ok") return;
    if (!state.recorder.start()) { toast("Recording couldn't start."); return; }
    $("#rec-btn").setAttribute("aria-pressed", "true");
    $("#rec-btn").setAttribute("aria-label", "Stop recording");
    $("#rec-time").hidden = false;
    setRecBy(state.selfId, true);
    state.actions.rec.send({ on: true });
  });
}

function saveRecording() {
  const blob = state.lastRecording;
  if (!blob) return;
  const d = new Date();
  const ext = blob.type.includes("mp4") ? "mp4" : "webm";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `konvene-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}.${ext}`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  $("#saved-dialog").close();
}

async function invite() {
  const url = link(state.code);
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try { await navigator.share({ title: "Join my Konvene", url }); return; } catch { /* cancelled */ }
  }
  try { await navigator.clipboard.writeText(url); toast("Invite link copied"); }
  catch { toast(url, 8000); }
}

function buildReactions() {
  const pop = $("#react-pop");
  for (const r of REACTIONS) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "react"; b.textContent = r;
    b.setAttribute("aria-label", `React with ${r}`);
    b.addEventListener("click", () => { state.pipe.react(r); });
    pop.appendChild(b);
  }
  const btn = $("#react-btn");
  btn.addEventListener("click", () => {
    const open = pop.hidden;
    pop.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  });
  addEventListener("click", (e) => { if (!e.target.closest(".react-wrap")) { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
}

/* ---------------- start ---------------- */

const SESSION_KEY = "konvene_call";
function rememberCall(code) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, name: state.name })); } catch { /* private */ } }
function rememberedCall() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { return null; } }
function forgetCall() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* private */ } }

// three screens: home (/), the pre-join check (/abc-def-ghj) and the call itself
const AV_KEY = "konvene_av";
function loadAv() { try { return JSON.parse(localStorage.getItem(AV_KEY) || "{}"); } catch { return {}; } }
function saveAv() { try { localStorage.setItem(AV_KEY, JSON.stringify({ mic: state.mic, cam: state.cam })); } catch { /* private */ } }
function screen(name) {
  document.body.dataset.screen = name;
  $("#prejoin").hidden = name !== "home";
  $("#lobby").hidden = name !== "lobby";
  $("#call").hidden = name !== "call";
  closeDeviceMenu();
}
function showHome() {
  closeFx();
  for (const v of $$("#lobby-preview canvas")) v.remove();
  screen("home");
  // the home page has no camera or microphone: turn off anything the pre-join page opened
  if (state.pipe.running) { if (state.cam) setCam(false); if (state.mic) setMic(false); }
}
// before joining: a big preview, mic and camera with device choices, effects and your name.
// Your last choices (devices, on or off, effects, name) come back from local storage.
function showLobby(code) {
  state.code = code;
  const isNew = state.newCode === code;
  $("#lobby-title").textContent = isNew ? "Ready to start?" : "Ready to join?";
  $("#lobby-sub").textContent = isNew
    ? "Check how you look and sound. Once you're in, share the link and people can join."
    : "You've been invited to a private call. Check how you look and sound. Only you can see this until you join.";
  $("#join-btn").textContent = isNew ? "Start call" : "Join now";
  $("#lobby-code").textContent = code;
  if (!$("#lobby-preview canvas")) $("#lobby-preview").prepend(makeLocalView(true));
  screen("lobby");
  showHint("");
  if (state.pipe.running) restoreAv();
  const n = $("#name");
  if (!n.value) n.focus({ preventScroll: true }); else $("#join-btn").focus({ preventScroll: true });
}
async function restoreAv() {
  const av = loadAv();
  if (av.cam && !state.cam) await setCam(true);
  if (av.mic && !state.mic) await setMic(true);
}
function route() {
  const code = codeFromHash();
  if (code) showLobby(code); else showHome();
}
function startCall() {
  const code = makeRoomCode();
  state.newCode = code;
  history.pushState(null, "", "/" + code + location.search);
  showLobby(code);
}

// accepts "abc-def-ghj" or a full invite link
function parseCode(text) {
  const m = String(text || "").trim().toLowerCase().match(/([a-z0-9]{3})-?([a-z0-9]{3})-?([a-z0-9]{3})\s*$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function leaveCall() {
  if (state.screen) stopShare();
  forgetCall();
  try { navigator.mediaSession.setActionHandler("enterpictureinpicture", null); } catch { /* not supported */ }
  if (state.pip) state.pip.close();
  if (state.room) state.room.leave();
  state.pipe.stop();
  location.href = "/" + location.search;
}

async function enterCall() {
  state.audio.resume();
  const code = codeFromHash() || makeRoomCode();
  const isNew = state.newCode === code;
  goTo(code);
  rememberCall(code);
  // relay servers for strict networks (asked for at page load; don't wait long for them)
  if (!LOCAL && !state.turn) state.turn = await Promise.race([state.turnReady, new Promise((r) => setTimeout(() => r([]), 2500))]);
  joinRoom(code);
  state.inCall = true;
  for (const v of $$("#lobby-preview canvas")) v.remove();
  screen("call");
  // Chrome 120+: switching to another tab opens the call in picture-in-picture (needs the mic in use, which a call always has)
  try { navigator.mediaSession.setActionHandler("enterpictureinpicture", () => state.pip.show()); } catch { /* not supported */ }
  $("#room-code").textContent = code;
  hookMic();
  renderTile(state.selfId);
  closeFx();
  $("#room-chip").focus();
  toast(isNew ? "You're live. Copy the link to invite people." : "You're in.", 4000);
}

async function init() {
  state.audio = new (window.AudioContext || window.webkitAudioContext)();
  state.recorder = new CallRecorder(state.audio);
  Object.assign(state.pipe.settings, loadFx());
  try { $("#name").value = localStorage.getItem("gr_name") || ""; } catch { /* private */ }
  state.pipe.name = $("#name").value;
  const code = codeFromHash();
  if (code && location.hash) goTo(code); // tidy an old #abc-def-ghj link into /abc-def-ghj
  const again = rememberedCall();
  const rejoin = !!(again && code && again.code === code && again.name);
  if (!rejoin) route();
  $("#start-btn").addEventListener("click", startCall);
  $("#cta-start").addEventListener("click", startCall);
  $("#code-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const c = parseCode($("#code-input").value);
    if (!c) { toast("That doesn't look like a call code. It looks like abc-def-ghj."); return; }
    history.pushState(null, "", "/" + c + location.search);
    showLobby(c);
  });
  // Back goes from the pre-join page to home. During a call it does nothing (Leave does that).
  addEventListener("popstate", () => { if (state.inCall) history.pushState(null, "", "/" + state.code + location.search); else route(); });
  $("#lobby-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link(state.code)); toast("Call link copied"); } catch { toast(link(state.code), 8000); }
  });

  initPanel();
  buildReactions();
  buildSignatures();
  buildDevicePickers($("#call-devices"));
  buildDevicePickers($("#lobby-devices"));
  heroWord();

  state.turnReady = LOCAL ? Promise.resolve([]) : iceServers();
  await state.pipe.start();
  setMic(false); setCam(false);
  if (state.devices.speaker && canPickSpeaker) state.sinkId = state.devices.speaker;
  refreshDevices();
  if (!rejoin && document.body.dataset.screen === "lobby") restoreAv();
  // refreshing during a call puts you straight back in it (the microphone is still required)
  if (rejoin) {
    state.name = again.name; state.pipe.name = again.name; $("#name").value = again.name;
    setTimeout(async () => { if (await ensureMic()) enterCall(); else forgetCall(); }, 0);
  }
  if (navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
  document.addEventListener("change", (e) => { const s = e.target.closest("select[data-kind]"); if (s && s.value) switchDevice(s.dataset.kind, s.value); });

  // explicit choices are remembered for next time (holding Space to talk is not)
  $$('[data-toggle="mic"]').forEach((b) => b.addEventListener("click", () => setMic(!state.mic).then(saveAv)));
  $$('[data-toggle="cam"]').forEach((b) => b.addEventListener("click", () => setCam(!state.cam).then(saveAv)));
  $("#name").addEventListener("input", (e) => { state.pipe.name = e.target.value; });
  $("#join-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    state.name = ($("#name").value || "").trim().slice(0, 20) || "Guest";
    state.pipe.name = state.name;
    try { localStorage.setItem("gr_name", state.name); } catch { /* private */ }
    const btn = $("#join-btn");
    btn.disabled = true;
    const ok = await ensureMic();
    btn.disabled = false;
    if (!ok) {
      showHint(state.micError === "NotAllowedError"
        ? "Konvene needs your microphone to join. Allow it in the address bar (the camera icon), then press the button again. You can stay muted."
        : "Konvene needs a microphone to join, and none was found. Plug one in and try again.");
      return;
    }
    showHint("");
    enterCall();
  });
  state.pipe.onAway = (away) => {
    if (state.inCall) {
      state.broadcastStatus();
      if (state.panel === "people") renderPeople();
      toast(away ? "Looks like you stepped away, so your video is paused. It comes back when you do." : "Welcome back. Your video is on again.", 4500);
    }
  };
  // keyboard: the same shortcuts as Google Meet, plus hold Space to talk while muted
  let spaceTalk = false;
  addEventListener("keydown", (e) => {
    const typing = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey && (e.key === "d" || e.key === "D")) { e.preventDefault(); setMic(!state.mic).then(() => { saveAv(); toast(state.mic ? "Microphone on" : "Microphone off", 1500); }); return; }
    if (mod && !e.shiftKey && !e.altKey && (e.key === "e" || e.key === "E")) { e.preventDefault(); setCam(!state.cam).then(() => { saveAv(); toast(state.cam ? "Camera on" : "Camera off", 1500); }); return; }
    if (e.code === "Space" && !typing && state.inCall && !state.mic && !e.repeat && !e.target.closest("button")) { e.preventDefault(); spaceTalk = true; setMic(true); }
  });
  addEventListener("keyup", (e) => { if (e.code === "Space" && spaceTalk) { spaceTalk = false; setMic(false); } });
  addEventListener("blur", () => { if (spaceTalk) { spaceTalk = false; setMic(false); } });
  $("#share-btn").addEventListener("click", toggleShare);
  $("#hand-btn").addEventListener("click", () => setHand(!state.hand));
  $("#rec-btn").addEventListener("click", toggleRecording);
  $("#save-rec").addEventListener("click", saveRecording);
  $("#invite-btn").addEventListener("click", invite);
  $("#room-chip").addEventListener("click", invite);
  $$("[data-panel]").forEach((b) => b.addEventListener("click", () => openPanel(b.dataset.panel)));
  $("#side-close").addEventListener("click", closePanel);
  $$("[data-menu]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); openDeviceMenu(b); }));
  addEventListener("click", (e) => { if (!e.target.closest("#dev-menu")) closeDeviceMenu(); });
  addEventListener("resize", closeDeviceMenu);
  addEventListener("scroll", closeDeviceMenu, { passive: true });
  $("#chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = $("#chat-input");
    const text = inp.value.trim().slice(0, 500);
    if (!text || !state.actions) return;
    state.actions.chat.send({ text });
    addMessage(state.name, text, true);
    inp.value = "";
  });
  stageEl().addEventListener("click", onTileAction);
  // hanging up asks first (and warns about an unsaved recording)
  $("#leave-btn").addEventListener("click", () => {
    const d = $("#leave-dialog");
    $("#leave-d-text").textContent = state.recorder.recording
      ? "You're recording. Leaving stops the recording and it won't be saved."
      : "You can come back with the same link while the call is going.";
    d.returnValue = "";
    d.showModal();
  });
  $("#leave-dialog").addEventListener("close", () => { if ($("#leave-dialog").returnValue === "leave") leaveCall(); });

  // picture-in-picture: the Pop out button, and Chrome opens it by itself when you switch tabs
  state.pip = new Pip({
    stage: stageEl(),
    sprite: document.querySelector("body > svg"),
    ui: {
      mic: () => state.mic,
      cam: () => state.cam,
      toggleMic: () => setMic(!state.mic).then(saveAv),
      toggleCam: () => setCam(!state.cam).then(saveAv),
      leave: () => leaveCall(),
      pickVideo: () => {
        const vids = $$("#spotlight video, #tiles .tile:not(.me) video", stageEl()).filter((v) => v.videoWidth > 0);
        return vids[0] || null;
      },
      onChange: (open) => { $("#pip-btn").setAttribute("aria-pressed", String(open)); },
    },
  });
  $("#pip-btn").hidden = !(PIP_DOC || PIP_VIDEO);
  $("#pip-btn").addEventListener("click", () => {
    if (!PIP_DOC && !state.pip.ui.pickVideo()) { toast("Picture in picture starts once someone else is in the call."); return; }
    state.pip.toggle();
  });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const menu = $("#dev-menu");
    if (!menu.hidden) { const b = $(`[data-menu="${menu.dataset.for}"]`); closeDeviceMenu(); if (b) b.focus(); return; }
    if (state.panel) closePanel();
  });
  $("#dev-menu").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = $$("#dev-menu button");
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  });
  addEventListener("click", () => { state.audio.resume(); for (const v of $$("#tiles video, #spotlight video", stageEl())) if (v.paused) v.play().catch(() => {}); });
  speakingLoop();
  window.__gr = state; // for tests
}

init();
