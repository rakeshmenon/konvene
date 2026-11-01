// Builds Konvene into dist/, a folder of static files that runs on any web host.
// Run: npm run build   (settings come from environment variables or .env, see .env.example)
import { build } from "esbuild";
import { cpSync, mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { loadEnv } from "./scripts/env.mjs";

const env = loadEnv();
const list = (v) => (v || "").split(",").map((x) => x.trim()).filter(Boolean);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const OUT = "dist";

// settings the app reads in the browser (src/config.js). Everything here is public.
const FEATURES = ["recording", "captions", "screenshare", "chat", "effects", "reactions"];
const flag = (v, d) => (v === undefined || v === "" ? d : /^(1|true|yes|on)$/i.test(v));
const app = {
  name: (env.KONVENE_NAME || "Konvene").trim(),
  appId: env.KONVENE_APP_ID || "konvene-calls-v1",
  // 2 to 8: every browser sends its video to every other one, so big calls get heavy
  maxPeople: Math.max(2, Math.min(8, Number(env.KONVENE_MAX_PEOPLE) || 6)),
  // features to switch off for everyone on this deployment
  disabled: list(env.KONVENE_DISABLE).map((x) => x.toLowerCase()).filter((x) => FEATURES.includes(x)),
  // what the pre-join page suggests for new calls (people can still change it)
  passcodeDefault: flag(env.KONVENE_PASSCODE_DEFAULT, false),
  askFirstDefault: flag(env.KONVENE_ASK_FIRST_DEFAULT, false),
  relays: list(env.KONVENE_RELAYS),
  turnEndpoint: env.KONVENE_TURN_ENDPOINT === undefined ? "/api/turn" : env.KONVENE_TURN_ENDPOINT,
  turn: env.KONVENE_TURN_URLS ? { urls: list(env.KONVENE_TURN_URLS), username: env.KONVENE_TURN_USERNAME || "", credential: env.KONVENE_TURN_CREDENTIAL || "" } : null,
};

// settings for the pages
const site = {
  repo: (env.KONVENE_REPO_URL || "https://github.com/rakeshmenon/konvene").replace(/\/$/, ""),
  demo: /^(1|true|yes)$/i.test(env.KONVENE_DEMO || ""),
  operator: env.KONVENE_OPERATOR || "",
  contact: env.KONVENE_CONTACT_URL || "",
  // the site's own address, for link previews (Netlify and Vercel tell us; set KONVENE_SITE_URL elsewhere)
  url: (env.KONVENE_SITE_URL || env.URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + env.VERCEL_PROJECT_PRODUCTION_URL : "")).replace(/\/$/, ""),
};

// MediaPipe sends usage logs to Google every minute. We point that at a dead data: URL
// (and the page's Content-Security-Policy blocks it too), so nothing about you leaves the device.
const noTelemetry = {
  name: "no-mediapipe-telemetry",
  setup(b) {
    b.onLoad({ filter: /vision_bundle\.mjs$/ }, async (args) => {
      let src = readFileSync(args.path, "utf8");
      const before = src;
      src = src.replaceAll("https://odml.pa.googleapis.com/v1/log", "data:,");
      if (src === before) throw new Error("MediaPipe telemetry URL not found: check the new version before shipping");
      return { contents: src, loader: "js" };
    });
  },
};

rmSync(OUT, { recursive: true, force: true });
cpSync("public", OUT, { recursive: true });
// your own branding, kept out of the code: anything in custom/ replaces the file of the same
// name (favicon.svg, apple-touch-icon.png, og-image.png...), custom/custom.css loads after the
// built-in styles, and custom/logo.svg replaces the logo. See docs/customising.md.
const CUSTOM = env.KONVENE_CUSTOM_DIR || "custom";
const hasCustom = existsSync(CUSTOM);
if (hasCustom) cpSync(CUSTOM, OUT, { recursive: true, filter: (p) => !/(^|\/)(README\.md|logo\.svg)$/.test(p) });
const customLogo = hasCustom && existsSync(`${CUSTOM}/logo.svg`) ? readFileSync(`${CUSTOM}/logo.svg`, "utf8") : null;

await build({
  plugins: [noTelemetry],
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "esm",
  minify: true,
  sourcemap: false,
  target: ["chrome110", "safari16", "firefox115"],
  outfile: `${OUT}/app.js`,
  legalComments: "none",
  define: { __KONVENE__: JSON.stringify(app) },
  // the open-source licences travel inside the code everyone downloads (invisible on the page)
  footer: { js: "/*\n" + readFileSync("THIRD_PARTY_NOTICES.txt", "utf8").replaceAll("*/", "* /") + "\n*/" },
});

