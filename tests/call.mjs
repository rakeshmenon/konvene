// Browser test: green room effects, a two-person call over real WebRTC (local handshake),
// reactions, recording with the REC badge, and no requests leaving the site.
// Usage: serve site/ on :8790, then FACE_VIDEO=face.y4m OUT=shots node tests/call.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.BASE || "http://localhost:8790/";
const OUT = process.env.OUT || "shots";
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failures++; };
// without a face video, Chromium's fake camera shows no face, so face checks are skipped
const FACE = !!process.env.FACE_VIDEO;
const faceOk = (c, m) => (FACE ? ok(c, m) : console.log(`SKIP  ${m} (set FACE_VIDEO to a .y4m of a face)`));
const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required",
  "--disable-renderer-backgrounding", "--auto-select-desktop-capture-source=Entire screen", "--auto-accept-this-tab-capture", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--enable-unsafe-swiftshader"];
if (process.env.FACE_VIDEO) args.push(`--use-file-for-fake-video-capture=${process.env.FACE_VIDEO}`);
// same-room detection: another device's audio that follows this room's sound matches; a
// different person talking doesn't (loudness curves only, see src/roomecho.js)
{
  const { follow } = await import("../src/roomecho.js");
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const speech = (n) => { const a = []; let on = false; for (let i = 0; i < n; i++) { if (rnd() < 0.06) on = !on; a.push(on ? -1.2 + rnd() * 0.5 : -3.5 + rnd() * 0.3); } return a; };
  let same = 0, diff = 0;
  for (let t = 0; t < 30; t++) {
    const a = speech(192), b = speech(192), lag = 2 + Math.floor(rnd() * 20);
    const room = a.map((v, i) => (i >= lag ? a[i - lag] - 0.6 + (rnd() - 0.5) * 0.4 : -3.5));
    const s = follow(a, room), d = follow(a, b);
    if (s && s.r >= 0.7 && s.lag === lag) same++;
    if (d && d.r >= 0.7) diff++;
  }
  ok(same === 30 && diff <= 1, `same-room detection: ${same}/30 same-room matches, ${diff}/30 false matches`);
  ok(follow(Array(192).fill(-3.5), Array(192).fill(-3.5)) === null, "silence is never called a match");
}

const browser = await chromium.launch({ args });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 820 }, permissions: ["camera", "microphone"] });
const outside = [];
// screenshots are for review only; a slow frame should not fail the run
const shot = (p, path, opts = {}) => p.screenshot({ path, timeout: 60000, ...opts }).catch((e) => console.log("      (screenshot skipped: " + String(e).split("\n")[0] + ")"));
const watch = (p) => { p.errors = []; p.on("pageerror", (e) => p.errors.push(String(e))); p.on("console", (m) => { if (m.type() === "error" && !/INFO:|XNNPACK|GL Driver|WebGL|GPU stall/.test(m.text())) p.errors.push(m.text()); }); p.on("request", (r) => { const u = r.url(); if (!u.startsWith(BASE) && !/^(data|blob):/.test(u)) outside.push(u); }); };

