// Reads .env (if present) into process.env without overriding variables that are already set.
// No dependency needed: KEY=value lines, # comments, optional quotes.
import { existsSync, readFileSync } from "node:fs";

export function loadEnv(file = ".env") {
  if (!existsSync(file)) return process.env;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    else val = val.replace(/\s+#.*$/, "");
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return process.env;
}
