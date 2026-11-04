import { dlog } from "./debug.js"; // first, so it sees every connection
import { Pipeline } from "./pipeline.js";
import { Pip, PIP_DOC, PIP_VIDEO } from "./pip.js";
import { Quality, TIERS, worse } from "./quality.js";
import { join, makeRoomCode, randomChars } from "./net.js";
import { iceServers, CONFIG } from "./config.js";
import { CallRecorder, clearOldRecordings } from "./recorder.js";
import { NOISE_MODES, CAN_STRONG, saveNoise } from "./sound.js";
import { initHome } from "./home.js";
import { RoomEcho } from "./roomecho.js";
import { CAN_LOCAL, findLanguage, install as installCaptions, Transcriber } from "./captions.js";
import { LOOKS, LIGHTS } from "./fx.js";
import { BACKGROUNDS } from "./backgrounds.js";
import { EXPRESSIONS, REACTIONS } from "./stickers.js";
import { LIPS, BLUSH, WARPS, FACE_DEFAULTS } from "./face.js";
import { onBeat } from "./clock.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
// the call's tiles can move into a picture-in-picture window, so look them up from the stage itself
const stageEl = () => state.stageEl || (state.stageEl = document.getElementById("stage"));
const LOCAL = new URLSearchParams(location.search).has("local");
const MAX_PEOPLE = CONFIG.maxPeople; // KONVENE_MAX_PEOPLE, 6 by default
const OFF = (f) => CONFIG.disabled.has(f); // KONVENE_DISABLE
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
  echoCards: new Map(), // id -> "same room?" card
  leakCards: new Map(), // id -> "they hear themselves from your speakers" card
  roomEcho: null,
  quiet: false, // sound off on this device: no microphone, others' audio muted (a second device in the same room)
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
  // who can get in (door section below)
  pass: "", // the call's passcode ("" for none)
  lock: false, // ask before letting people in (the waiting room)
  lockAt: 0,
  admitted: false, // are we in the call, or still asking?
  how: null, // how we got in: "host" | "admitted" | "open" (the call didn't ask)
  inAt: 0,
  pending: new Map(), // connected, but not (yet) in the call with us: id -> same shape as peers
  conn: new Set(), // everyone connected, in the call or not
  knocks: new Map(), // id -> the "wants to join" card
  denied: new Set(),
  // live captions (captions section below)
  cc: { on: false, lang: undefined, can: false, self: null, remote: new Map(), lines: new Map(), sentAt: 0 },
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
// The passcode and "ask first" ride after the #, which browsers never send to any server.
function link(code, withPass = true) {
  const q = new URLSearchParams(location.search); q.delete("debug");
  const s = q.toString().replace(/=(&|$)/g, "$1");
  const h = [];
  if (withPass && state.pass) h.push("p=" + encodeURIComponent(state.pass));
  if (state.lock) h.push("wait");
  return location.origin + "/" + code + (s ? "?" + s : "") + (h.length ? "#" + h.join("&") : "");
}
function hashParams(hash) {
  const q = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  return { pass: (q.get("p") || "").slice(0, 40), wait: q.has("wait") };
}
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
    // how your microphone is cleaned up (sound.js)
    if (k.key === "mic") {
      const n = el("label", "field");
      n.append(el("span", null, "Noise reduction"));
      const nw = el("span", "select-wrap");
      const ns = document.createElement("select");
      ns.dataset.noise = "";
      ns.setAttribute("aria-label", "Noise reduction");
      for (const m of NOISE_MODES) if (m.value !== "strong" || CAN_STRONG) ns.append(new Option(m.label, m.value));
      ns.value = state.pipe.noise;
      nw.append(icon("i-mic"), ns);
      n.append(nw, el("small", "field-hint", noiseHint(state.pipe.noise)));
      container.append(n);
    }
  }
}
function noiseHint(v) { const m = NOISE_MODES.find((x) => x.value === v); return m ? m.hint : ""; }