const a = await ctx.newPage(); watch(a);
await a.goto(BASE + "?local=1");
await a.waitForFunction(() => window.__gr && window.__gr.pipe.running, null, { timeout: 30000 });
await a.waitForTimeout(1500);
await shot(a, `${OUT}/01-home.png`);
ok(await a.evaluate(() => document.body.dataset.screen === "home" && !document.querySelector('#prejoin [data-toggle]')), "home page has no camera or microphone controls");
const defaults = await a.evaluate(() => window.__gr.pipe.settings);
ok(defaults.expressions === false && defaults.autoAway && defaults.autoLight && defaults.mutedHint && !defaults.autoFrame, `smart defaults (expressions off) ${JSON.stringify(defaults)}`);
// Chromium's fake camera shows no face, so "step away" would pause the video; keep it live
if (!FACE) await a.evaluate(() => window.__gr.pipe.applySettings({ autoAway: false }));
const off = await a.evaluate(() => ({ cam: window.__gr.cam, mic: window.__gr.mic, camOpen: !!window.__gr.pipe.camStream, micOpen: !!window.__gr.pipe.micStream }));
ok(!off.cam && !off.mic && !off.camOpen && !off.micOpen, `camera and microphone are off and closed on load ${JSON.stringify(off)}`);
// Start a call opens the pre-join page for a new call
await a.click("#start-btn");
const lob = await a.evaluate(() => ({ screen: document.body.dataset.screen, title: document.querySelector("#lobby-title").textContent, code: document.querySelector("#lobby-code").textContent, path: location.pathname }));
ok(lob.screen === "lobby" && lob.title === "Ready to start?" && lob.path === "/" + lob.code, `Start a call opens the pre-join page ${JSON.stringify(lob)}`);
await a.click('#lobby [data-toggle="cam"]');
ok(await a.waitForFunction(() => window.__gr.cam && window.__gr.pipe.camStream && window.__gr.pipe.video.videoWidth > 0, null, { timeout: 15000 }).then(() => true).catch(() => false), "camera button opens the camera");
await a.waitForTimeout(500);
const res = await a.evaluate(() => ({ cam: window.__gr.pipe.video.videoWidth + "x" + window.__gr.pipe.video.videoHeight, out: window.__gr.pipe.out.width + "x" + window.__gr.pipe.out.height }));
ok(res.cam === res.out, `outgoing video matches the camera resolution ${JSON.stringify(res)}`);
await a.click('#lobby [data-menu="mic"]');
await a.waitForFunction(() => !document.querySelector("#dev-menu").hidden, null, { timeout: 5000 }).catch(() => {});
const devs = await a.evaluate(() => [...document.querySelectorAll("#dev-menu h3, #dev-menu button")].map((x) => x.textContent));
ok(devs.includes("Microphone") && devs.includes("Speakers") && devs.length >= 4, `green room mic menu lists devices ${JSON.stringify(devs)}`);
await shot(a, `${OUT}/01b-greenroom-menu.png`);
await a.keyboard.press("Escape");
await a.click('#lobby [data-menu="cam"]');
await a.waitForFunction(() => !document.querySelector("#dev-menu").hidden, null, { timeout: 5000 }).catch(() => {});
ok(await a.evaluate(() => document.querySelectorAll("#dev-menu button").length >= 1), "green room camera menu lists cameras");
await a.keyboard.press("Escape");
await shot(a, `${OUT}/01c-home-full.png`, { fullPage: true });
// pick effects
await a.click("#lobby [data-open-fx]");
await a.click('.opt[data-group="bg"][data-value="blur-light"]');
await a.click("#tab-look"); await a.click('.opt[data-group="look"][data-value="warm"]');
await a.click("#tab-light"); await a.click('.opt[data-group="light"][data-value="studio"]');
await a.click("#tab-face"); await a.click('.sw[data-group="lips"][data-value="rose"]');
await a.locator('[data-face="touchup"]').fill("0.6");
if (FACE) await a.waitForFunction(() => document.querySelector('.opt[data-group="warp"] canvas.live'), null, { timeout: 30000 }).then(() => ok(true, "fun face previews show your face")).catch(() => ok(false, "fun face previews show your face"));
await shot(a, `${OUT}/02b-face-tab.png`);
await a.click('.opt[data-group="warp"][data-value="big-eyes"]');
await a.waitForTimeout(800);
faceOk(await a.evaluate(() => !!window.__gr.pipe.fx.face), "face effects follow the face");
await a.click('.opt[data-group="warp"][data-value="none"]');
await a.waitForFunction(() => window.__gr.pipe.fx && window.__gr.pipe.fx.hasMask, null, { timeout: 30000 }).then(() => ok(true, "background segmentation running")).catch(() => ok(false, "background segmentation running"));
if (FACE) await a.waitForFunction(() => !!window.__gr.pipe.vision.lastFace, null, { timeout: 30000 }).then(() => ok(true, "face tracking sees the test face")).catch(() => ok(false, "face tracking sees the test face"));
else faceOk(true, "face tracking sees the test face");
await a.waitForTimeout(1500);
await shot(a, `${OUT}/02-greenroom-effects.png`);
const s = await a.evaluate(() => window.__gr.pipe.settings);
ok(s.bg === "blur-light" && s.look === "warm" && s.light === "studio" && s.lips === "rose" && s.touchup === 0.6 && s.warp === "none", `settings applied ${JSON.stringify(s)}`);
// the rest of the test doesn't need heavy effects; CI machines have no graphics card
await a.evaluate(() => window.__gr.pipe.applySettings({ bg: "none", look: "natural", light: "off", touchup: 0, lips: "none" }));
await a.click("#fx-close");

// no microphone, no call (a page whose microphone is blocked)
// a separate browser profile, like a different person (so it doesn't inherit the host's remembered camera)
const gctx = await browser.newContext({ viewport: { width: 1360, height: 820 }, permissions: ["camera", "microphone"] });
const g = await gctx.newPage();
await g.addInitScript(() => { const md = navigator.mediaDevices, orig = md.getUserMedia.bind(md); md.getUserMedia = (c) => (c && c.audio ? Promise.reject(new DOMException("blocked", "NotAllowedError")) : orig(c)); });
await g.goto(BASE + "?local=1");
await g.waitForFunction(() => window.__gr && window.__gr.pipe.running, null, { timeout: 30000 });
await g.click("#start-btn");
await g.fill("#name", "Blocked");
await g.click("#join-btn");
await g.waitForTimeout(1500);
const gate = await g.evaluate(() => ({ inCall: !!window.__gr.inCall, hint: document.querySelector("#cam-hint").hidden ? "" : document.querySelector("#cam-hint").textContent }));
ok(!gate.inCall && /needs your microphone/.test(gate.hint), `can't join without a microphone ${JSON.stringify(gate)}`);
await shot(g, `${OUT}/01d-mic-required.png`);
await gctx.close();

