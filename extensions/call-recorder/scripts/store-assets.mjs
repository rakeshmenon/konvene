// Makes the Chrome Web Store graphics and the privacy policy page.
// The screenshots are the real extension pages from dist/, filled with sample data, framed in Konvene's colours.
// Run `npm run build` first. Output goes to store/screenshots, store/promo and store/privacy-policy.html.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(execSync("npm root -g").toString().trim(), "playwright")); }
const { chromium } = playwright;

const DIST = path.resolve("dist");
const OUT = { shots: "store/screenshots", promo: "store/promo", tmp: "store/.tmp" };
for (const d of Object.values(OUT)) mkdirSync(d, { recursive: true });
const fontUrl = (f) => pathToFileURL(path.join(DIST, "fonts", f)).href;
const logoSvg = readFileSync("static/icons/logo.svg", "utf8");

// ---------- sample data ----------
const at = (day, h, m) => Date.UTC(2026, 10, day, h, m);
const rec = (o) => ({ tabId: 1, stagingName: "x", mimeType: "video/mp4", status: "saved", ...o });
const LIBRARY = [
  rec({ id: "5", startedAt: at(2, 5, 35), durationMs: 2530_000, sizeBytes: 86_400_000, siteId: "konvene", siteName: "Konvene", host: "konvene-calls.netlify.app", tabTitle: "Design review", fileName: "a.mp4", location: { kind: "downloads", downloadId: 5, path: "/Users/you/Downloads/Call Recordings/call-2026-11-02-1105-konvene.mp4" } }),
  rec({ id: "4", startedAt: at(1, 9, 0), durationMs: 3725_000, sizeBytes: 131_000_000, siteId: "google-meet", siteName: "Google Meet", host: "meet.google.com", tabTitle: "Weekly planning", fileName: "b.mp4", location: { kind: "downloads", downloadId: 4, path: "/Users/you/Downloads/Call Recordings/call-2026-11-01-1430-google-meet.mp4" } }),
  rec({ id: "3", startedAt: at(1, 4, 0), durationMs: 912_000, sizeBytes: 31_000_000, siteId: "google-meet", siteName: "Google Meet", host: "meet.google.com", tabTitle: "Customer call", fileName: "c.mp4", status: "unfinished", error: "This recording was cut short." }),
  rec({ id: "2", startedAt: at(0, 8, 45), durationMs: 1210_000, sizeBytes: 44_000_000, siteId: "web", siteName: "whereby.com", host: "whereby.com", tabTitle: "Interview with Priya", fileName: "d.webm", mimeType: "video/webm", location: { kind: "folder", folderName: "Calls" } }),
];
const MEET = { siteId: "google-meet", siteName: "Google Meet", host: "meet.google.com", tabTitle: "Weekly planning", consent: "recorder-confirms" };
const KONVENE = { siteId: "konvene", siteName: "Konvene", host: "konvene-calls.netlify.app", tabTitle: "Design review", consent: "badge" };

// ---------- the real pages, with a stand-in for the chrome.* APIs ----------
function stubChrome(data) {
  const reply = (type) => {
    const v = data.replies[type];
    if (v && v.startedAgoMs) return { ...v, startedAt: Date.now() - v.startedAgoMs };
    return v === undefined ? {} : JSON.parse(JSON.stringify(v));
  };
  window.chrome = {
    runtime: { sendMessage: async (m) => ({ ok: true, data: reply(m.type) }), onMessage: { addListener() {} }, getURL: (p) => p },
    tabs: { query: async () => [{ id: 1 }] },
    storage: { local: { get: async (k) => ({ [k]: data.storage[k] }), set: async () => {} } },
  };
}