// standard, strong or original sound: reopen the microphone with the new setting
async function setNoise(mode) {
  if (!NOISE_MODES.some((m) => m.value === mode) || mode === state.pipe.noise) return;
  state.pipe.noise = mode;
  state.pipe.noiseFailed = false;
  saveNoise(mode);
  for (const s of $$("select[data-noise]")) { s.value = mode; const h = s.closest(".field").querySelector(".field-hint"); if (h) h.textContent = noiseHint(mode); }
  if (state.pipe.micStream) {
    try { await swapMic(state.pipe.micId || state.devices.mic); } catch { toast("The microphone couldn't be reopened."); return; }
    if (mode === "strong" && state.pipe.noiseFailed) { toast("Strong noise reduction couldn't start in this browser, so standard is on."); return; }
  }
  toast(mode === "strong" ? "Strong noise reduction on" : mode === "off" ? "Original sound on. Use headphones so others don't hear an echo." : "Standard noise reduction on", 3000);
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
  else if (state.room && !oldTrack && state.peers.size) state.room.addStream(state.pipe.stream, { target: [...state.peers.keys()], metadata: { kind: "camera" } });
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
  if (state.cc.self) state.cc.self.setTrack(state.pipe.sendTrack);
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
  if (btn.dataset.menu === "mic") {
    menu.append(el("h3", null, "Noise reduction"));
    for (const m of NOISE_MODES) {
      if (m.value === "strong" && !CAN_STRONG) continue;
      const item = el("button");
      item.type = "button";
      item.setAttribute("role", "menuitemradio");
      const on = state.pipe.noise === m.value;
      item.setAttribute("aria-checked", String(on));
      item.append(icon("i-check"), el("span", null, m.label));
      item.title = m.hint;
      item.addEventListener("click", () => { closeDeviceMenu(); setNoise(m.value); });
      menu.append(item);
    }
  }
  if (btn.dataset.menu === "mic") {
    menu.append(el("h3", null, "This device"));
    const item = el("button");
    item.type = "button";
    item.setAttribute("role", "menuitemcheckbox");
    item.setAttribute("aria-checked", String(state.quiet));
    item.dataset.quiet = "";
    item.append(icon("i-check"), el("span", null, "Sound off (another device in this room)"));
    item.title = "No microphone and no speakers on this device, so a second device in the same room doesn't echo.";
    item.addEventListener("click", () => { closeDeviceMenu(); setQuiet(!state.quiet); toast(state.quiet ? "Sound is off on this device" : "Sound is back on", 2500); });
    menu.append(item);
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


/* ---------------- tiles and layout ---------------- */

// a live mirror of your processed video (several places can show it at once)
// All of them are drawn from one beat (clock.js), not each by the window it's in: a view that moved
// into the picture-in-picture window and back used to stop for good when that window closed.
const localViews = new Map(); // canvas -> { g, mirror, lostAt }
function makeLocalView(mirror) {
  const c = document.createElement("canvas");
  c.className = "local-view" + (mirror ? " mirror" : "");
  c.width = state.pipe.out.width; c.height = state.pipe.out.height;
  localViews.set(c, { g: c.getContext("2d"), mirror, lostAt: 0 });
  drawLocalViews(performance.now());
  return c;
}
function drawLocalViews(now) {
  const out = state.pipe.out;
  for (const [c, v] of localViews) {
    // off the page for a while: it was thrown away (moving between windows takes a moment)
    if (!c.isConnected) { if (!v.lostAt) v.lostAt = now; else if (now - v.lostAt > 5000) localViews.delete(c); continue; }
    v.lostAt = 0;
    if (c.width !== out.width || c.height !== out.height) { c.width = out.width; c.height = out.height; }
    v.g.drawImage(out, 0, 0);
    // your camera is shown mirrored, like a mirror; the "camera off" card has text, so it isn't
    if (v.mirror) c.classList.toggle("mirror", !state.pipe.showingCard);
  }
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
  const quiet = el("span", "quiet-icon");
  quiet.append(icon("i-sound-off"));
  quiet.setAttribute("aria-label", "Sound off on this device");
  label.append(muted, quiet, el("span"));
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
  li.classList.toggle("quiet", me ? state.quiet : !!p.quiet);
  li.classList.toggle("hand", !!p.hand);
  if (!me) renderSignal(id);
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
  sendViews();
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
// runs on every beat (clock.js), in the background too: the speaking rings in the picture-in-picture
// window, your own tiles and the recording must keep going while you look at another tab
function speakingLoop(now) {
  drawLocalViews(now);
  if (micAnalyser) {
    const level = rms(micAnalyser);
    // talking (muted or not) means you're in front of the camera (presence.js)
    if (level > 0.02 && !state.quiet) state.pipe.heardVoice(now);
    meterLevel = meterLevel * 0.7 + Math.min(1, level * 9) * 0.3;
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
    const initial = (n) => (n || "?").trim().charAt(0).toUpperCase() || "?";
    if (state.screen && state.screenVideo) tiles.push({ source: state.screenVideo, name: `${state.name}'s screen`, big: true, contain: true });
    for (const [id, p] of state.peers) if (p.screen && p.screen.video) tiles.push({ source: p.screen.video, name: `${nameOf(id)}'s screen`, big: !tiles.some((t) => t.big), contain: true });
    const me = state.me || {};
    tiles.push({ source: state.pipe.out, name: state.name, initial: initial(state.name), micOff: !state.mic, speaking: !!(me.tile && me.tile.classList.contains("speaking")) });
    // everyone in the call, even before their video arrives (shown with their initial)
    for (const [, p] of state.peers) {
      const name = p.name || "Guest";
      tiles.push({ source: p.video && p.video.videoWidth ? p.video : null, name, initial: initial(name), micOff: p.mic === false, speaking: !!(p.tile && p.tile.classList.contains("speaking")) });
    }
    state.recorder.frame(tiles, now);
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
  v.autoplay = true; v.playsInline = true; v.muted = !!muted || state.quiet;
  if (!muted) v.dataset.remote = "1"; // someone else's sound: silent while this device's sound is off
  if (!muted && state.sinkId && v.setSinkId) v.setSinkId(state.sinkId).catch(() => {});
  return v;
}

function myStatus() {
  return { name: state.name, mic: state.mic, cam: state.cam, hand: state.hand, away: state.pipe.away, quiet: state.quiet, rec: !!(state.recorder && state.recorder.recording), share: state.screen ? state.screen.id : null };
}

function joinRoom(code) {
  state.code = code;
  const room = join(code, { local: LOCAL, turn: state.turn || [], pass: state.pass, onJoinError: (e) => wrongPass(room, e) });
  state.room = room;
  state.selfId = room.selfId;
  state.me = { id: state.selfId, name: state.name, mic: state.mic, cam: state.cam, hand: state.hand };
  state.peers.clear(); state.pending.clear(); state.conn.clear();
  const hello = room.makeAction("hello");
  const door = room.makeAction("door"); // waiting room: knock, let in, ask first on or off
  const status = room.makeAction("status");
  const rec = room.makeAction("rec");
  const share = room.makeAction("share");
  const chat = room.makeAction("chat");
  const cc = room.makeAction("cc"); // captions: who wants them, who can make them, and the words
  const linkA = room.makeAction("link"); // "this is how well I reach you"
  const viewA = room.makeAction("view"); // "I show you this many pixels wide"
  // Everything except hello and door goes only to people who are in the call with us,
  // never to someone still waiting to be let in.
  const onlyIn = (a) => ({
    send(d, o = {}) {
      const ids = (o.target != null ? [].concat(o.target) : [...state.peers.keys()]).filter((id) => state.peers.has(id));
      if (ids.length) a.send(d, { target: ids });
    },
  });
  state.actions = { hello, door, status: onlyIn(status), rec: onlyIn(rec), share: onlyIn(share), chat: onlyIn(chat), cc: onlyIn(cc), link: onlyIn(linkA), view: onlyIn(viewA) };
  const mine = (fn) => (d, meta) => { if (state.room === room) fn(d || {}, meta); };
  state.quality = new Quality({
    conns: () => (room.peerConns ? room.peerConns() : []).filter(([id]) => state.peers.has(id)),
    camTrack: () => state.pipe.stream.getVideoTracks()[0],
    out: () => ({ w: state.pipe.W, h: state.pipe.H }),
    onTier: (id, tier) => {
      dlog(`link to ${id}: ${tier}`);
      state.actions.link.send({ t: tier }, { target: id });
      renderSignal(id);
      if (tier === "bad") toast(`The connection to ${nameOf(id)} is very weak, so video between you is paused. You can still hear each other.`, 6000);
    },
  });
  linkA.onMessage = mine((d, { peerId }) => {
    const p = state.peers.get(peerId);
    if (!p) return;
    p.theirTier = TIERS.includes(d.t) ? d.t : "good";
    renderSignal(peerId);
  });
  viewA.onMessage = mine((d, { peerId }) => { if (state.peers.has(peerId)) state.quality.setView(peerId, Math.max(0, Math.min(8000, Number(d.w) || 0))); });

  hello.onMessage = mine((d, { peerId }) => {
    dlog(`hello from ${peerId}${d.in ? "" : " (asking to join)"}`);
    const p = state.peers.get(peerId) || state.pending.get(peerId) || { id: peerId };
    if (d.name != null) p.name = String(d.name || "Guest").slice(0, 20);
    if ("mic" in d) { p.mic = d.mic !== false; p.cam = d.cam !== false; p.hand = !!d.hand; p.away = !!d.away; p.quiet = !!d.quiet; p.rec = !!d.rec; }
    if (d.share) p.shareId = d.share;
    p.in = !!d.in; p.how = String(d.how || ""); p.age = Number(d.age) || 0;
    // the waiting room is the call's setting: learn it from the people in it
    if (p.in && d.lock === true) {
      // we walked in, but this call was already asking first: go back and knock
      if (state.admitted && state.how === "open" && (Number(d.lockAge) || 0) > performance.now() - state.inAt + 3000) { regate(); return; }
      if (!state.lock) setLock(true, Number(d.lockAge) || 0, false);
    }
    if (state.peers.has(peerId)) {
      if (!p.in) { dropPeer(peerId, true); state.pending.set(peerId, p); return; }
      greet(p);
      if (p.rec) setRecBy(peerId, true);
      renderTile(peerId);
      return;
    }
    state.pending.set(peerId, p);
    if (state.admitted && p.in) {
      // walked in without asking after the call started asking: ask them to knock instead
      if (state.lock && p.how === "open" && p.age + 3000 < performance.now() - state.lockAt) {
        door.send({ id: peerId, wait: true }, { target: peerId });
        return;
      }
      promote(peerId);
    } else if (state.admitted && !p.in) {
      if (state.lock && !state.denied.has(peerId)) showKnock(peerId);
    } else if (!state.admitted && p.in) {
      if (d.lock !== true) becomeIn("open"); // this call doesn't ask: walk in
      else waitText("Asking to join", "Someone in the call will let you in. You can keep checking your camera and microphone.");
    }
  });
  door.onMessage = mine((d, { peerId }) => {
    const from = state.peers.get(peerId) || state.pending.get(peerId);
    if (!from || !from.in) return; // only people in the call open the door
    if (typeof d.lock === "boolean") {
      setLock(d.lock, 0, false);
      if (!d.lock && !state.admitted) becomeIn("open");
      if (state.admitted) toast(d.lock ? `${from.name || "Someone"} turned on asking before letting people in` : `${from.name || "Someone"} turned off asking first`, 4000);
      return;
    }
    if (d.id === state.selfId) {
      if (state.admitted) { if (d.wait && state.how === "open") regate(); return; }
      if (d.ok === true) becomeIn("admitted");
      else if (d.ok === false) { const code = state.code; exitRoom(); showLobby(code); lobbyNote("Someone in the call didn't let you in."); }
      return;
    }
    // someone else in the call answered a knock
    if (d.ok === false) state.denied.add(String(d.id));
    dismissKnock(String(d.id));
  });
  status.onMessage = mine((d, { peerId }) => {
    const p = state.peers.get(peerId);
    if (!p) return;
    const raised = !p.hand && d.hand;
    const leaking = !p.leak && d.leak;
    p.mic = d.mic !== false; p.cam = d.cam !== false; p.hand = !!d.hand; p.away = !!d.away; p.quiet = !!d.quiet; p.leak = !!d.leak;
    if (p.quiet) { dismissEcho(peerId); dismissLeak(peerId); }
    // their speakers send our voice back: they've been told, and it isn't "the same room"
    if (p.leak) { p.leakAt = performance.now(); dismissEcho(peerId); }
    if (leaking) toast(`If you hear yourself, it's ${p.name || "someone"}'s speakers. They've been asked to wear headphones or turn the volume down.`, 7000);
    if (raised) { toast(`${p.name || "Someone"} raised their hand`); say(`${p.name || "Someone"} raised their hand`); }
    renderTile(peerId);
  });
  rec.onMessage = mine((d, { peerId }) => { if (state.peers.has(peerId)) setRecBy(peerId, !!d.on); });
  share.onMessage = mine((d, { peerId }) => {
    const p = state.peers.get(peerId);
    if (!p) return;
    if (d.on) { p.shareId = d.id; say(`${p.name || "Someone"} started presenting`); }
    else { p.shareId = null; if (p.screen) { removeScreenTile(peerId); p.screen = null; } }
  });
  cc.onMessage = mine((d, { peerId }) => {
    const p = state.peers.get(peerId);
    if (!p) return;
    if (d.k === "st") {
      const turnedOn = !p.ccWant && d.want;
      p.ccWant = !!d.want; p.ccCan = !!d.can;
      ccButton();
      if (turnedOn) toast(`${p.name || "Someone"} turned on captions`, 3000);
      ccUpdate();
    } else if (d.k === "tx" && state.cc.on) {
      const text = String(d.t || "").slice(0, 400);
      if (text) showCaption(peerId, text, !!d.f);
    }
  });
  chat.onMessage = mine((d, { peerId }) => {
    if (!state.peers.has(peerId)) return;
    const text = String(d.text || "").slice(0, 500);
    if (text && !OFF("chat")) addMessage(nameOf(peerId), text, false);
  });

  state.mediaWait = new Map();
  room.onPeerJoin = (peerId) => {
    if (state.room !== room) return;
    dlog(`peer ${peerId} connected`);
    state.conn.add(peerId);
    hello.send(helloFor(peerId), { target: peerId });
  };
  room.onPeerLeave = (peerId) => {
    if (state.room !== room) return;
    dlog(`peer ${peerId} left`);
    state.conn.delete(peerId);
    if (state.pending.delete(peerId)) dismissKnock(peerId);
    if (state.peers.has(peerId)) dropPeer(peerId, false);
  };
  room.onPeerStream = (stream, peerId, meta) => {
    if (state.room !== room) return;
    dlog(`video from ${peerId}${meta && meta.kind ? " (" + meta.kind + ")" : ""}`);
    // arrived a moment before they told us they're in: keep it for then
    const w = state.pending.get(peerId);
    if (w && !state.peers.has(peerId)) { (w.early || (w.early = [])).push([stream, meta]); return; }
    gotStream(stream, peerId, meta);
  };
  state.broadcastStatus = () => state.actions && state.actions.status.send({ mic: state.mic, cam: state.cam, hand: state.hand, away: state.pipe.away, quiet: state.quiet, leak: state.leakCards.size > 0 });
}

// Adding video makes the connection renegotiate. If both people do it at the same moment
// ("glare"), Safari on iPhone drops the connection, it reconnects, and the call flickers
// between one and two people. So only one side starts: the one with the smaller id sends
// straight away, the other sends once that video has arrived (or after 4 s at most).
function sendMedia(peerId) {
  const room = state.room;
  const t = state.mediaWait.get(peerId);
  if (t === "sent" || !room || !state.peers.has(peerId)) return;
  clearTimeout(t);
  state.mediaWait.set(peerId, "sent");
  dlog(`sending my video to ${peerId}`);
  room.addStream(state.pipe.stream, { target: peerId, metadata: { kind: "camera" } });
  if (state.screen) room.addStream(state.screen, { target: peerId, metadata: { kind: "screen" } });
}

function gotStream(stream, peerId, meta) {
  // their video arrived, so it's our turn (once their renegotiation has settled)
  if (state.mediaWait.has(peerId) && state.mediaWait.get(peerId) !== "sent") setTimeout(() => sendMedia(peerId), 600);
  const p = state.peers.get(peerId);
  if (!p) return;
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
    ccUpdate();
  }
  renderTile(peerId);
}

function greet(p) {
  if (p.greeted || !p.name) return;
  p.greeted = true;
  toast(`${p.name} joined`);
  say(`${p.name} joined the call`);
}

function dropPeer(peerId, quiet) {
  clearTimeout(state.mediaWait && state.mediaWait.get(peerId));
  if (state.mediaWait) state.mediaWait.delete(peerId);
  const p = state.peers.get(peerId);
  if (p && !quiet) { toast(`${p.name || "Someone"} left`); say(`${p.name || "Someone"} left the call`); }
  setRecBy(peerId, false);
  dismissEcho(peerId); dismissLeak(peerId);
  setTimeout(ccButton, 0); // they may have been the one making captions
  if (p && p.screen) removeScreenTile(peerId);
  removeTile(peerId);
  if (state.recorder) { state.recorder.removeAudio(peerId); state.recorder.removeAudio("screen:" + peerId); }
  if (p) { p.tile = null; p.video = null; p.stream = null; p.screen = null; p.greeted = false; p.ccWant = false; }
  state.peers.delete(peerId);
  dropCaptions(peerId);
  layout();
}

/* ---------------- who can get in: passcode and waiting room ----------------
   The passcode is real protection: the connection handshake is encrypted with it, so a browser
   without it can't connect at all. The waiting room is kept by the browsers in the call: they
   send nothing (no video, voice, chat or names) to someone they haven't let in. Nobody in the
   call yet? The person who started it gets straight in on this device; others wait. */

const HOST_KEY = "konvene_hosted"; // calls you started on this device (code, passcode, ask first), for a week
function hostedList() { try { return JSON.parse(localStorage.getItem(HOST_KEY) || "[]").filter((x) => x && Date.now() - x.t < 7 * 864e5); } catch { return []; } }
function hosted(code) { return hostedList().find((x) => x.code === code) || null; }
function rememberHosted(code) {
  try { localStorage.setItem(HOST_KEY, JSON.stringify([{ code, pass: state.pass, lock: state.lock, t: Date.now() }, ...hostedList().filter((x) => x.code !== code)].slice(0, 20))); } catch { /* private */ }
}
const SEC_KEY = "konvene_sec"; // your last choice for new calls: passcode on or off, ask first on or off
// your last choice, or the deployment's default (KONVENE_PASSCODE_DEFAULT, KONVENE_ASK_FIRST_DEFAULT)
function loadSec() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SEC_KEY) || "{}"); } catch { /* private */ }
  return { pass: "pass" in s ? s.pass : CONFIG.passcodeDefault, wait: "wait" in s ? s.wait : CONFIG.askFirstDefault };
}
function saveSec() { try { localStorage.setItem(SEC_KEY, JSON.stringify({ pass: $("#sec-pass").checked, wait: $("#sec-wait").checked })); } catch { /* private */ } }
function makePasscode() { return randomChars(6); }