await a.fill("#name", "Rakesh");
await a.click("#join-btn");
await a.waitForSelector("#call:not([hidden])");
const url = a.url();
ok(/\/[a-z0-9]{3}-[a-z0-9]{3}-[a-z0-9]{3}(\?|$)/.test(url) && !url.includes("#"), `clean room link ${url}`);

const b = await ctx.newPage(); watch(b);
await b.goto(url);
await b.waitForFunction(() => window.__gr && window.__gr.pipe.running, null, { timeout: 30000 });
const bl = await b.evaluate(() => ({ screen: document.body.dataset.screen, title: document.querySelector("#lobby-title").textContent, code: document.querySelector("#lobby-code").textContent }));
ok(bl.screen === "lobby" && bl.title === "Ready to join?" && url.includes(bl.code), `an invite link opens the pre-join page ${JSON.stringify(bl)}`);
// the host turned the camera on last time, so the pre-join page brings it back (same browser)
ok(await b.waitForFunction(() => window.__gr.cam && window.__gr.pipe.camStream, null, { timeout: 40000 }).then(() => true).catch(() => false), "the pre-join page remembers the camera choice");
ok(await b.evaluate(() => [...document.querySelectorAll('#lobby-devices select[data-kind="mic"] option')].length >= 1), "the pre-join page has device pickers");
await shot(b, `${OUT}/02c-lobby-guest.png`);
if (!FACE) await b.evaluate(() => window.__gr.pipe.applySettings({ autoAway: false }));
await b.fill("#name", "Anu");
await b.click("#join-btn");
await a.waitForFunction(() => document.querySelectorAll("#tiles .tile").length === 2, null, { timeout: 40000 });
await b.waitForFunction(() => document.querySelectorAll("#tiles .tile").length === 2, null, { timeout: 40000 });
ok(true, "both see two tiles");
const playing = async (p) => p.waitForFunction(() => { const v = document.querySelector("#tiles .tile:not(.me) video"); return v && v.videoWidth > 0 && v.currentTime > 0.3; }, null, { timeout: 30000 }).then(() => true).catch(() => false);
ok(await playing(a), "host receives the guest's video over WebRTC");
ok(await playing(b), "guest receives the host's processed video over WebRTC");
ok((await a.textContent("#tiles")).includes("Anu") && (await b.textContent("#tiles")).includes("Rakesh"), "names shown on tiles");
const joined = await b.evaluate(() => ({ mic: window.__gr.mic, cam: window.__gr.cam, micOpen: !!window.__gr.pipe.micStream, sending: window.__gr.pipe.sendTrack && window.__gr.pipe.sendTrack.enabled }));
ok(!joined.mic && joined.cam && joined.micOpen && !joined.sending, `guest joins as set on the pre-join page (camera on, muted, microphone ready) ${JSON.stringify(joined)}`);
await a.waitForFunction(() => document.querySelector("#tiles .tile:not(.me)").classList.contains("mic-off"), null, { timeout: 5000 }).then(() => ok(true, "others see the guest is muted")).catch(() => ok(false, "others see the guest is muted"));
await b.click('#call [data-toggle="cam"]');
ok(await b.waitForFunction(() => !window.__gr.cam && !window.__gr.pipe.camStream, null, { timeout: 10000 }).then(() => true).catch(() => false), "turning the camera off in the call closes it");
await b.click('#call [data-toggle="cam"]');
const camOn = await b.waitForFunction(() => window.__gr.cam && window.__gr.pipe.camStream, null, { timeout: 30000 }).then(() => true).catch(() => false);
ok(camOn, "turning the camera on in the call opens it " + (camOn ? "" : JSON.stringify(await b.evaluate(() => ({ cam: window.__gr.cam, open: !!window.__gr.pipe.camStream, pressed: document.querySelector('#call [data-toggle="cam"]').getAttribute("aria-pressed"), toast: document.querySelector("#toasts") && document.querySelector("#toasts").textContent })))));

// refreshing during a call goes straight back into it
await b.reload();
await b.waitForFunction(() => window.__gr && window.__gr.inCall && document.querySelectorAll("#tiles .tile").length === 2, null, { timeout: 40000 }).then(() => ok(true, "refresh rejoins the call without the green room")).catch(() => ok(false, "refresh rejoins the call without the green room"));
// (headless Chromium has no GPU, so the reloaded page spends a while choosing its cutout model)
ok(await b.waitForFunction(() => { const v = document.querySelector("#tiles .tile:not(.me) video"); return v && v.videoWidth > 0 && v.currentTime > 0.3; }, null, { timeout: 90000 }).then(() => true).catch(() => false), "after refresh the guest sees the host again");
await a.waitForFunction(() => document.querySelectorAll("#tiles .tile").length === 2, null, { timeout: 20000 }).catch(() => {});