async function capture(browser, spec) {
  const context = await browser.newContext({ viewport: spec.viewport, deviceScaleFactor: 2, locale: "en-US", timezoneId: "Asia/Kolkata" });
  const page = await context.newPage();
  await page.addInitScript(stubChrome, { replies: spec.replies, storage: { settings: spec.settings ?? { folderName: null, setupDone: true } } });
  await page.goto(pathToFileURL(path.join(DIST, spec.page)).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  if (spec.before) await spec.before(page);
  const file = path.join(OUT.tmp, `${spec.name}.png`);
  await page.locator(spec.element).screenshot({ path: file });
  await context.close();
  return file;
}

// ---------- the frames ----------
const css = `
@font-face{font-family:"Instrument Sans";src:url("${fontUrl("instrument-sans-latin-wdth-normal.woff2")}");font-weight:400 700;font-stretch:75% 100%}
@font-face{font-family:"Bricolage Grotesque";src:url("${fontUrl("bricolage-grotesque-latin-opsz-normal.woff2")}");font-weight:200 800}
*{box-sizing:border-box;margin:0}
body{background:#10261f;color:#f3f3ef;font-family:"Instrument Sans",system-ui,sans-serif;overflow:hidden}
h1{font-family:"Bricolage Grotesque";font-weight:700;letter-spacing:-.035em;line-height:1.05}
.sub{color:rgba(243,243,239,.74)}
.bar{height:6px;width:72px;border-radius:3px;background:#e0a93c;margin-bottom:28px}
img.ui{border-radius:20px;box-shadow:0 30px 80px -20px rgba(0,0,0,.55);display:block}
`;
const frame = (inner) => `<!doctype html><meta charset="utf-8"><style>${css}</style>${inner}`;

const side = (title, sub, img, imgHeight) => frame(`
<div style="position:relative;width:1280px;height:800px">
  <div style="position:absolute;left:84px;top:210px;width:510px"><div class="bar"></div>
    <h1 style="font-size:58px">${title}</h1><p class="sub" style="font-size:24px;margin-top:22px;line-height:1.4">${sub}</p></div>
  <img class="ui" src="${img}" style="position:absolute;right:110px;top:${(800 - imgHeight) / 2}px;height:${imgHeight}px">
</div>`);

const wide = (title, sub, img, imgWidth) => frame(`
<div style="position:relative;width:1280px;height:800px">
  <div style="position:absolute;left:84px;top:56px;width:1100px"><div class="bar" style="margin-bottom:20px"></div>
    <h1 style="font-size:50px">${title}</h1><p class="sub" style="font-size:22px;margin-top:14px">${sub}</p></div>
  <img class="ui" src="${img}" style="position:absolute;left:${(1280 - imgWidth) / 2}px;top:236px;width:${imgWidth}px;border-bottom-left-radius:0;border-bottom-right-radius:0">
</div>`);

const toDataUri = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

async function render(browser, html, size, outFile) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  // Loaded from a file, not setContent, so the font files next to it are allowed to load.
  const htmlFile = path.resolve(OUT.tmp, "frame.html");
  writeFileSync(htmlFile, html);
  await page.goto(pathToFileURL(htmlFile).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  const tmp = path.join(OUT.tmp, "frame.png");
  await page.screenshot({ path: tmp });
  await page.close();
  // The store wants 24-bit PNG without transparency.
  execSync(`convert "${tmp}" -background "#10261f" -alpha remove -alpha off PNG24:"${outFile}"`);
}

// ---------- privacy policy page ----------
function markdownToHtml(md) {
  const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
  const out = [];
  let list = false;
  for (const line of md.split("\n")) {
    const li = line.match(/^- (.*)/);
    if (list && !li) { out.push("</ul>"); list = false; }
    if (li) { if (!list) { out.push("<ul>"); list = true; } out.push(`<li>${inline(li[1])}</li>`); }
    else if (line.startsWith("## ")) out.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (line.startsWith("# ")) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push("</ul>");
  return out.join("\n");
}
const policy = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Call Recorder privacy policy</title>
<style>body{font:16px/1.6 "Instrument Sans",system-ui,-apple-system,"Segoe UI",sans-serif;color:#10261f;background:#f3f3ef;margin:0}
main{max-width:720px;margin:0 auto;padding:3rem 1.5rem 5rem}h1,h2{letter-spacing:-.02em}h1{font-size:2rem}h2{font-size:1.25rem;margin-top:2rem}
code{background:#ecede8;padding:.1em .35em;border-radius:6px}li{margin:.25rem 0}</style>
<main>${markdownToHtml(readFileSync("store/privacy-policy.md", "utf8"))}</main></html>`;
writeFileSync("store/privacy-policy.html", policy);

// ---------- go ----------
const browser = await chromium.launch();
try {
  const popup = { page: "popup.html", viewport: { width: 340, height: 520 }, element: "body" };
  const shots = [
    {
      name: "popup-meet", ...popup,
      replies: { "recording/status": { phase: "idle" }, "site/describe": MEET },
      before: (p) => p.check("#consent"),
      html: (img) => side("Record any call tab", "Your voice and everyone else's, in one file on your computer.", img, 500),
    },
    {
      name: "popup-konvene", ...popup,
      replies: { "recording/status": { phase: "idle" }, "site/describe": KONVENE },
      html: (img) => side("On Konvene, everyone sees the badge", "A named recording badge shows for the whole call while you record.", img, 520),
    },
    {
      name: "popup-recording", ...popup,
      replies: {
        "recording/status": { phase: "recording", recordId: "1", startedAgoMs: 754_000, siteName: "Google Meet", tabTitle: "Weekly planning" },
        "recording/levels": { levels: { micIn: 0.12, mic: 0.09, tab: 0.045, noiseReductionBypassed: false } },
      },
      html: (img) => side("See that your voice is being recorded", "Live meters for you and the call. The recording keeps going when you close the popup.", img, 560),
    },
    {
      name: "library", page: "library.html", viewport: { width: 760, height: 640 }, element: "main",
      replies: { "recording/list": LIBRARY },
      html: (img) => wide("Find every recording in one place", "Time, length, size and the tab title. Unfinished recordings can be saved later.", img, 820),
    },
    {
      name: "setup", page: "setup.html", viewport: { width: 760, height: 700 }, element: "main",
      replies: {}, settings: { folderName: null, setupDone: false },
      html: (img) => wide("Set up in two steps", "Allow your microphone, and pick a folder if you do not want Downloads. Nothing is uploaded.", img, 820),
    },
  ];
  let n = 1;
  for (const s of shots) {
    const ui = await capture(browser, s);
    await render(browser, s.html(toDataUri(ui)), { width: 1280, height: 800 }, `${OUT.shots}/${String(n++).padStart(2, "0")}-${s.name}-1280x800.png`);
  }

  const promo = frame(`
<div style="width:440px;height:280px;position:relative;background:#14523d">
  <div style="position:absolute;left:34px;top:44px;width:64px;height:64px">${logoSvg.replace("<svg ", '<svg width="64" height="64" ')}</div>
  <div style="position:absolute;left:34px;top:136px;width:380px"><div class="bar" style="height:5px;width:48px;margin-bottom:14px"></div>
    <h1 style="font-size:40px">Call Recorder</h1><p class="sub" style="font-size:17px;margin-top:8px">Record calls on your own device.</p></div>
</div>`);
  await render(browser, promo, { width: 440, height: 280 }, `${OUT.promo}/small-tile-440x280.png`);
} finally {
  await browser.close();
  rmSync(OUT.tmp, { recursive: true, force: true });
}
console.log("Store graphics written to store/screenshots and store/promo, and store/privacy-policy.html");