// what we tell someone who just connected; someone still waiting learns nothing about who's here
function helloFor(id) {
  const now = performance.now();
  const base = { in: state.admitted, how: state.how, age: state.admitted ? Math.round(now - state.inAt) : 0, lock: state.lock, lockAge: state.lock ? Math.round(now - state.lockAt) : 0 };
  if (state.admitted && state.lock && !state.peers.has(id)) return base;
  return { ...base, ...myStatus() };
}

// both of us are in: show them, and start sending video
function promote(id) {
  const p = state.pending.get(id);
  if (!p || !state.room) return;
  // full: whoever arrived last steps back (both sides compare how long they've been in)
  if (state.peers.size + 1 >= MAX_PEOPLE) {
    const mine = performance.now() - state.inAt;
    if (mine < (p.age || 0)) {
      const code = state.code;
      exitRoom(); showLobby(code);
      lobbyNote(`This call is full. Up to ${MAX_PEOPLE} people can be in a call.`);
    }
    return;
  }
  state.pending.delete(id);
  dismissKnock(id);
  state.peers.set(id, p);
  p.sentView = 0;
  state.actions.hello.send(helloFor(id), { target: id });
  greet(p);
  if (p.rec) setRecBy(id, true);
  renderTile(id);
  ccAnnounce(id);
  setTimeout(sendViews, 1500);
  state.mediaWait.delete(id);
  if (state.selfId < id) sendMedia(id);
  else state.mediaWait.set(id, setTimeout(() => sendMedia(id), 4000));
  const early = p.early; p.early = null;
  for (const [st, meta] of early || []) gotStream(st, id, meta);
}