// unmuting shows on the other side (a refresh rejoins muted)
await a.waitForFunction(() => document.querySelector("#tiles .tile:not(.me)").classList.contains("mic-off"), null, { timeout: 8000 }).catch(() => {});
await b.click('#call [data-toggle="mic"]');
await a.waitForFunction(() => !document.querySelector("#tiles .tile:not(.me)").classList.contains("mic-off"), null, { timeout: 5000 }).then(() => ok(true, "unmuting is shown to others")).catch(() => ok(false, "unmuting is shown to others"));
ok(await b.evaluate(() => window.__gr.pipe.sendTrack.enabled), "unmuted voice is sent");

// reactions
await a.click("#react-btn");
await a.click("#react-pop .react >> nth=0");
await a.waitForTimeout(600);
ok(await a.evaluate(() => window.__gr.pipe.overlay.particles.length > 10), "reaction confetti drawn into the video");
await shot(a, `${OUT}/03-call-host.png`);
await shot(b, `${OUT}/04-call-guest.png`);

// chat
await b.click('[data-panel="chat"]');
await b.fill("#chat-input", "Hello from Anu");
await b.press("#chat-input", "Enter");
await a.waitForFunction(() => document.querySelector("#messages").textContent.includes("Hello from Anu"), null, { timeout: 8000 }).then(() => ok(true, "chat message arrives")).catch(() => ok(false, "chat message arrives"));
ok(await a.isVisible("#chat-dot"), "unread dot shows when chat is closed");
await shot(b, `${OUT}/04b-chat.png`);
await b.click("#side-close");

// raise hand
await b.click("#hand-btn");
await a.waitForFunction(() => [...document.querySelectorAll(".tile")].some((t) => !t.classList.contains("me") && t.classList.contains("hand")), null, { timeout: 8000 }).then(() => ok(true, "raised hand shows for others")).catch(() => ok(false, "raised hand shows for others"));
await a.click('[data-panel="people"]');
ok((await a.textContent("#people-list")).includes("Anu"), "people panel lists everyone");
await shot(a, `${OUT}/04c-people.png`);
await a.click("#side-close");
await b.click("#hand-btn");

// switch microphone mid-call (peers keep a live audio track)
const micSwitch = await b.evaluate(async () => {
  const opts = [...document.querySelectorAll('#call-devices select[data-kind="mic"] option')].map((o) => o.value).filter(Boolean);
  const target = opts.find((v) => v !== window.__gr.pipe.micId) || opts[0];
  const sel = document.querySelector('#call-devices select[data-kind="mic"]');
  sel.value = target; sel.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1500));
  const t = window.__gr.pipe.stream.getAudioTracks();
  return { n: t.length, live: t.every((x) => x.readyState === "live"), options: opts.length };
});
ok(micSwitch.n === 1 && micSwitch.live, `microphone switch keeps one live track ${JSON.stringify(micSwitch)}`);

// noise reduction: strong runs RNNoise on this device and the other side still hears you
const audioIn = (p) => p.evaluate(async () => { let n = 0; for (const pc of window.__gr.room.connections()) (await pc.getStats()).forEach((r) => { if (r.type === "inbound-rtp" && r.kind === "audio") n += r.bytesReceived || 0; }); return n; });
const setSound = (p, v) => p.evaluate(async (v) => { const sel = document.querySelector('#call-devices select[data-noise]'); sel.value = v; sel.dispatchEvent(new Event("change", { bubbles: true })); await new Promise((r) => setTimeout(r, 2000)); const t = window.__gr.pipe.sendTrack; return { mode: window.__gr.pipe.noise, failed: !!window.__gr.pipe.noiseFailed, rnnoise: !!window.__gr.pipe.cleanup, live: t.readyState === "live", tracks: window.__gr.pipe.stream.getAudioTracks().length, sent: window.__gr.room.connections().some((pc) => pc.getSenders().some((x) => x.track === t)) }; }, v);
const strong = await setSound(b, "strong");
const heard0 = await audioIn(a); await a.waitForTimeout(1500); const heard1 = await audioIn(a);
ok(strong.mode === "strong" && !strong.failed && strong.rnnoise && strong.live && strong.tracks === 1 && strong.sent && heard1 > heard0, `strong noise reduction runs on the device and the call still hears you ${JSON.stringify({ ...strong, bytes: heard1 - heard0 })}`);
const orig = await setSound(b, "off");
ok(orig.mode === "off" && !orig.rnnoise && orig.live && orig.sent, `original sound turns processing off ${JSON.stringify(orig)}`);
ok(await b.evaluate(() => { const s = window.__gr.pipe.micStream.getAudioTracks()[0].getSettings(); return s.noiseSuppression !== true && s.echoCancellation !== true; }), "original sound asks the browser for no echo or noise processing");
const std = await setSound(b, "standard");
ok(std.mode === "standard" && std.live && std.sent, "back to standard noise reduction");

