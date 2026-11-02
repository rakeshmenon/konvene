const pad = (n) => String(n).padStart(2, "0");
/** Lowercase letters, digits and single dashes only, so the name is safe on every file system. */
export function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
/** call-2026-11-02-1105-google-meet.mp4 (local time, so it matches the clock the user sees). */
export function buildFileName(input) {
  const d = new Date(input.startedAt);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  const site = slug(input.siteId) || "call";
  return `call-${day}-${time}-${site}.${input.extension}`;
}
export function extensionFromMime(mimeType) {
  return mimeType.includes("mp4") ? "mp4" : "webm";
}
/**
 * "video/mp4;codecs=avc1,mp4a.40.2" becomes "video/mp4". Chrome names a download by the type the file is served with,
 * and a file with no type is served as plain text, which turns "call.mp4" into "call.txt".
 */
export function containerMimeType(mimeType) {
  const base = (mimeType.split(";")[0] ?? "").trim().toLowerCase();
  return base.startsWith("video/") ? base : `video/${extensionFromMime(mimeType)}`;
}
/** Name of the live file in private storage. It has no extension and never changes after start. */
export function buildStagingName(recordId) {
  return `rec-${slug(recordId)}`;
}