function becomeIn(how) {
  if (state.admitted || !state.room) return;
  dlog(`in the call (${how})`);
  state.admitted = true; state.how = how; state.inAt = performance.now();
  rememberCall(state.code);
  for (const id of state.conn) state.actions.hello.send(helloFor(id), { target: id });
  for (const [id, p] of [...state.pending]) if (p.in) promote(id);
  if (!state.inCall) showCall();
  // listen for another device in this room (levels only, on this device)
  if (!state.roomEcho) {
    state.roomEcho = new RoomEcho({
      mic: () => (state.quiet ? null : micAnalyser),
      others: () => [...state.peers].filter(([, p]) => !p.quiet && p.analyser).map(([id, p]) => [id, p.analyser]),
      onMatch: (id) => setTimeout(() => sameRoom(id), 3000), // their own leak notice may be on its way
      onLeak: speakerLeak,
      canLeak: () => state.mic && !state.quiet, // a muted microphone sends no echo
    });
  }
  state.roomEcho.start();
}

// another device's audio keeps following this room's sound: almost certainly two devices in one
// room, which echoes. Suggest the fix; never change anything on our own.
function sameRoom(id) {
  const p = state.peers.get(id);
  if (!p || p.quiet || state.quiet || !state.inCall || state.echoCards.has(id)) return;
  if (p.leakAt && performance.now() - p.leakAt < 5 * 60e3) return; // it's their speakers, not this room
  dlog(`${id} sounds like this room`);
  const card = el("div", "knock echo-card");
  card.setAttribute("role", "alert");
  const msg = el("p");
  msg.append(document.createTextNode("Sounds like you're in the same room as "), el("strong", null, p.name || "someone"), document.createTextNode(". Turn off sound on one device to stop the echo."));
  const no = el("button", "btn secondary small", "Not now");
  const yes = el("button", "btn primary small", "Turn off sound here");
  no.type = yes.type = "button";
  no.addEventListener("click", () => dismissEcho(id));
  yes.addEventListener("click", () => { dismissEcho(id); setQuiet(true); toast("Sound is off on this device", 2500); });
  card.append(msg, el("span", "knock-btns"));
  card.lastChild.append(no, yes);
  $("#knocks", stageEl()).append(card);
  state.echoCards.set(id, card);
  say(`Sounds like you're in the same room as ${p.name || "someone"}.`);
}
function dismissEcho(id) {
  const c = state.echoCards.get(id);
  if (c) c.remove();
  state.echoCards.delete(id);
}

// this microphone keeps picking up someone's voice from this device's speakers (echo
// cancellation off or overwhelmed), so they hear themselves. Only this device can fix it.
function speakerLeak(id) {
  const p = state.peers.get(id);
  if (!p || state.quiet || !state.mic || !state.inCall || state.leakCards.has(id)) return;
  dlog(`${id}'s voice is coming back through this microphone`);
  const card = el("div", "knock echo-card");
  card.setAttribute("role", "alert");
  const msg = el("p");
  msg.append(el("strong", null, p.name || "Someone"), document.createTextNode(" can hear their own voice: your microphone is picking up your speakers. Wear headphones or turn your volume down."));
  const mute = el("button", "btn secondary small", "Mute me");
  const ok = el("button", "btn primary small", "Got it");
  mute.type = ok.type = "button";
  mute.addEventListener("click", () => { dismissLeak(id); setMic(false); });
  ok.addEventListener("click", () => dismissLeak(id, true));
  card.append(msg, el("span", "knock-btns"));
  card.lastChild.append(mute, ok);
  $("#knocks", stageEl()).append(card);
  state.leakCards.set(id, card);
  if (state.inCall) state.broadcastStatus();
  say(`${p.name || "Someone"} can hear their own voice. Your microphone is picking up your speakers.`);
}
// listen again later: if it still leaks after "Got it", say so again in a minute or two
function dismissLeak(id, listenAgain = false) {
  const c = state.leakCards.get(id);
  if (!c) return;
  c.remove();
  state.leakCards.delete(id);
  if (state.inCall && state.broadcastStatus) state.broadcastStatus();
  if (listenAgain) setTimeout(() => { if (state.roomEcho) state.roomEcho.again(id); }, 60e3);
}

function setLock(on, age = 0, announce = true) {
  on = !!on;
  if (state.lock === on) return;
  state.lock = on;
  state.lockAt = performance.now() - age;
  if (state.code && hosted(state.code)) rememberHosted(state.code);
  if (state.inCall) rememberCall(state.code);
  $("#lock-toggle").checked = on;
  if (announce && state.actions && state.conn.size) state.actions.door.send({ lock: on }, { target: [...state.conn] });
  // off: whoever is waiting walks in by themselves; on: anyone not in yet has to ask
  if (!on) for (const id of [...state.knocks.keys()]) dismissKnock(id);
  else if (state.admitted) for (const [id, p] of state.pending) if (!p.in && !state.denied.has(id)) showKnock(id);
  if (state.panel === "people") renderPeople();
}