// device menus on the mic and camera buttons
await b.click('#call [data-menu="mic"]');
await b.waitForFunction(() => !document.querySelector("#dev-menu").hidden, null, { timeout: 5000 }).catch(() => {});
const micMenu = await b.evaluate(() => ({ open: !document.querySelector("#dev-menu").hidden, items: [...document.querySelectorAll("#dev-menu button")].map((x) => x.textContent), heads: [...document.querySelectorAll("#dev-menu h3")].map((x) => x.textContent) }));
ok(micMenu.open && micMenu.heads.includes("Microphone") && micMenu.heads.includes("Speakers") && micMenu.items.length >= 2, `mic arrow opens microphone and speaker menu ${JSON.stringify(micMenu)}`);
await shot(b, `${OUT}/04f-mic-menu.png`);

const pick = await b.evaluate(() => { const items = [...document.querySelectorAll("#dev-menu button")].slice(0, 3); const t = items.reverse().find((x) => x.getAttribute("aria-checked") === "false"); const label = t.textContent; t.click(); return label; });
await b.waitForFunction((l) => window.__gr.pipe.micStream.getAudioTracks()[0].label === l, pick, { timeout: 10000 }).catch(() => {});
const after = await b.evaluate(() => ({ id: window.__gr.pipe.micId, label: window.__gr.pipe.micStream.getAudioTracks()[0].label, n: window.__gr.pipe.stream.getAudioTracks().length, closed: document.querySelector("#dev-menu").hidden }));
ok(after.label === pick && after.n === 1 && after.closed, `picking a microphone from the menu switches it (${pick} -> ${after.label})`);
await b.click('#call [data-menu="cam"]');
await b.waitForFunction(() => !document.querySelector("#dev-menu").hidden, null, { timeout: 5000 }).catch(() => {});
ok(await b.evaluate(() => document.querySelector("#dev-menu h3").textContent === "Camera" && document.querySelectorAll("#dev-menu button").length >= 1), "camera arrow opens the camera menu");
await b.keyboard.press("Escape");
ok(await b.evaluate(() => document.querySelector("#dev-menu").hidden), "Escape closes the device menu");

// screen sharing
await a.click("#share-btn");
const shared = await b.waitForFunction(() => { const v = document.querySelector("#spotlight .tile.screen video"); return v && v.videoWidth > 0; }, null, { timeout: 20000 }).then(() => true).catch(() => false);
ok(shared, "guest sees the shared screen in the spotlight");
ok(await a.evaluate(() => !!document.querySelector(".tile.screen")), "presenter sees their own screen tile");
await b.waitForTimeout(800);
await shot(b, `${OUT}/04d-screen-guest.png`);
await shot(a, `${OUT}/04e-screen-host.png`);
// pin someone else over the screen
await b.evaluate(() => { const t = [...document.querySelectorAll("#tiles .tile")].find((x) => !x.classList.contains("me") && !x.classList.contains("screen")); t.querySelector('[data-act="pin"]').click(); });
ok(await b.evaluate(() => { const t = document.querySelector("#spotlight .tile"); return t && !t.classList.contains("screen") && !t.classList.contains("me"); }), "pinning moves a person to the spotlight");
await b.evaluate(() => document.querySelector('#spotlight [data-act="pin"]').click());

// recording
await a.click("#rec-btn");
await a.click("#rec-confirm");
const aBadge = await a.evaluate(() => ({ hidden: document.querySelector("#rec-badge").hidden, rec: window.__gr.recorder.recording, dlg: document.querySelector("#rec-dialog").open }));
console.log("      host after confirm:", JSON.stringify(aBadge));
await b.waitForFunction(() => !document.querySelector("#rec-badge").hidden, null, { timeout: 8000, polling: 250 }).then(() => ok(true, "guest sees the REC badge")).catch(async () => ok(false, "guest sees the REC badge " + JSON.stringify(await b.evaluate(() => ({ hidden: document.querySelector("#rec-badge").hidden, recBy: [...window.__gr.recBy.keys()] })))));
ok((await b.textContent("#rec-text")).includes("Rakesh"), `badge names who records: ${await b.textContent("#rec-text")}`);
await a.waitForTimeout(3500);
await shot(a, `${OUT}/05-recording.png`);
await a.click("#share-btn"); // stop sharing
await b.waitForFunction(() => !document.querySelector(".tile.screen"), null, { timeout: 10000 }).then(() => ok(true, "screen tile goes when sharing stops")).catch(() => ok(false, "screen tile goes when sharing stops"));
await a.click("#rec-btn");
await a.waitForSelector("#saved-dialog[open]", { timeout: 10000 });
const size = await a.evaluate(() => window.__gr.lastRecording && window.__gr.lastRecording.size);
ok(size > 20000, `recording made on the device (${size} bytes)`);
await shot(a, `${OUT}/06-saved.png`);
await a.click('#saved-dialog button[value="close"]');
await b.waitForFunction(() => document.querySelector("#rec-badge").hidden, null, { timeout: 8000, polling: 250 }).then(() => ok(true, "badge clears when recording stops")).catch(() => ok(false, "badge clears when recording stops"));

