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
await shot(a, `${OUT}/01-greenroom.png`);
const defaults = await a.evaluate(() => window.__gr.pipe.settings);
ok(defaults.expressions === false && defaults.autoAway && defaults.autoLight && defaults.mutedHint && !defaults.autoFrame, `smart defaults (expressions off) ${JSON.stringify(defaults)}`);
// Chromium's fake camera shows no face, so "step away" would pause the video; keep it live
if (!FACE) await a.evaluate(() => window.__gr.pipe.applySettings({ autoAway: false }));
const off = await a.evaluate(() => ({ cam: window.__gr.cam, mic: window.__gr.mic, camOpen: !!window.__gr.pipe.camStream, micOpen: !!window.__gr.pipe.micStream }));
ok(!off.cam && !off.mic && !off.camOpen && !off.micOpen, `camera and microphone are off and closed on load ${JSON.stringify(off)}`);
await a.click('#prejoin [data-toggle="cam"]');
ok(await a.waitForFunction(() => window.__gr.cam && window.__gr.pipe.camStream && window.__gr.pipe.video.videoWidth > 0, null, { timeout: 15000 }).then(() => true).catch(() => false), "camera button opens the camera");
await a.waitForTimeout(500);
const res = await a.evaluate(() => ({ cam: window.__gr.pipe.video.videoWidth + "x" + window.__gr.pipe.video.videoHeight, out: window.__gr.pipe.out.width + "x" + window.__gr.pipe.out.height }));
ok(res.cam === res.out, `outgoing video matches the camera resolution ${JSON.stringify(res)}`);
await a.click('#prejoin [data-menu="mic"]');
await a.waitForFunction(() => !document.querySelector("#dev-menu").hidden, null, { timeout: 5000 }).catch(() => {});
const devs = await a.evaluate(() => [...document.querySelectorAll("#dev-menu h3, #dev-menu button")].map((x) => x.textContent));
ok(devs.includes("Microphone") && devs.includes("Speakers") && devs.length >= 4, `green room mic menu lists devices ${JSON.stringify(devs)}`);
await shot(a, `${OUT}/01b-greenroom-menu.png`);
await a.keyboard.press("Escape");
await a.click('#prejoin [data-menu="cam"]');
await a.waitForFunction(() => !document.querySelector("#dev-menu").hidden, null, { timeout: 5000 }).catch(() => {});
ok(await a.evaluate(() => document.querySelectorAll("#dev-menu button").length >= 1), "green room camera menu lists cameras");
await a.keyboard.press("Escape");
await shot(a, `${OUT}/01c-home-full.png`, { fullPage: true });
// pick effects
await a.click("#prejoin [data-open-fx]");
await a.click('.opt[data-group="bg"][data-value="blur-strong"]');
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
ok(s.bg === "blur-strong" && s.look === "warm" && s.light === "studio" && s.lips === "rose" && s.touchup === 0.6 && s.warp === "none", `settings applied ${JSON.stringify(s)}`);
await a.click("#fx-close");

// no microphone, no call (a page whose microphone is blocked)
const g = await ctx.newPage();
await g.addInitScript(() => { const md = navigator.mediaDevices, orig = md.getUserMedia.bind(md); md.getUserMedia = (c) => (c && c.audio ? Promise.reject(new DOMException("blocked", "NotAllowedError")) : orig(c)); });
await g.goto(BASE + "?local=1");
await g.waitForFunction(() => window.__gr && window.__gr.pipe.running, null, { timeout: 30000 });
await g.fill("#name", "Blocked");
await g.click("#join-btn");
await g.waitForTimeout(1500);
const gate = await g.evaluate(() => ({ inCall: !!window.__gr.inCall, hint: document.querySelector("#cam-hint").hidden ? "" : document.querySelector("#cam-hint").textContent }));
ok(!gate.inCall && /needs your microphone/.test(gate.hint), `can't join without a microphone ${JSON.stringify(gate)}`);
await shot(g, `${OUT}/01d-mic-required.png`);
await g.close();

