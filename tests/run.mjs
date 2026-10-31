// npm test: builds nothing, starts the local server on a spare port, runs the browser test, stops.
// Optional: FACE_VIDEO=face.y4m (a .y4m video of a face) to also test face tracking and effects.
import { spawn } from "node:child_process";

const port = 8791 + Math.floor(Math.random() * 100);
const server = spawn(process.execPath, ["scripts/serve.mjs", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok) => server.stdout.once("data", ok));
const test = spawn(process.execPath, ["tests/call.mjs"], { stdio: "inherit", env: { ...process.env, BASE: `http://localhost:${port}/` } });
test.on("exit", (code) => { server.kill(); process.exit(code ?? 1); });