// weak connections: a very weak link pauses video to that one person, keeps the voice, and says why
const idB = await a.evaluate(() => [...window.__gr.peers.keys()][0]);
await a.evaluate((id) => window.__gr.quality.force(id, "bad"), idB);
const pausedSend = await a.waitForFunction((id) => { const s = window.__gr.quality.peers.get(id).sender; return s && s.track === null; }, idB, { timeout: 8000 }).then(() => true).catch(() => false);
ok(pausedSend, "a very weak connection stops sending video to that person");
ok(await b.waitForFunction(() => { const t = document.querySelector("#tiles .tile:not(.me)"); const s = t && t.querySelector(".signal"); return t.classList.contains("video-paused") && s && !s.hidden && s.dataset.tier === "bad"; }, null, { timeout: 8000 }).then(() => true).catch(() => false), "the other person sees the signal indicator and why video paused");
await shot(b, `${OUT}/05b-weak-link.png`);
ok(await b.evaluate(() => { const v = document.querySelector("#tiles .tile:not(.me) video"); return v && v.srcObject && v.srcObject.getAudioTracks().some((t) => t.readyState === "live"); }), "their voice still comes through");
await a.evaluate((id) => window.__gr.quality.force(id, "good"), idB);
ok(await a.waitForFunction((id) => { const s = window.__gr.quality.peers.get(id).sender; return s && s.track === window.__gr.pipe.stream.getVideoTracks()[0]; }, idB, { timeout: 8000 }).then(() => true).catch(() => false), "video resumes when the connection recovers");
ok(await b.waitForFunction(() => !document.querySelector("#tiles .tile:not(.me)").classList.contains("video-paused"), null, { timeout: 8000 }).then(() => true).catch(() => false), "the paused note goes away");
await a.evaluate((id) => window.__gr.quality.force(id, null), idB);
// smaller video for smaller tiles: the guest reports how wide it shows the host, the host sends no more than that
const enc = await a.waitForFunction((id) => {
  const q = window.__gr.quality.peers.get(id); const s = q && q.sender;
  if (!s || !q.view) return null;
  const e = s.getParameters().encodings[0];
  return e && e.scaleResolutionDownBy ? { scale: e.scaleResolutionDownBy, view: q.view, outW: window.__gr.pipe.W, bps: e.maxBitrate } : null;
}, idB, { timeout: 10000 }).then((h) => h.jsonValue()).catch(() => null);
ok(enc && enc.scale >= Math.max(1, enc.outW / enc.view) * 0.9, `video is sized to the tile it's shown in ${JSON.stringify(enc)}`);

// the call fills the window exactly (no page scroll)
ok(await a.evaluate(() => document.documentElement.scrollHeight <= innerHeight), "no page scroll during the call");

// picture-in-picture: Pop out moves the call into a small window, and back
if (await a.evaluate(() => "documentPictureInPicture" in window)) {
  await a.click("#pip-btn");
  const popped = await a.waitForFunction(() => window.__gr.pip.open && !document.getElementById("stage") && document.querySelector(".pip-holder"), null, { timeout: 8000 }).then(() => true).catch(() => false);
  ok(popped, "Pop out moves the call into a picture-in-picture window");
  await a.click(".pip-holder button").catch(() => {});
  ok(await a.waitForFunction(() => !window.__gr.pip.open && document.getElementById("stage") && document.querySelectorAll("#tiles .tile").length === 2, null, { timeout: 8000 }).then(() => true).catch(() => false), "bringing it back restores the call");
} else console.log("SKIP  picture-in-picture (not available in this browser)");

// hanging up asks first
await a.click("#leave-btn");
ok(await a.evaluate(() => document.querySelector("#leave-dialog").open), "Leave asks for confirmation");
await shot(a, `${OUT}/06b-leave.png`);
await a.click('#leave-dialog button[value="stay"]');
ok(await a.evaluate(() => !document.querySelector("#leave-dialog").open && window.__gr.inCall), "Stay keeps you in the call");

// effects panel during the call
await a.click("#call [data-open-fx]");
await a.waitForTimeout(800);
await shot(a, `${OUT}/07-call-effects.png`);

ok(outside.length === 0, `no requests leave the site (${outside.slice(0, 3).join(", ") || "none"})`);
ok(a.errors.length === 0 && b.errors.length === 0, `no errors (${[...a.errors, ...b.errors].slice(0, 3).join(" | ") || "none"})`);