await a.fill("#name", "Rakesh");
await a.click("#join-btn");
await a.waitForSelector("#call:not([hidden])");
const url = a.url();
ok(/\/[a-z0-9]{3}-[a-z0-9]{3}-[a-z0-9]{3}(\?|$)/.test(url) && !url.includes("#"), `clean room link ${url}`);

const b = await ctx.newPage(); watch(b);
await b.goto(url);
await b.waitForFunction(() => window.__gr && window.__gr.pipe.running, null, { timeout: 30000 });
ok(await b.isVisible("#invite-note"), "guest sees which call they're joining");
if (!FACE) await b.evaluate(() => window.__gr.pipe.applySettings({ autoAway: false }));
await b.fill("#name", "Anu");
await b.click("#join-btn");
await a.waitForFunction(() => document.querySelectorAll("#tiles .tile").length === 2, null, { timeout: 20000 });
await b.waitForFunction(() => document.querySelectorAll("#tiles .tile").length === 2, null, { timeout: 20000 });
ok(true, "both see two tiles");
const playing = async (p) => p.waitForFunction(() => { const v = document.querySelector("#tiles .tile:not(.me) video"); return v && v.videoWidth > 0 && v.currentTime > 0.3; }, null, { timeout: 30000 }).then(() => true).catch(() => false);
ok(await playing(a), "host receives the guest's video over WebRTC");
ok(await playing(b), "guest receives the host's processed video over WebRTC");
ok((await a.textContent("#tiles")).includes("Anu") && (await b.textContent("#tiles")).includes("Rakesh"), "names shown on tiles");
const joined = await b.evaluate(() => ({ mic: window.__gr.mic, cam: window.__gr.cam, micOpen: !!window.__gr.pipe.micStream, sending: window.__gr.pipe.sendTrack && window.__gr.pipe.sendTrack.enabled }));
ok(!joined.mic && !joined.cam && joined.micOpen && !joined.sending, `guest joins muted with camera off, microphone ready ${JSON.stringify(joined)}`);
await a.waitForFunction(() => document.querySelector("#tiles .tile:not(.me)").classList.contains("mic-off"), null, { timeout: 5000 }).then(() => ok(true, "others see the guest is muted")).catch(() => ok(false, "others see the guest is muted"));
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

// device menus on the mic and camera buttons
await b.click('#call [data-menu="mic"]');
await b.waitForFunction(() => !document.querySelector("#dev-menu").hidden, null, { timeout: 5000 }).catch(() => {});
const micMenu = await b.evaluate(() => ({ open: !document.querySelector("#dev-menu").hidden, items: [...document.querySelectorAll("#dev-menu button")].map((x) => x.textContent), heads: [...document.querySelectorAll("#dev-menu h3")].map((x) => x.textContent) }));
ok(micMenu.open && micMenu.heads.includes("Microphone") && micMenu.heads.includes("Speakers") && micMenu.items.length >= 2, `mic arrow opens microphone and speaker menu ${JSON.stringify(micMenu)}`);
await shot(b, `${OUT}/04f-mic-menu.png`);
const before = await b.evaluate(() => window.__gr.pipe.micId);
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

// effects panel during the call
await a.click("#call [data-open-fx]");
await a.waitForTimeout(800);
await shot(a, `${OUT}/07-call-effects.png`);

ok(outside.length === 0, `no requests leave the site (${outside.slice(0, 3).join(", ") || "none"})`);
ok(a.errors.length === 0 && b.errors.length === 0, `no errors (${[...a.errors, ...b.errors].slice(0, 3).join(" | ") || "none"})`);

// phone layout
const m = await browser.newPage({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, permissions: ["camera", "microphone"] });
await m.goto(BASE + "?local=1");
await m.waitForTimeout(2500);
const wide = await m.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > 391).slice(0, 4).map((e) => e.tagName + "." + e.className + " " + Math.round(e.getBoundingClientRect().right)));
ok((await m.evaluate(() => document.documentElement.scrollWidth)) <= 390, `phone green room fits without sideways scroll ${wide.join(", ")}`);
await shot(m, `${OUT}/08-phone.png`, { fullPage: true });
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