function showKnock(id) {
  if (state.knocks.has(id) || !state.inCall) return;
  const p = state.pending.get(id);
  const name = (p && p.name) || "Someone";
  const card = el("div", "knock");
  card.setAttribute("role", "alert");
  const who = el("p");
  who.append(el("strong", null, name), document.createTextNode(" wants to join"));
  const no = el("button", "btn secondary small", "Don't let in");
  const yes = el("button", "btn primary small", "Let in");
  no.type = yes.type = "button";
  no.addEventListener("click", () => answerKnock(id, false));
  yes.addEventListener("click", () => answerKnock(id, true));
  card.append(who, el("span", "knock-btns"));
  card.lastChild.append(no, yes);
  $("#knocks", stageEl()).append(card);
  state.knocks.set(id, card);
  chime();
  say(`${name} is asking to join the call`);
  if (state.panel === "people") renderPeople();
}
function dismissKnock(id) {
  const c = state.knocks.get(id);
  if (c) c.remove();
  if (state.knocks.delete(id) && state.panel === "people") renderPeople();
}
function answerKnock(id, ok) {
  if (!state.actions) return;
  const p = state.pending.get(id);
  state.actions.door.send({ id, ok }, { target: [...new Set([...state.peers.keys(), id])] });
  if (!ok) state.denied.add(id);
  dismissKnock(id);
  toast(ok ? `Letting ${(p && p.name) || "them"} in` : `${(p && p.name) || "They"} won't join`, 2500);
}
// a soft two-note sound for a knock (made here, no file to fetch)
function chime() {
  try {
    const a = state.audio, t = a.currentTime;
    for (const [f, d] of [[660, 0], [880, 0.15]]) {
      const o = a.createOscillator(), g = a.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.1, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.35);
      o.connect(g).connect(a.destination);
      o.start(t + d); o.stop(t + d + 0.4);
    }
  } catch { /* no sound */ }
}

// a browser with a different passcode tried to connect (the handshake didn't decrypt)
const wrongSeen = new Set();
function wrongPass(room, e) {
  if (room !== state.room || !/password/i.test((e && e.error) || "")) return;
  const id = e.peerId;
  if (state.peers.has(id)) return;
  dlog(`passcode mismatch with ${id}`);
  // still asking, or walked in moments ago into an empty call: it's our passcode that's off
  const ours = !state.admitted || (state.how === "open" && !state.peers.size && performance.now() - state.inAt < 15000);
  if (ours) {
    const had = !!state.pass, code = state.code;
    exitRoom();
    showLobby(code);
    $("#pass-row").hidden = false;
    lobbyNote(had ? "That passcode didn't work. Check it with the person who invited you." : "This call has a passcode. Type it to join.");
    $("#pass").focus();
    return;
  }
  if (state.admitted && !wrongSeen.has(id)) { wrongSeen.add(id); toast("Someone tried to join with the wrong passcode.", 5000); }
}

// leave the room but stay on the page (wrong passcode, not let in, cancel, asked to knock)
function exitRoom() {
  const room = state.room;
  if (!room) return;
  if (state.screen) stopShare();
  if (state.recorder.recording) toggleRecording();
  for (const id of [...state.peers.keys()]) dropPeer(id, true);
  for (const id of [...state.knocks.keys()]) dismissKnock(id);
  for (const id of [...state.echoCards.keys()]) dismissEcho(id);
  for (const id of [...state.leakCards.keys()]) dismissLeak(id);
  if (state.roomEcho) state.roomEcho.stop();
  state.pending.clear(); state.conn.clear();
  state.room = null; state.actions = null; state.quality = null;
  try { room.leave(); } catch { /* gone */ }
  if (state.me && state.me.tile) { state.me.tile.remove(); state.me.tile = null; }
  state.admitted = false; state.how = null;
  if (state.pip) state.pip.close();
  try { navigator.mediaSession.setActionHandler("enterpictureinpicture", null); } catch { /* not supported */ }
  state.inCall = false;
  ccUpdate();
  clearTimeout(state.waitTimer);
  forgetCall();
}

// we walked in, but the call has started asking: go back and knock like everyone else
function regate() {
  const code = state.code;
  exitRoom();
  showLobby(code);
  toast("This call now asks before letting people in.", 4000);
  enterCall({ wait: true });
}

function lobbyNote(text) { const n = $("#lobby-note"); n.textContent = text || ""; n.hidden = !text; }
function waitText(title, text) { $("#wait-title").textContent = title; $("#wait-text").textContent = text; }
function showWaiting() {
  screen("lobby");
  $("#join-form").hidden = true;
  $("#lobby-sec").hidden = true;
  $("#lobby-wait").hidden = false;
  $("#lobby-title").textContent = "Waiting to be let in";
  $("#lobby-sub").hidden = true;
  lobbyNote("");
  waitText("Asking to join", "Someone in the call will let you in. You can keep checking your camera and microphone.");
  clearTimeout(state.waitTimer);
  state.waitTimer = setTimeout(() => {
    if (state.admitted || !state.room || [...state.pending.values()].some((p) => p.in)) return;
    waitText("Waiting for someone to let you in", "Nobody in the call has answered yet. They may not be there yet, or your passcode may not match theirs. You can keep waiting.");
  }, 20000);
  $("#wait-cancel").focus({ preventScroll: true });
}

// weak connections: quality per person, audio-only fallback, smaller video for small tiles (quality.js)
setInterval(() => { if (state.quality) state.quality.tick(); }, 2000);

// tell each person how big we show them, so they don't send us more than we can see
let viewTimer = 0;
function sendViews() {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    if (!state.inCall || !state.actions || !state.actions.view) return;
    const hidden = document.hidden && !(state.pip && state.pip.open);
    for (const [id, p] of state.peers) {
      let w = 0;
      if (hidden) w = 320; // nobody is looking: a small picture is plenty
      else if (p.tile && p.tile.isConnected) {
        const win = p.tile.ownerDocument.defaultView || window;
        w = Math.round(p.tile.getBoundingClientRect().width * (win.devicePixelRatio || 1));
      }
      if (!w) continue;
      if (p.sentView && Math.abs(p.sentView - w) / p.sentView < 0.15) continue;
      p.sentView = w;
      state.actions.view.send({ w }, { target: id });
    }
  }, 400);
}
addEventListener("resize", sendViews);
document.addEventListener("visibilitychange", sendViews);

// the signal indicator on someone's tile: the worse of how we reach them and how they reach us
function renderSignal(id) {
  const p = state.peers.get(id);
  if (!p || !p.tile || !state.quality) return;
  const tier = worse(state.quality.tierOf(id), p.theirTier);
  let sig = $(".signal", p.tile);
  if (!sig) {
    sig = el("span", "signal");
    sig.append(el("i"), el("i"), el("i"));
    p.tile.append(sig);
    const paused = el("p", "tile-paused");
    paused.textContent = "Video paused to keep the sound clear";
    p.tile.append(paused);
  }
  sig.dataset.tier = tier;
  sig.hidden = tier === "good";
  const words = { weak: "Weak connection: video lowered", poor: "Poor connection: video lowered a lot", bad: "Very weak connection: audio only" };
  sig.title = words[tier] || "";
  sig.setAttribute("aria-label", words[tier] || "Good connection");
  // they paused their video to us: say so instead of showing a frozen picture
  p.tile.classList.toggle("video-paused", p.theirTier === "bad" && p.cam !== false);
}

function setRecBy(id, on) {
  if (on) state.recBy.set(id, true); else state.recBy.delete(id);
  const names = [...state.recBy.keys()].map((k) => (k === state.selfId ? "You are" : `${nameOf(k)} is`));
  $("#rec-badge").hidden = !names.length;
  $("#rec-text").textContent = names.length ? `${names.join(", ")} recording` : "";
  if (on && id !== state.selfId) say(`${nameOf(id)} started recording`);
}

/* ---------------- live captions (captions.js) ----------------
   Made on the devices in the call: each person whose browser can do it captions their own voice
   and sends the words only to the people who turned captions on. Anyone whose browser can't is
   captioned by the browser of the person who wants captions, from the audio it already gets. */

function ccWanted() { return [...state.peers].filter(([, p]) => p.ccWant).map(([id]) => id); }

function ccAnnounce(target) {
  if (!state.actions) return;
  state.actions.cc.send({ k: "st", want: state.cc.on, can: state.cc.can }, target ? { target } : {});
}