// who can get in: a passcode, and asking before letting people in
await a.close(); await b.close();
// the local handshake only reaches tabs of the same browser, so the guests share it, but they
// mustn't count as the host (whose calls are remembered in local storage)
const hctx = await browser.newContext({ viewport: { width: 1360, height: 820 }, permissions: ["camera", "microphone"] });
// captions: a stand-in for the browser's on-device speech recognition (headless Chromium has no
// language packs). It refuses to run unless asked to stay on the device.
await hctx.addInitScript(() => {
  class FakeSR {
    start(track) {
      if (this.processLocally !== true) throw new Error("not on device");
      if (!track || track.kind !== "audio") throw new Error("no track");
      this.track = track; FakeSR.live.push(this);
    }
    abort() { FakeSR.live = FakeSR.live.filter((r) => r !== this); }
    stop() { this.abort(); }
  }
  FakeSR.prototype.processLocally = false;
  FakeSR.konveneFake = true;
  FakeSR.live = [];
  FakeSR.available = async () => "available";
  FakeSR.install = async () => true;
  FakeSR.say = (text, isFinal) => { for (const r of FakeSR.live) if (r.onresult) r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] }); return FakeSR.live.length; };
  window.SpeechRecognition = FakeSR;
});
const guest = async () => { const p = await hctx.newPage(); await p.addInitScript(() => localStorage.removeItem("konvene_hosted")); watch(p); return p; };
const ready = (p) => p.waitForFunction(() => window.__gr && window.__gr.pipe.running, null, { timeout: 30000 });
const h = await hctx.newPage(); watch(h);
await h.goto(BASE + "?local=1"); await ready(h);
await h.click("#start-btn");
ok(await h.evaluate(() => !document.querySelector("#lobby-sec").hidden && document.querySelector("#pass-row").hidden), "a new call offers a passcode and asking first");
await h.click('label:has(#sec-pass)');
await h.click('label:has(#sec-wait)');
const pass = await h.inputValue("#pass");
ok(pass.length >= 6 && await h.evaluate(() => !document.querySelector("#pass-row").hidden), `passcode made for the call (${pass.length} characters)`);
await h.fill("#name", "Host");
await h.click("#join-btn");
await h.waitForSelector("#call:not([hidden])");
const invite = await h.evaluate(() => window.__grLink(true));
const plain = await h.evaluate(() => window.__grLink(false));
ok(invite.includes("#p=" + pass) && /wait/.test(invite.split("#")[1]) && !plain.includes("p="), `invite link carries the passcode after the # ${invite.replace(pass, "***")}`);
await shot(h, `${OUT}/09-host-locked.png`);

// without the passcode: can't connect, and is told why
const j = await guest();
await j.goto(plain); await ready(j);
ok(await j.evaluate(() => document.querySelector("#pass-row").hidden), "a link without the passcode doesn't show one");
await j.fill("#name", "Guest");
await j.click("#join-btn");
const asked = await j.waitForFunction(() => !document.querySelector("#pass-row").hidden && /passcode/.test(document.querySelector("#lobby-note").textContent), null, { timeout: 20000 }).then(() => true).catch(() => false);
ok(asked && await j.evaluate(() => !window.__gr.inCall && !window.__gr.room), "the wrong passcode can't get in and is asked for the passcode");
ok(await h.waitForFunction(() => /wrong passcode/.test(document.querySelector("#toast").textContent), null, { timeout: 10000 }).then(() => true).catch(() => false), "the call hears that someone tried the wrong passcode");
await shot(j, `${OUT}/09b-passcode-needed.png`);

// with the passcode: asks to join, and sees nothing of the call until let in
await j.fill("#pass", pass);
await j.click("#join-btn");
ok(await j.waitForFunction(() => !document.querySelector("#lobby-wait").hidden, null, { timeout: 10000 }).then(() => true).catch(() => false), "the right passcode asks to join");
ok(await h.waitForFunction(() => /Guest/.test((document.querySelector(".knock") || {}).textContent || ""), null, { timeout: 20000 }).then(() => true).catch(() => false), "the call sees who is asking to join");
const waiting = await j.evaluate(() => ({ peers: window.__gr.peers.size, inCall: window.__gr.inCall, names: [...window.__gr.pending.values()].map((p) => p.name || "") }));
ok(waiting.peers === 0 && !waiting.inCall && waiting.names.every((n) => !n), `nothing of the call reaches someone waiting ${JSON.stringify(waiting)}`);
ok(await h.evaluate(() => document.querySelectorAll("#tiles .tile").length === 1), "someone waiting has no tile in the call");
await shot(h, `${OUT}/09c-knock.png`);
await shot(j, `${OUT}/09d-asking.png`);
await h.click(".knock .btn.primary");
const inNow = await j.waitForFunction(() => window.__gr.inCall && document.querySelectorAll("#tiles .tile").length === 2, null, { timeout: 30000 }).then(() => true).catch(() => false);
ok(inNow && await h.waitForFunction(() => document.querySelectorAll("#tiles .tile").length === 2 && !document.querySelector(".knock"), null, { timeout: 20000 }).then(() => true).catch(() => false), "Let in brings them into the call");