mkdirSync(`${OUT}/fonts`, { recursive: true });
copyFileSync("node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wdth-normal.woff2", `${OUT}/fonts/instrument-sans-latin-wdth-normal.woff2`);
copyFileSync("node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2", `${OUT}/fonts/bricolage-grotesque-latin-opsz-normal.woff2`);
mkdirSync(`${OUT}/vendor/mediapipe/wasm`, { recursive: true });
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) {
  copyFileSync(`node_modules/@mediapipe/tasks-vision/wasm/${f}`, `${OUT}/vendor/mediapipe/wasm/${f}`);
}
// strong noise reduction (src/sound.js): the RNNoise worklet and its WebAssembly, served from this site
mkdirSync(`${OUT}/vendor/rnnoise`, { recursive: true });
const wns = "node_modules/@sapphi-red/web-noise-suppressor/dist";
copyFileSync(`${wns}/rnnoise/workletProcessor.js`, `${OUT}/vendor/rnnoise/rnnoiseWorklet.js`);
for (const f of ["rnnoise.wasm", "rnnoise_simd.wasm"]) copyFileSync(`${wns}/${f}`, `${OUT}/vendor/rnnoise/${f}`);
for (const m of ["face_landmarker.task", "selfie_multiclass_256x256.tflite", "selfie_segmenter_landscape.tflite"]) {
  if (!existsSync(`${OUT}/models/${m}`)) throw new Error(`Missing public/models/${m} (see docs/architecture.md)`);
}

// fill in the pages: {{REPO}} etc., and <!--demo-->...<!--/demo--> blocks only on the demo
const NAME = esc(app.name);
const renamed = app.name !== "Konvene";
const operator = site.operator
  ? `This copy of ${NAME} is run by ${esc(site.operator)}.` + (site.contact ? ` <a href="${esc(site.contact)}">Contact</a>.` : "")
  : `This copy of ${NAME} is run by whoever deployed it. They haven't added their details yet.`;
// a renamed copy still says where it comes from
const credit = renamed
  ? 'Built on <a href="https://github.com/rakeshmenon/konvene">Konvene</a>, open source by <a href="https://sublimecoder.io">Rakesh Menon</a>.'
  : 'Made by <a href="https://sublimecoder.io">Rakesh Menon</a>.';
const count = ["", "", "two", "three", "four", "five", "six", "seven", "eight"][app.maxPeople];
// custom/logo.svg: its viewBox and contents become the logo everywhere
let logo = null;
if (customLogo) {
  const vb = (customLogo.match(/viewBox="([^"]+)"/) || [])[1] || "0 0 64 64";
  const inner = customLogo.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  logo = { vb, inner };
}
for (const f of readdirSync(OUT).filter((x) => x.endsWith(".html"))) {
  let html = readFileSync(`${OUT}/${f}`, "utf8");
  html = html.replace(/<!--demo-->([\s\S]*?)<!--\/demo-->/g, site.demo ? "$1" : "");
  html = html.replace(/<!--notdemo-->([\s\S]*?)<!--\/notdemo-->/g, site.demo ? "" : "$1");
  html = html.replaceAll("{{REPO_ENC}}", encodeURIComponent(site.repo)).replaceAll("{{REPO}}", esc(site.repo)).replaceAll("{{OPERATOR}}", operator).replaceAll("{{APP_ID}}", esc(app.appId));
  if (renamed) {
    // the name in text and titles, and the wordmark next to the logo (URLs and commands are lowercase, so they stay)
    html = html.replace(/\bKonvene\b/g, NAME).replace(/(<\/svg>)konvene(<\/(?:a|p)>)/g, `$1${NAME}$2`);
  }
  html = html.replaceAll("{{SITE}}", esc(site.url)).replaceAll("{{CREDIT}}", credit).replaceAll("{{MAX}}", count).replaceAll("{{MAX_N}}", String(app.maxPeople));
  if (logo) {
    html = html.replace(/<symbol id="i-logo(-light)?" viewBox="[^"]*">[\s\S]*?<\/symbol>/g, (m, light) => `<symbol id="i-logo${light || ""}" viewBox="${logo.vb}">${logo.inner}</symbol>`);
    html = html.replace(/<svg class="mark" viewBox="[^"]*" aria-hidden="true">[\s\S]*?<\/svg>/g, `<svg class="mark" viewBox="${logo.vb}" aria-hidden="true">${logo.inner}</svg>`);
  }
  if (hasCustom && existsSync(`${CUSTOM}/custom.css`)) html = html.replace('<link rel="stylesheet" href="/styles.css">', '<link rel="stylesheet" href="/styles.css">\n<link rel="stylesheet" href="/custom.css">');
  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error(`Unfilled placeholder in ${f}: ${html.match(/\{\{[A-Z_]+\}\}/)[0]}`);
  writeFileSync(`${OUT}/${f}`, html);
}
// static hosts without rewrites (GitHub Pages and others) show 404.html for call links
copyFileSync(`${OUT}/index.html`, `${OUT}/404.html`);

console.log(`built ${OUT}/ (${app.name}, app ID ${app.appId}${app.disabled.length ? ", off: " + app.disabled.join(" ") : ""}${hasCustom ? ", custom/" : ""}${site.demo ? ", demo" : ""}${app.turn ? ", fixed TURN" : ""}${app.turnEndpoint ? ", TURN endpoint " + app.turnEndpoint : ""})`);
