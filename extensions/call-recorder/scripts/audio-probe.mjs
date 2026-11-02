// Records a speech file through the REAL microphone path (the browser feeds the file in as a fake microphone)
// in several variants, and measures each result with ffmpeg. Use it when a recording sounds wrong.
//   SPEECH_WAV=tests/fixtures/voice.wav node scripts/audio-probe.mjs      (needs `npm run build:dev` first)
//   ONLY=1,2 limits which variants run. VARIANTS can be edited below.
// "floor" is the loudness of the quietest tenth of the recording (the pauses), "speech" the loudest tenth.
// A good result keeps speech where it was and pushes the floor far down.
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const speech = process.env.SPEECH_WAV;
if (!speech) { console.error("Set SPEECH_WAV to a speech .wav file."); process.exit(1); }

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(path.join(execSync("npm root -g").toString().trim(), "playwright")); }

const ext = mkdtempSync(path.join(tmpdir(), "audio-probe-ext-"));
cpSync("dist-dev", ext, { recursive: true });
await build({ entryPoints: { harness: "tests/browser/harness.js" }, outdir: ext, bundle: true, format: "iife", target: "chrome116", define: { __DEV_BUILD__: "true" }, logLevel: "error" });
writeFileSync(path.join(ext, "harness.html"), '<!doctype html><meta charset="utf-8"><pre id="out">running</pre><script src="harness.js"></script>');

const seconds = Number(process.env.SECONDS ?? 12);
const fromEnv = process.env.VARIANTS?.split("#").map((v) => { const [name, q] = v.split("|"); return { name, q: `${q}&seconds=${seconds}&dump=1` }; });
const variants = fromEnv ?? [
  { name: "noise reduction ON,  WebM Opus", q: `mic=real&tab=silent&noise=on&seconds=${seconds}&dump=1&profile=video/webm;codecs=vp9,opus` },
  { name: "noise reduction OFF, WebM Opus", q: `mic=real&tab=silent&noise=off&seconds=${seconds}&dump=1&profile=video/webm;codecs=vp9,opus` },
  { name: "noise reduction ON,  MP4 Opus ", q: `mic=real&tab=silent&noise=on&seconds=${seconds}&dump=1&profile=video/mp4;codecs=avc1,opus` },
];

/** RMS in dB for every quarter second, using ffmpeg. */
function windows(file) {
  const out = execSync(`ffmpeg -hide_banner -nostats -loglevel error -i "${file}" -vn -af "asetnsamples=n=12000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-" -f null - 2>/dev/null || true`, { encoding: "utf8", shell: "/bin/bash" });
  return out.split("\n").filter((l) => l.includes("RMS_level")).map((l) => { const v = Number(l.split("=")[1]); return Number.isFinite(v) ? Math.max(v, -99) : -99; });
}
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const only = process.env.ONLY;
if (process.env.KEEP_DIR) mkdirSync(process.env.KEEP_DIR, { recursive: true });
const userDir = mkdtempSync(path.join(tmpdir(), "audio-probe-profile-"));
const context = await playwright.chromium.launchPersistentContext(userDir, {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${path.resolve(speech)}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  for (const [index, v] of variants.entries()) {
    if (only && !only.split(",").includes(String(index + 1))) continue;
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") console.log("   console:", m.text()); });
    await page.goto(`chrome-extension://${id}/harness.html?${v.q}`);
    await page.waitForFunction(() => window.__result || window.__error, null, { timeout: 120_000 });
    const err = await page.evaluate(() => window.__error);
    const r = await page.evaluate(() => window.__result);
    console.log(`\n${v.name}`);
    if (err) { console.log("   ERROR:", err); await page.close(); continue; }
    const keep = process.env.KEEP_DIR ?? userDir; // set KEEP_DIR to keep the recordings, for scripts/audio-quality.py
    const file = path.join(keep, `${process.env.TAG ?? "probe"}-${index + 1}.${r.profile.includes("mp4") ? "mp4" : "webm"}`);
    writeFileSync(file, Buffer.from(r.fileBase64, "base64"));
    const w = windows(file).slice(1, -1); // the first and last windows are partial
    const floor = pct(w, 0.1), loud = pct(w, 0.9);
    console.log(`   ${r.profile}  ${r.fileSize} bytes   speech ${loud.toFixed(0)} dB   floor ${floor.toFixed(0)} dB   gap ${(loud - floor).toFixed(0)} dB   switched off by safety net: ${r.levelTrace.some((l) => l.bypassed)}`);
    await page.close();
  }
} finally {
  await context.close();
  rmSync(ext, { recursive: true, force: true });
  rmSync(userDir, { recursive: true, force: true });
}