// start or stop each transcriber to match who wants captions and who can make them
function ccUpdate() {
  const cc = state.cc;
  const live = !!(state.room && state.inCall);
  // my own voice: when I or anyone else wants captions, and this browser can do it on the device
  const mine = live && cc.can && (cc.on || ccWanted().length > 0);
  if (mine && !cc.self) {
    cc.self = new Transcriber({
      lang: cc.lang.lang,
      track: state.pipe.sendTrack,
      onText: (text, final) => {
        if (cc.on) showCaption(state.selfId, text, final);
        const now = performance.now();
        if (!final && now - cc.sentAt < 250) return; // words as they form, a few times a second
        cc.sentAt = now;
        const to = ccWanted();
        if (to.length) state.actions.cc.send({ k: "tx", t: text.slice(-400), f: final }, { target: to });
      },
      onFail: (why) => {
        dlog(`captions stopped: ${why}`);
        cc.self = null; cc.can = false;
        ccAnnounce();
        if (cc.on) toast("Captions stopped working in this browser.", 4000);
        ccUpdate();
      },
    });
    cc.self.start();
  } else if (!mine && cc.self) { cc.self.stop(); cc.self = null; }
  // people whose browsers can't caption themselves: caption the audio we get from them
  const others = live && cc.on && cc.can;
  for (const [id, t] of cc.remote) {
    const p = state.peers.get(id);
    if (!others || !p || p.ccCan || !p.stream) { t.stop(); cc.remote.delete(id); }
  }
  if (others) {
    for (const [id, p] of state.peers) {
      const track = p.stream && p.stream.getAudioTracks()[0];
      if (p.ccCan || !track) continue;
      const t = cc.remote.get(id);
      if (t) { t.setTrack(track); continue; }
      const tr = new Transcriber({
        lang: cc.lang.lang,
        track,
        onText: (text, final) => { if (cc.on) showCaption(id, text, final); },
        onFail: (why) => { dlog(`captions for ${id} stopped: ${why}`); cc.remote.delete(id); },
      });
      cc.remote.set(id, tr);
      tr.start();
    }
  }
}

// The captions button says up front whether captions can work here: this browser makes them on
// the device (desktop Google Chrome), or someone in the call can make their own. Otherwise it's
// shown as unavailable, with the reason on hover and on click.
function ccWhyNot() {
  const cc = state.cc;
  if (CAN_LOCAL && cc.lang !== null) return ""; // undefined: still checking, assume yes
  if (state.inCall && [...state.peers.values()].some((p) => p.ccCan)) return "";
  return CAN_LOCAL
    ? "Live captions aren't available for your language in this browser yet."
    : "Live captions need Google Chrome on a computer. This browser can't make them on your device.";
}
function ccButton() {
  const btn = $("#cc-btn");
  if (!btn) return;
  const why = state.cc.on ? "" : ccWhyNot();
  btn.setAttribute("aria-disabled", String(!!why));
  btn.title = why || (CAN_LOCAL ? "Captions (c): made on the devices in the call" : "Captions (c): from people in the call whose browsers can make them");
  btn.setAttribute("aria-label", why ? `Captions unavailable. ${why}` : "Captions");
}

async function toggleCaptions() {
  if (OFF("captions")) return;
  const cc = state.cc;
  const btn = $("#cc-btn");
  if (!cc.on) { const why = ccWhyNot(); if (why) { toast(why, 6000); return; } }
  if (cc.on) {
    cc.on = false;
    btn.setAttribute("aria-pressed", "false");
    $("#captions", stageEl()).hidden = true;
    for (const id of [...cc.lines.keys()]) dropCaptions(id);
    ccAnnounce(); ccUpdate(); ccButton();
    say("Captions off");
    return;
  }
  cc.on = true;
  btn.setAttribute("aria-pressed", "true");
  $("#captions", stageEl()).hidden = false;
  say("Captions on");
  if (CAN_LOCAL) {
    if (!cc.lang) cc.lang = await findLanguage();
    if (cc.lang && !cc.lang.ready) {
      toast("Getting captions ready. Your browser downloads a language pack once.", 6000);
      cc.lang.ready = await installCaptions(cc.lang.lang);
    }
    cc.can = !!(cc.lang && cc.lang.ready);
    if (!cc.can) {
      const others = [...state.peers.values()].some((p) => p.ccCan);
      toast(others ? "Chrome couldn't download its captions language pack, so your own voice isn't captioned. You'll still see captions from others." : "Chrome couldn't download its captions language pack. Check your connection and try again.", 7000);
      if (!others) { cc.on = false; btn.setAttribute("aria-pressed", "false"); $("#captions", stageEl()).hidden = true; ccButton(); return; }
    } else toast("Captions on. They're made on the devices in the call, never on a server.", 4000);
  } else {
    toast("Your own voice can't be captioned in this browser, but you'll see captions from people in the call using Chrome on a computer.", 6000);
  }
  if (!cc.on) return; // turned off while setting up
  ccButton();
  ccAnnounce(); ccUpdate();
}

// a speaker's line at the bottom of the stage: what they finished saying, then what they're saying
function showCaption(id, text, final) {
  const box = $("#captions", stageEl());
  let L = state.cc.lines.get(id);
  if (!L) {
    L = { el: el("p", "cap"), text: el("span"), done: "" };
    L.el.append(el("strong", null, id === state.selfId ? "You" : nameOf(id)), L.text);
    state.cc.lines.set(id, L);
  }
  const all = (L.done + " " + text).trim();
  if (final) L.done = all.slice(-240);
  L.text.textContent = all.length > 180 ? "..." + all.slice(-180).replace(/^\S*\s/, "") : all;
  if (box.lastElementChild !== L.el) box.append(L.el);
  while (box.children.length > 3) {
    const first = box.firstElementChild;
    const old = [...state.cc.lines].find(([, v]) => v.el === first);
    if (old) dropCaptions(old[0]); else first.remove();
  }
  clearTimeout(L.timer);
  L.timer = setTimeout(() => dropCaptions(id), final ? 6000 : 10000);
}

function dropCaptions(id) {
  const cc = state.cc;
  const L = cc.lines.get(id);
  if (L) { clearTimeout(L.timer); L.el.remove(); cc.lines.delete(id); }
  const t = cc.remote.get(id);
  if (t && !state.peers.has(id)) { t.stop(); cc.remote.delete(id); }
}

/* ---------------- screen sharing ---------------- */