// live captions: turning them on asks the others' browsers to caption their own voices
await h.click("#cc-btn");
ok(await h.evaluate(() => document.querySelector("#cc-btn").getAttribute("aria-pressed") === "true" && !document.querySelector("#captions").hidden), "Captions button turns captions on");
const listening = await j.waitForFunction(() => window.SpeechRecognition.live.length > 0, null, { timeout: 10000 }).then(() => true).catch(() => false);
ok(listening && await j.evaluate(() => window.SpeechRecognition.live.every((r) => r.processLocally === true && r.track.kind === "audio")), "the guest's browser captions its own voice, on the device only");
await j.evaluate(() => window.SpeechRecognition.say("hello from the", false));
await j.waitForTimeout(400);
await j.evaluate(() => window.SpeechRecognition.say("hello from the guest", true));
ok(await h.waitForFunction(() => /Guest.*hello from the guest/.test(document.querySelector("#captions").textContent), null, { timeout: 8000 }).then(() => true).catch(() => false), "the guest's words show as captions for the host");
await h.evaluate(() => window.SpeechRecognition.say("and this is me", true));
ok(await h.waitForFunction(() => /You.*and this is me/.test(document.querySelector("#captions").textContent), null, { timeout: 5000 }).then(() => true).catch(() => false), "your own words show too");
ok(await h.evaluate(() => [...document.querySelectorAll("#captions .cap")].every((c) => getComputedStyle(c).opacity === "1" && c.getBoundingClientRect().height > 10)), "caption lines are visible (home page styles don't leak into the call)");
ok(await j.evaluate(() => document.querySelector("#captions").hidden && !/hello/.test(document.querySelector("#captions").textContent)), "captions show only for people who turned them on");
await shot(h, `${OUT}/10-captions.png`);
await h.click("#cc-btn");
ok(await j.waitForFunction(() => window.SpeechRecognition.live.length === 0, null, { timeout: 8000 }).then(() => true).catch(() => false), "turning captions off stops the others' captioning");

// a second device in the same room: its sound goes off so the room doesn't echo
const quietMenu = async () => { await j.click('#call [data-menu="mic"]'); await j.click("#dev-menu [data-quiet]"); };
await quietMenu();
ok(await j.evaluate(() => { const v = [...document.querySelectorAll("video[data-remote]")]; return window.__gr.quiet && !window.__gr.mic && v.length > 0 && v.every((x) => x.muted); }), "sound off on this device: microphone off and the others muted");
await j.click('#call [data-toggle="mic"]');
ok(await j.evaluate(() => !window.__gr.mic), "the microphone stays off while this device's sound is off");
ok(await h.waitForFunction(() => document.querySelector("#tiles .tile:not(.me)").classList.contains("quiet"), null, { timeout: 8000 }).then(() => true).catch(() => false), "the others see that device's sound is off");
await quietMenu();
ok(await j.evaluate(() => !window.__gr.quiet && [...document.querySelectorAll("video[data-remote]")].every((x) => !x.muted)), "turning sound back on unmutes the others");

// not let in
const k = await guest();
await k.goto(invite); await ready(k);
ok(await k.evaluate((pw) => document.querySelector("#pass").value === pw && !document.querySelector("#pass-row").hidden, pass), "the full invite link fills in the passcode");
await k.fill("#name", "Stranger");
await k.click("#join-btn");
await h.waitForFunction(() => /Stranger/.test((document.querySelector(".knock") || {}).textContent || ""), null, { timeout: 20000 }).catch(() => {});
ok(await j.waitForFunction(() => /Stranger/.test((document.querySelector(".knock") || {}).textContent || ""), null, { timeout: 10000 }).then(() => true).catch(() => false), "everyone in the call sees the knock");
await h.click(".knock .btn.secondary");
ok(await k.waitForFunction(() => /didn't let you in/.test(document.querySelector("#lobby-note").textContent) && !window.__gr.room, null, { timeout: 15000 }).then(() => true).catch(() => false), "Don't let in sends them away and tells them");
ok(await j.waitForFunction(() => !document.querySelector(".knock"), null, { timeout: 8000 }).then(() => true).catch(() => false), "the knock goes away for everyone once answered");
ok(outside.length === 0, `still no requests leave the site (${outside.slice(0, 3).join(", ") || "none"})`);
ok(h.errors.length === 0 && j.errors.length === 0 && k.errors.length === 0, `no errors in the passcode and waiting room pages (${[...h.errors, ...j.errors, ...k.errors].slice(0, 3).join(" | ") || "none"})`);
await hctx.close();

// phone layout
const m = await browser.newPage({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, permissions: ["camera", "microphone"] });
await m.goto(BASE + "?local=1");
await m.waitForTimeout(2500);
const wide = await m.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > 391).slice(0, 4).map((e) => e.tagName + "." + e.className + " " + Math.round(e.getBoundingClientRect().right)));
ok((await m.evaluate(() => document.documentElement.scrollWidth)) <= 390, `phone home page fits without sideways scroll ${wide.join(", ")}`);
await shot(m, `${OUT}/08-phone.png`, { fullPage: true });
await m.click("#start-btn");
await m.waitForTimeout(1500);
ok((await m.evaluate(() => document.body.dataset.screen === "lobby" && document.documentElement.scrollWidth <= 390)), "phone pre-join page fits without sideways scroll");
await shot(m, `${OUT}/08b-phone-lobby.png`, { fullPage: true });
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
