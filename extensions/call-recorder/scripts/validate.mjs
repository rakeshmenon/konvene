// Checks the store build (dist/) against the things the Chrome Web Store review checks first.
// It fails loudly, so a bad package never reaches the dashboard. Run by `npm run package`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const DIST = process.env.DIST ?? "dist";
const problems = [];
const fail = (msg) => problems.push(msg);

if (!existsSync(`${DIST}/manifest.json`)) {
  console.error("dist/manifest.json is missing. Run `npm run build` first.");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(`${DIST}/manifest.json`, "utf8"));

// ---- identity and size limits ----
if (manifest.manifest_version !== 3) fail("manifest_version must be 3.");
if (!manifest.name || manifest.name.length > 75) fail("name is missing or longer than 75 characters.");
if (/\(dev\)/i.test(manifest.name)) fail("This is a development build. Use `npm run build`, not `build:dev`.");
if (!manifest.description || manifest.description.length > 132) fail(`description is missing or longer than 132 characters (${manifest.description?.length}).`);
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? "")) fail("version must be 1 to 4 dot-separated numbers.");

// ---- every file the manifest points at must exist ----
const refs = new Set();
const add = (f) => f && refs.add(f);
add(manifest.background?.service_worker);
add(manifest.action?.default_popup);
add(manifest.options_ui?.page);
Object.values(manifest.icons ?? {}).forEach(add);
Object.values(manifest.action?.default_icon ?? {}).forEach(add);
(manifest.content_scripts ?? []).forEach((c) => { (c.js ?? []).forEach(add); (c.css ?? []).forEach(add); });
for (const f of refs) if (!existsSync(path.join(DIST, f))) fail(`manifest points at ${f}, which is not in dist/.`);
for (const size of ["16", "48", "128"]) if (!manifest.icons?.[size]) fail(`icons.${size} is missing.`);

// ---- host access: narrow, and no development origins ----
if (manifest.host_permissions?.length) fail("host_permissions should be empty: activeTab is enough.");
for (const c of manifest.content_scripts ?? []) {
  for (const m of c.matches) {
    if (/localhost|127\.0\.0\.1|<all_urls>|\*:\/\/\*\/|https?:\/\/\*\//.test(m)) fail(`content script match "${m}" is too broad or for development.`);
    if (m.startsWith("http://")) fail(`content script match "${m}" is not https.`);
  }
}

// ---- permissions: only the ones we declared, each with a written justification ----
const ALLOWED = ["tabCapture", "offscreen", "activeTab", "downloads", "storage"];
for (const p of manifest.permissions ?? []) if (!ALLOWED.includes(p)) fail(`Unexpected permission "${p}". Add it to scripts/validate.mjs and store/permissions.md on purpose, not by accident.`);
const justification = readFileSync("store/permissions.md", "utf8");
for (const p of manifest.permissions ?? []) if (!justification.includes(`## ${p}`)) fail(`store/permissions.md has no "## ${p}" section.`);
if (manifest.optional_permissions?.length) fail("Unexpected optional_permissions.");

// ---- no remote code, no unsafe CSP ----
const csp = JSON.stringify(manifest.content_security_policy ?? {});
// 'wasm-unsafe-eval' is required: without it RNNoise cannot start in the audio worklet and the voice is silent.
if (/(?<!wasm-)unsafe-eval|unsafe-inline|https?:\/\//.test(csp)) fail("content_security_policy allows unsafe or remote sources.");
if (!/wasm-unsafe-eval/.test(csp)) fail("content_security_policy must allow 'wasm-unsafe-eval', or noise reduction records silence.");
for (const f of readdirSync(DIST).filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(path.join(DIST, f), "utf8");
  if (/<script[^>]+src=["']https?:/i.test(html)) fail(`${f} loads a remote script.`);
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) fail(`${f} has an inline script.`);
  if (/<link[^>]+href=["']https?:/i.test(html)) fail(`${f} loads a remote stylesheet.`);
}
for (const f of readdirSync(DIST).filter((f) => f.endsWith(".js"))) {
  const js = readFileSync(path.join(DIST, f), "utf8");
  if (/\bimportScripts\(\s*["']https?:/.test(js)) fail(`${f} imports a remote script.`);
  // Our own code never makes a network request. Flag a literal web address handed to a network call.
  if (/\b(?:fetch|WebSocket)\(\s*["'`]https?:\/\//.test(js) || /\.open\(\s*["'][A-Z]+["']\s*,\s*["'`]https?:\/\//.test(js)) {
    fail(`${f} appears to make a network request to a web address. This extension must stay offline.`);
  }
}

// ---- weight ----
let bytes = 0;
const walk = (d) => readdirSync(d).forEach((n) => { const p = path.join(d, n); statSync(p).isDirectory() ? walk(p) : (bytes += statSync(p).size); });
walk(DIST);
console.log(`dist/ is ${(bytes / 1e6).toFixed(2)} MB, ${refs.size} manifest references checked.`);

if (problems.length) {
  console.error("\nNot ready for the Chrome Web Store:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log("Store build looks good.");