async function toggleShare() {
  if (OFF("screenshare")) return;
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
  if (state.peers.size) state.room.addStream(stream, { target: [...state.peers.keys()], metadata: { kind: "screen" } });
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
  // asking to join (only while the call asks first)
  const wl = $("#waiting-list");
  wl.innerHTML = "";
  for (const id of state.knocks.keys()) {
    const p = state.pending.get(id) || {};
    const li = el("li");
    li.append(el("span", "avatar", (p.name || "?").slice(0, 1).toUpperCase()), el("span", "who", p.name || "Someone"));
    const btns = el("span", "knock-btns");
    const no = el("button", "btn secondary small", "Don't let in"), yes = el("button", "btn primary small", "Let in");
    no.type = yes.type = "button";
    no.addEventListener("click", () => answerKnock(id, false));
    yes.addEventListener("click", () => answerKnock(id, true));
    btns.append(no, yes);
    li.append(btns);
    wl.append(li);
  }
  $("#waiting-box").hidden = !state.knocks.size;
  $("#lock-toggle").checked = state.lock;
  $("#pass-line").hidden = !state.pass;
  $("#pass-code").textContent = state.pass;
  $("#invite-plain").hidden = !state.pass;
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

// Two devices in one room echo: each one's microphone picks up the other's speakers, which
// browsers can't cancel (echo cancellation only knows its own device's sound). The fix is the
// same as Meet's companion mode: one device in the room keeps the sound, the others turn it off.
const QUIET_KEY = "konvene_quiet";
function setQuiet(on) {
  state.quiet = on;
  try { if (on) sessionStorage.setItem(QUIET_KEY, "1"); else sessionStorage.removeItem(QUIET_KEY); } catch { /* private */ }
  document.body.classList.toggle("quiet", on);
  if ($("#quiet")) $("#quiet").checked = on;
  if (on && state.mic) setMic(false);
  if (on) for (const id of [...state.echoCards.keys()]) dismissEcho(id);
  if (on) for (const id of [...state.leakCards.keys()]) dismissLeak(id);
  for (const v of $$("video[data-remote]", stageEl())) v.muted = on;
  $$('[data-toggle="mic"]').forEach((b) => { b.title = on ? "Sound is off on this device" : "Microphone"; });
  if (state.inCall) { renderTile(state.selfId); state.broadcastStatus(); }
}

async function setMic(on) {
  if (on && state.quiet) {
    toast("Sound is off on this device. To use its microphone, turn sound back on in the microphone menu.", 5000);
    on = false;
  }
  if (on && !(await ensureMic())) {
    showHint(state.micError === "NotAllowedError" ? "Microphone blocked. Allow it in the address bar (the camera icon), then try again." : "No microphone found. Plug one in and try again.");
    on = false;
  }
  state.mic = on;
  state.pipe.setMic(on);
  if (state.me) state.me.mic = on;
  if (!on) for (const id of [...state.leakCards.keys()]) dismissLeak(id, true); // muted: no echo to send
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
  if (OFF("recording") && !state.recorder.recording) return;
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
      $("#saved-info").textContent = `${mb} MB, kept on this device for now. Save it to keep it: it's cleared the next time you open ${CONFIG.name} or record again.`;
      $("#saved-dialog").showModal();
    }
    return;
  }
  const d = $("#rec-dialog");
  d.returnValue = "";
  d.showModal();
  d.addEventListener("close", async function onClose() {
    d.removeEventListener("close", onClose);
    if (d.returnValue !== "ok") return;
    if (!(await state.recorder.start())) { toast("Recording couldn't start."); return; }
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
    try { await navigator.share({ title: `Join my ${CONFIG.name} call`, url }); return; } catch { /* cancelled */ }
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
function rememberCall(code) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, name: state.name, pass: state.pass, lock: state.lock, admitted: state.admitted })); } catch { /* private */ } }
function rememberedCall() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { return null; } }
function forgetCall() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* private */ } }

