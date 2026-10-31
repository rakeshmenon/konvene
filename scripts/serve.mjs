// Serves dist/ on your computer, like a real host would: call links (/abc-def-ghj) open the app
// and /api/turn works if you set TURN variables in .env.
// Run: npm run dev   (builds first)   or   npm run serve   (port: PORT=9000 npm run serve)
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { loadEnv } from "./env.mjs";
import { respond } from "../server/turn.mjs";

const env = loadEnv();
const ROOT = new URL("../dist/", import.meta.url).pathname;
const PORT = Number(process.argv[2] || env.PORT || 8790);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".woff2": "font/woff2", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8" };

if (!existsSync(ROOT)) { console.error("No dist/ folder yet. Run: npm run build"); process.exit(1); }

http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/api/turn") {
    const r = await respond(env);
    res.writeHead(r.status, r.headers);
    return res.end(r.body);
  }
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) file = join(ROOT, "index.html"); // call links and anything else open the app
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log(`Konvene is running at http://localhost:${PORT}  (Ctrl+C to stop)`));
