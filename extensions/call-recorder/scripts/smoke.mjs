// Loads the built extension into a real Chromium and checks what unit tests cannot:
// the service worker answers, the pages render in Konvene's fonts, the Konvene bridge works on a real page,
// the offscreen engine starts, and the whole recording pipeline runs with synthetic inputs.
// What it cannot do is click the extension icon, so real tab capture is the one thing left for a person to try.
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(execSync("npm root -g").toString().trim(), "playwright")); }
const { chromium } = playwright;

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`); };

// ---- a copy of the dev build that also contains the engine harness page ----
const ext = mkdtempSync(path.join(tmpdir(), "call-recorder-ext-"));
const standinDir = mkdtempSync(path.join(tmpdir(), "call-recorder-standin-"));
cpSync("dist-dev", ext, { recursive: true });
await build({ entryPoints: { harness: "tests/browser/harness.js" }, outdir: ext, bundle: true, format: "iife", target: "chrome116", define: { __DEV_BUILD__: "true" }, logLevel: "error" });
await build({ entryPoints: { standin: "tests/browser/standInCallPage.js" }, outdir: standinDir, bundle: true, format: "iife", target: "chrome116", define: { __DEV_BUILD__: "true" }, logLevel: "error" });
writeFileSync(path.join(ext, "harness.html"), '<!doctype html><meta charset="utf-8"><pre id="out">running</pre><script src="harness.js"></script>');

// ---- two tiny pages on localhost:8790: one behaves like patched Konvene, one like an old Konvene ----
const server = http.createServer((req, res) => {
  const ack = req.url === "/ack";
  res.setHeader("content-type", "text/html");
  res.end(`<!doctype html><title>Konvene test</title><body>konvene ${req.url}<script>
    ${ack ? `window.addEventListener("message", (e) => { const m = e.data; if (m && m.source === "konvene-recorder-extension") window.postMessage({ source: "konvene-page", recording: m.recording }, location.origin); });` : ""}
  </script>`);
});
await new Promise((r) => server.listen(8790, r));
// The stand-in call page lives on another port, where the extension's own scripts do not run, so the test can play the relay.
const standin = http.createServer((req, res) => {
  if (req.url === "/standin.js") { res.setHeader("content-type", "text/javascript"); res.end(readFileSync(path.join(standinDir, "standin.js"))); return; }
  res.setHeader("content-type", "text/html");
  res.end('<!doctype html><title>Stand-in call</title><body>call<script src="/standin.js"></script>');
});
await new Promise((r) => standin.listen(8791, r));

const userDir = mkdtempSync(path.join(tmpdir(), "call-recorder-profile-"));
// A recorded voice, played to the browser as if it were the microphone (see tests/fixtures).
const voiceFile = path.resolve("tests/fixtures/voice.wav");
const context = await chromium.launchPersistentContext(userDir, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-ui-for-media-stream", "--disable-features=WebRtcHideLocalIpsWithMdns", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${voiceFile}`, "--autoplay-policy=no-user-gesture-required"],
});

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
  const id = new URL(worker.url()).host;
  check("service worker registers", true, id);

  // ---- pages ----
  const errors = [];
  const open = async (file) => {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${file}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${file}: ${m.text()}`); });
    await page.goto(`chrome-extension://${id}/${file}`);
    return page;
  };
  const setup = await open("setup.html");
  await setup.waitForSelector("#default-folder:not(:empty)");
  check("setup page shows the default folder", (await setup.textContent("#default-folder")) === "Downloads/Call Recordings");
  const fonts = await setup.evaluate(async () => { await document.fonts.ready; return [document.fonts.check('16px "Instrument Sans"'), document.fonts.check('16px "Bricolage Grotesque"')]; });
  check("brand fonts load from the extension", fonts[0] && fonts[1]);
  const h1 = await setup.evaluate(() => getComputedStyle(document.querySelector("h1")).fontFamily);
  check("headings use Bricolage Grotesque", h1.includes("Bricolage"), h1);
  const ink = await setup.evaluate(() => getComputedStyle(document.body).color);
  check("text uses the bottle green ink", ink === "rgb(16, 38, 31)", ink);

  const library = await open("library.html");
  await library.waitForSelector("#empty:not([hidden])");
  check("library shows its empty state", true);
  const popup = await open("popup.html");
  await popup.waitForTimeout(500);
  check("popup renders", (await popup.textContent("body")).includes("Call Recorder"));

  // ---- messaging into the real service worker ----
  const ask = (type, payload = {}) => setup.evaluate(([t, p]) => chrome.runtime.sendMessage({ channel: "background", type: t, payload: p }), [type, payload]);
  const status = await ask("recording/status");
  check("service worker answers recording/status", status?.ok === true && status.data.phase === "idle", JSON.stringify(status));
  const unknown = await ask("nope");
  check("service worker rejects unknown messages", unknown?.ok === false);

  // ---- the Konvene bridge on a real page ----
  const konvene = await context.newPage();
  await konvene.goto("http://localhost:8790/ack");
  const oldKonvene = await context.newPage();
  await oldKonvene.goto("http://localhost:8790/noack");
  // Without the "tabs" permission a tab cannot be found by its address, so the focused tab is used instead.
  const tabId = async (page) => { await page.bringToFront(); return worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id); };
  const toTab = (tab, recording) => worker.evaluate(([t, r]) => chrome.tabs.sendMessage(t, { type: "konvene-recorder/recording-state", recording: r }), [tab, recording]);
  const ackTab = await tabId(konvene);
  const noAckTab = await tabId(oldKonvene);
  check("bridge reports the badge shown when the page confirms", (await toTab(ackTab, true))?.shown === true);
  check("bridge reports not shown when the page stays silent", (await toTab(noAckTab, true))?.shown === false);

  // ---- the start path: tab capture needs a real click on the extension icon, which a script cannot do ----
  // (Without that click Chrome also hides the tab's address, so the site is not recognised and consent is confirmed here.)
  const start = await ask("recording/start", { tabId: ackTab, consentConfirmed: true, computerSound: false });
  check("start refuses cleanly when tab capture is not allowed without a click", start?.ok === false && /cannot be recorded|capture/i.test(start.error), start?.error);
  const afterFail = await ask("recording/list");
  check("the failed attempt is listed as failed, not left recording", afterFail?.data?.[0]?.status === "failed", afterFail?.data?.[0]?.status);

  // ---- the offscreen engine ----
  await worker.evaluate(() => chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA"], justification: "test" }));
  await new Promise((r) => setTimeout(r, 500));
  const engine = await setup.evaluate(() => chrome.runtime.sendMessage({ channel: "offscreen", type: "engine/status", payload: {} }));
  check("offscreen engine answers", engine?.ok === true && engine.data.recording === false, JSON.stringify(engine));
  const missing = await setup.evaluate(() => chrome.runtime.sendMessage({ channel: "offscreen", type: "engine/export", payload: { stagingName: "does-not-exist", fileName: "x.webm", mimeType: "video/webm" } }));
  check("exporting a missing file fails with an error, not a hang", missing?.ok === false, missing?.error);

  // ---- saving: the type Chrome sees decides the file's extension (an untyped file was saved as ".txt") ----
  await setup.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 160; c.height = 90; const g = c.getContext("2d");
    const t = setInterval(() => { g.fillStyle = `hsl(${Math.random() * 360}, 60%, 40%)`; g.fillRect(0, 0, 160, 90); }, 30);
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: "video/webm;codecs=vp9" });
    const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data); rec.start(200);
    await new Promise((r) => setTimeout(r, 1200)); rec.stop(); await new Promise((r) => (rec.onstop = r)); clearInterval(t);
    const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle("recordings", { create: true });
    const w = await (await dir.getFileHandle("smoke-export", { create: true })).createWritable(); await w.write(new Blob(chunks)); await w.close();
  });
  for (const [mime, expected] of [["video/webm;codecs=vp9,opus", "video/webm"], ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4"]]) {
    const exported = await setup.evaluate((m) => chrome.runtime.sendMessage({ channel: "offscreen", type: "engine/export", payload: { stagingName: "smoke-export", fileName: "x", mimeType: m } }), mime);
    const saved = await worker.evaluate(async (url) => {
      const dl = await chrome.downloads.download({ url, filename: "Call Recordings/smoke.bin", conflictAction: "uniquify", saveAs: false });
      for (let i = 0; i < 50; i++) { const [it] = await chrome.downloads.search({ id: dl }); if (it.state !== "in_progress") return it.mime; await new Promise((r) => setTimeout(r, 100)); }
      return "timeout";
    }, exported.data.blobUrl);
    check(`a saved file is served as ${expected}, not plain text`, saved === expected, `got ${saved}`);
  }
  await setup.evaluate(() => chrome.runtime.sendMessage({ channel: "offscreen", type: "engine/release", payload: { stagingName: "smoke-export", deleteStaging: true } }));

  // ---- the whole pipeline with synthetic inputs ----
  const harness = await context.newPage();
  harness.on("pageerror", (e) => errors.push(`harness: ${e.message}`));
  const warnings = [];
  harness.on("console", (m) => { if (m.type() === "warning") warnings.push(m.text()); });
  await harness.goto(`chrome-extension://${id}/harness.html`);
  await harness.waitForFunction(() => window.__result || window.__error, null, { timeout: 60_000 });
  const err = await harness.evaluate(() => window.__error);
  const r = await harness.evaluate(() => window.__result);
  if (err) check("engine pipeline runs end to end", false, err);
  else {
    console.log("      engine result:", JSON.stringify(r));
    check("engine pipeline runs end to end", true, r.profile);
    check("recording was readable on disk while still recording", r.midSize > 0, `${r.midSize} bytes`);
    check("file has the size the engine reported", r.fileSize === r.capture.sizeBytes, `${r.fileSize} vs ${r.capture.sizeBytes}`);
    check("file plays with the video size we asked for", r.width === 640 && r.height === 360, `${r.width}x${r.height}`);
    check("file holds about five seconds of mono sound", r.audioSeconds >= 3.5 && r.audioSeconds <= 7 && r.audioChannels === 1, `${r.audioSeconds}s, ${r.audioChannels} ch`);
    check("the sound is not silent", r.audioPeak > 0.01, `peak ${r.audioPeak}`);
  }

  // ---- a real voice through the real microphone request, with noise reduction on ----
  // This is the check that was missing when a recording came out silent: RNNoise could not start inside the
  // extension (WebAssembly was blocked) and produced silence without any error. Tones hid it. A voice does not.
  const voice = await context.newPage();
  voice.on("pageerror", (e) => errors.push(`voice harness: ${e.message}`));
  await voice.goto(`chrome-extension://${id}/harness.html?mic=real&tab=silent&noise=on&seconds=6`);
  await voice.waitForFunction(() => window.__result || window.__error, null, { timeout: 60_000 });
  const voiceError = await voice.evaluate(() => window.__error);
  const v = await voice.evaluate(() => window.__result);
  if (voiceError) check("a voice is recorded with noise reduction on", false, voiceError);
  else {
    const early = v.rmsPerSecond.slice(0, 4);
    const mean = early.reduce((a, b) => a + b, 0) / early.length;
    console.log("      voice loudness per second:", v.rmsPerSecond.join(" "));
    check("a voice is recorded with noise reduction on", mean > 0.04, `mean ${mean.toFixed(3)} over the first seconds`);
    check("noise reduction did not have to be bypassed for a normal voice", !v.levelTrace.some((l) => l.bypassed));
    check("the recording reports that sound was detected", v.capture.soundDetected === true);
  }

  // ---- the extension's own scripts on a supported call page ----
  const callPage = await context.newPage();
  callPage.on("pageerror", (e) => errors.push(`call page: ${e.message}`));
  await callPage.goto("http://localhost:8790/ack");
  const hooked = await callPage.evaluate(() => /watch/.test(MediaDevices.prototype.getDisplayMedia.toString()));
  check("the share hook is installed in the call page itself", hooked);
  const relayed = await callPage.evaluate(
    () => new Promise((resolve) => {
      window.addEventListener("message", (e) => { if (e.data?.source === "call-recorder-share-relay" && e.data.id === 7) resolve(e.data.reply); });
      window.postMessage({ source: "call-recorder-share-page", id: 7, type: "offer", payload: { shareId: "x", kind: "tab", offer: "sdp" } }, location.origin);
      setTimeout(() => resolve("no reply"), 5000);
    }),
  );
  check("a share offered while nothing is recording is answered 'not recorded', through the relay and the service worker", relayed?.answer === null, JSON.stringify(relayed));
  await callPage.close();

  // ---- shared sound end to end: stand-in call page, WebRTC across two pages, real mix and file ----
  // One page plays the recorder, another plays the call page. The call page shares a fake screen, stops sharing
  // after a while, and the recording must hold that sound only while it was shared.
  for (const kind of ["tab", "screen"]) {
    const surface = kind === "screen" ? "monitor" : "browser";
    const recorder = await context.newPage();
    recorder.on("pageerror", (e) => errors.push(`${kind} recorder: ${e.message}`));
    await recorder.goto(`chrome-extension://${id}/harness.html?noise=off&seconds=11`);
    await recorder.waitForFunction(() => window.__share, null, { timeout: 30_000 });
    const call = await context.newPage();
    call.on("pageerror", (e) => errors.push(`${kind} call page: ${e.message}`));
    await call.exposeFunction("__bridge", async (type, payload) => {
      try {
        if (type === "offer") return { answer: await recorder.evaluate((o) => window.__share.offer(o), payload) };
        await recorder.evaluate((shareId) => window.__share.end(shareId), payload.shareId);
        return {};
      } catch { return { answer: null }; }
    });
    await call.goto("http://localhost:8791/");
    await call.evaluate(() => window.__recording(true));
    await recorder.waitForTimeout(2000);
    await call.evaluate((s) => window.__startShare(s), surface); // sharing starts about two seconds in
    await recorder.waitForTimeout(4000);
    await call.evaluate(() => window.__stopSharing()); // and stops about six seconds in
    await recorder.waitForFunction(() => window.__result || window.__error, null, { timeout: 60_000 });
    const failure = await recorder.evaluate(() => window.__error);
    const x = await recorder.evaluate(() => window.__result);
    await call.close();
    if (failure) { check(`sound shared from a ${kind} is recorded`, false, failure); continue; }
    const avg = (a) => a.reduce((p, c) => p + c, 0) / Math.max(1, a.length);
    console.log(`      ${kind}: shared tone per second`, x.sharedTonePerSecond.join(" "), "| call tone", x.callTonePerSecond.join(" "));
    const before = x.sharedTonePerSecond.slice(0, 1), during = x.sharedTonePerSecond.slice(3, 5), after = x.sharedTonePerSecond.slice(8, 11);
    check(`sound shared from a ${kind} is recorded while it is shared, and not before or after`, avg(before) < 0.01 && avg(during) > 0.03 && avg(after) < 0.01, `before ${avg(before).toFixed(3)}, during ${avg(during).toFixed(3)}, after ${avg(after).toFixed(3)}`);
    const callBefore = avg(x.callTonePerSecond.slice(0, 1)), callDuring = avg(x.callTonePerSecond.slice(3, 5)), callAfter = avg(x.callTonePerSecond.slice(8, 11));
    if (kind === "tab") check("a shared tab leaves the call's own sound in the recording", callDuring > 0.3 && callAfter > 0.3, `${callBefore.toFixed(3)}, ${callDuring.toFixed(3)}, ${callAfter.toFixed(3)}`);
    else check("a whole screen's sound replaces the call tab's copy, and the copy comes back when sharing stops", callBefore > 0.3 && callDuring < 0.1 && callAfter > 0.3, `${callBefore.toFixed(3)}, ${callDuring.toFixed(3)}, ${callAfter.toFixed(3)}`);
  }

  check("RNNoise noise reduction loaded in the engine", !warnings.some((w) => /RNNoise/.test(w)), warnings.join(" | "));
  check("no errors in any page console", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("smoke test ran to the end", false, e instanceof Error ? e.message : String(e));
} finally {
  await context.close();
  server.close();
  standin.close();
  rmSync(standinDir, { recursive: true, force: true });
  rmSync(ext, { recursive: true, force: true });
  rmSync(userDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