// three screens: home (/), the pre-join check (/abc-def-ghj) and the call itself
const AV_KEY = "konvene_av";
function loadAv() { try { return JSON.parse(localStorage.getItem(AV_KEY) || "{}"); } catch { return {}; } }
function saveAv() { if (state.quiet) return; try { localStorage.setItem(AV_KEY, JSON.stringify({ mic: state.mic, cam: state.cam })); } catch { /* private */ } }
function screen(name) {
  document.body.dataset.screen = name;
  // the home page is night green; the pre-join page and the call are light
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.content = name === "home" ? "#06110d" : "#f3f3ef";
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
// inv: what an invite link carried after the # ({ pass, wait })
function showLobby(code, inv = null) {
  if (state.code !== code) { state.pass = ""; state.lock = false; }
  state.code = code;
  const isNew = state.newCode === code;
  // who can get in: a new call sets it here; your own earlier call remembers it; a link may carry it
  const mine = hosted(code);
  if (mine) { state.pass = mine.pass || ""; state.lock = !!mine.lock; }
  else if (inv) { if (inv.pass) state.pass = inv.pass; if (inv.wait) state.lock = true; }
  $("#join-form").hidden = false;
  $("#lobby-wait").hidden = true;
  $("#lobby-sub").hidden = false;
  lobbyNote("");
  $("#lobby-sec").hidden = !isNew;
  if (isNew) {
    const sec = loadSec();
    $("#sec-pass").checked = !!sec.pass;
    $("#sec-wait").checked = !!sec.wait;
    if (!$("#pass").value || $("#pass").dataset.code !== code) { $("#pass").value = makePasscode(); $("#pass").dataset.code = code; }
    syncSec();
  } else {
    $("#pass").value = state.pass;
    $("#pass").dataset.code = code;
    $("#pass-row").hidden = !state.pass;
  }
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
  if (av.mic && !state.mic && !state.quiet) await setMic(true);
}
function route(inv = null) {
  const code = codeFromHash();
  if (code) showLobby(code, inv); else showHome();
}
function startCall() {
  const code = makeRoomCode();
  state.newCode = code;
  history.pushState(null, "", "/" + code + location.search);
  showLobby(code);
}

// accepts "abc-def-ghj" or a full invite link (whose # part may carry a passcode)
function parseCode(text) {
  const t = String(text || "").trim();
  const i = t.indexOf("#");
  const m = (i >= 0 ? t.slice(0, i) : t).toLowerCase().match(/([a-z0-9]{3})-?([a-z0-9]{3})-?([a-z0-9]{3})\s*(\?[^#]*)?$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// a new call: the passcode and ask-first switches on the pre-join page
function syncSec() {
  if (state.newCode !== state.code) return;
  $("#pass-row").hidden = !$("#sec-pass").checked;
  state.pass = $("#sec-pass").checked ? ($("#pass").value || "").trim() : "";
  state.lock = $("#sec-wait").checked;
  $("#lobby-code").textContent = state.code;
}

function leaveCall() {
  if (state.screen) stopShare();
  forgetCall();
  try { sessionStorage.removeItem(QUIET_KEY); } catch { /* private */ }
  try { navigator.mediaSession.setActionHandler("enterpictureinpicture", null); } catch { /* not supported */ }
  if (state.pip) state.pip.close();
  if (state.room) state.room.leave();
  state.pipe.stop();
  location.href = "/" + location.search;
}

// opts.admitted: back after a refresh, already let in. opts.wait: knock even if the link doesn't say so.
async function enterCall(opts = {}) {
  state.audio.resume();
  const code = codeFromHash() || makeRoomCode();
  const isNew = state.newCode === code;
  goTo(code);
  if (isNew) rememberHosted(code);
  const host = isNew || !!hosted(code);
  // relay servers for strict networks (asked for at page load; don't wait long for them)
  if (!LOCAL && !state.turn) state.turn = await Promise.race([state.turnReady, new Promise((r) => setTimeout(() => r([]), 2500))]);
  state.isNewCall = isNew;
  state.lockAt = performance.now();
  joinRoom(code);
  // the person who started the call is in straight away; so is someone let in before a refresh.
  // Everyone else walks in, unless the call asks first: then they knock and wait.
  if (host) becomeIn("host");
  else if (opts.admitted && !opts.wait) becomeIn("admitted");
  else if (!state.lock && !opts.wait) becomeIn("open");
  else { rememberCall(code); showWaiting(); }
}

function showCall() {
  state.inCall = true;
  clearTimeout(state.waitTimer);
  for (const v of $$("#lobby-preview canvas")) v.remove();
  screen("call");
  // Chrome 120+: switching to another tab opens the call in picture-in-picture (needs the mic in use, which a call always has)
  try { navigator.mediaSession.setActionHandler("enterpictureinpicture", () => { dlog("picture-in-picture: Chrome asked (tab switched)"); state.pip.show(); }); } catch { /* not supported */ }
  $("#room-code").textContent = state.code;
  $("#lock-toggle").checked = state.lock;
  hookMic();
  renderTile(state.selfId);
  ccUpdate();
  closeFx();
  $("#room-chip").focus();
  toast(state.isNewCall ? "You're live. Copy the link to invite people." : "You're in.", 4000);
}

async function init() {
  state.audio = new (window.AudioContext || window.webkitAudioContext)();
  state.recorder = new CallRecorder(state.audio);
  clearOldRecordings(); // a recording left over from an earlier visit (one another tab is writing stays)
  Object.assign(state.pipe.settings, loadFx());
  try { $("#name").value = localStorage.getItem("gr_name") || ""; } catch { /* private */ }
  state.pipe.name = $("#name").value;
  const code = codeFromHash();
  const inv = hashParams(location.hash); // the passcode and "ask first" from an invite link
  if (code && location.hash) goTo(code); // keep the address bar clean: /abc-def-ghj
  const again = rememberedCall();
  const rejoin = !!(again && code && again.code === code && again.name);
  if (!rejoin) route(inv);
  $("#start-btn").addEventListener("click", startCall);
  $("#cta-start").addEventListener("click", startCall);
  $("#nav-start").addEventListener("click", startCall);
  $("#code-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#code-input").value;
    const c = parseCode(v);
    if (!c) { toast("That doesn't look like a call code. It looks like abc-def-ghj."); return; }
    history.pushState(null, "", "/" + c + location.search);
    showLobby(c, v.includes("#") ? hashParams(v.slice(v.indexOf("#"))) : null);
  });
  // Back goes from the pre-join page to home. During a call it does nothing (Leave does that).
  addEventListener("popstate", () => {
    if (state.inCall) { history.pushState(null, "", "/" + state.code + location.search); return; }
    if (state.room) exitRoom(); // was asking to join
    route();
  });
  // a new call: passcode and ask first (remembered for your next new call)
  $("#quiet").addEventListener("change", (e) => setQuiet(e.target.checked));
  // a refresh during a call keeps this device's sound off
  try { if (sessionStorage.getItem(QUIET_KEY)) setQuiet(true); } catch { /* private */ }
  for (const id of ["#sec-pass", "#sec-wait"]) $(id).addEventListener("change", () => { syncSec(); saveSec(); if (id === "#sec-pass" && $("#sec-pass").checked) $("#pass").select(); });
  $("#pass").addEventListener("input", () => { syncSec(); lobbyNote(""); });
  $("#wait-cancel").addEventListener("click", () => { const c = state.code; exitRoom(); showLobby(c); });
  $("#lock-toggle").addEventListener("change", (e) => {
    setLock(e.target.checked);
    toast(e.target.checked ? "People now ask before joining" : "People can join without asking", 3000);
  });
  $("#invite-plain").addEventListener("click", async () => {
    const u = link(state.code, false);
    try { await navigator.clipboard.writeText(u); toast("Link copied. Send the passcode separately."); } catch { toast(u, 8000); }
  });
  $("#lobby-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link(state.code)); toast("Call link copied"); } catch { toast(link(state.code), 8000); }
  });

  initPanel();
  buildReactions();
  buildSignatures();
  buildDevicePickers($("#call-devices"));
  buildDevicePickers($("#lobby-devices"));
  initHome();

  state.turnReady = LOCAL ? Promise.resolve([]) : iceServers();
  await state.pipe.start();
  setMic(false); setCam(false);
  if (state.devices.speaker && canPickSpeaker) state.sinkId = state.devices.speaker;
  refreshDevices();
  if (!rejoin && document.body.dataset.screen === "lobby") restoreAv();
  // refreshing during a call puts you straight back in it (the microphone is still required)
  if (rejoin) {
    state.name = again.name; state.pipe.name = again.name; $("#name").value = again.name;
    state.code = again.code; state.pass = again.pass || ""; state.lock = !!again.lock;
    setTimeout(async () => {
      if (await ensureMic()) enterCall({ admitted: !!again.admitted });
      else { forgetCall(); route(); }
    }, 0);
  }
  if (navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
  document.addEventListener("change", (e) => {
    const s = e.target.closest("select[data-kind]");
    if (s && s.value) switchDevice(s.dataset.kind, s.value);
    const n = e.target.closest("select[data-noise]");
    if (n) setNoise(n.value);
  });

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
        ? `${CONFIG.name} needs your microphone to join. Allow it in the address bar (the camera icon), then press the button again. You can stay muted.`
        : `${CONFIG.name} needs a microphone to join, and none was found. Plug one in and try again.`);
      return;
    }
    showHint("");
    if (state.newCode === state.code) {
      if ($("#sec-pass").checked && !$("#pass").value.trim()) $("#pass").value = makePasscode();
      syncSec();
    } else if (!$("#pass-row").hidden) state.pass = $("#pass").value.trim();
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
    if (mod && !e.shiftKey && !e.altKey && (e.key === "d" || e.key === "D")) { e.preventDefault(); if (state.quiet) { setMic(true); return; } setMic(!state.mic).then(() => { saveAv(); toast(state.mic ? "Microphone on" : "Microphone off", 1500); }); return; }
    if (mod && !e.shiftKey && !e.altKey && (e.key === "e" || e.key === "E")) { e.preventDefault(); setCam(!state.cam).then(() => { saveAv(); toast(state.cam ? "Camera on" : "Camera off", 1500); }); return; }
    if ((e.key === "c" || e.key === "C") && !mod && !e.altKey && !typing && state.inCall) { e.preventDefault(); toggleCaptions(); return; }
    if (e.code === "Space" && !typing && state.inCall && !state.mic && !state.quiet && !e.repeat && !e.target.closest("button")) { e.preventDefault(); spaceTalk = true; setMic(true); }
  });
  addEventListener("keyup", (e) => { if (e.code === "Space" && spaceTalk) { spaceTalk = false; setMic(false); } });
  addEventListener("blur", () => { if (spaceTalk) { spaceTalk = false; setMic(false); } });
  // features this deployment switched off (KONVENE_DISABLE)
  const hide = { recording: ["#rec-btn"], captions: ["#cc-btn"], screenshare: ["#share-btn"], chat: ['[data-panel="chat"]'], effects: ["[data-open-fx]"], reactions: [".react-wrap"] };
  for (const [f, sels] of Object.entries(hide)) if (OFF(f)) for (const s of sels) for (const e of $$(s)) e.hidden = true;
  if (OFF("effects")) state.pipe.applySettings({ bg: "none", look: "natural", light: "off", ...FACE_DEFAULTS });
  // phones and tablets can't share a screen from the browser; don't offer a button that only says so
  if (!navigator.mediaDevices.getDisplayMedia) $("#share-btn").hidden = true;
  $("#share-btn").addEventListener("click", toggleShare);
  $("#cc-btn").addEventListener("click", toggleCaptions);
  // can this browser caption your voice on the device right now? (checks only, never downloads)
  if (CAN_LOCAL) findLanguage().then((l) => { if (!state.cc.lang) state.cc.lang = l; state.cc.can = !!(l && l.ready); ccButton(); if (state.inCall) { ccAnnounce(); ccUpdate(); } });
  ccButton();
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
    if (OFF("chat")) return;
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
      onChange: (open) => { $("#pip-btn").setAttribute("aria-pressed", String(open)); for (const p of state.peers.values()) p.sentView = 0; sendViews(); },
      onResize: () => sendViews(),
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
  addEventListener("click", () => { state.audio.resume(); if (state.pipe.denoiser) state.pipe.denoiser.resume(); for (const v of $$("#tiles video, #spotlight video", stageEl())) if (v.paused) v.play().catch(() => {}); });
  onBeat(speakingLoop);
  window.__gr = state; // for tests
  window.__grLink = (withPass) => link(state.code, withPass);
}

init();
