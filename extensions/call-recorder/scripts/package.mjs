// Builds the store version, validates it, and zips it for upload. The zip holds the contents of dist/, not the folder.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const { version } = JSON.parse(readFileSync("package.json", "utf8"));

run("node build.mjs");
run("node scripts/validate.mjs");

mkdirSync("store/package", { recursive: true });
const zip = `store/package/call-recorder-${version}.zip`;
rmSync(zip, { force: true });
run(`cd dist && zip -qr -X ../${zip} .`);
console.log(`\nReady to upload: ${zip} (${(statSync(zip).size / 1e6).toFixed(2)} MB)`);
