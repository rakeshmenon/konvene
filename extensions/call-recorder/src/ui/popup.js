import { KeyValueSettingsStore } from "../application/keyValueRepositories.js";
import { CONFIG } from "../config.js";
import { ChromeKeyValueStore } from "../infra/chromeKeyValueStore.js";
import { directoryHandleStore } from "../shared/directoryHandleStore.js";
import { formatDuration } from "../shared/format.js";
import { background, byId, setText, show, showError } from "./dom.js";
const settings = new KeyValueSettingsStore(new ChromeKeyValueStore());
const ui = {
  siteName: byId("site-name"),
  tabTitle: byId("tab-title"),
  idle: byId("idle-view"),
  recording: byId("recording-view"),
  saving: byId("saving-view"),
  badgeNote: byId("badge-note"),
  consentRow: byId("consent-row"),
  consent: byId("consent"),
  start: byId("start"),
  stop: byId("stop"),
  timer: byId("timer"),
  error: byId("error"),
  setupNote: byId("setup-note"),
  meterMic: byId("meter-mic"),
  meterTab: byId("meter-tab"),
  meterShared: byId("meter-shared"),
  sharedRow: byId("shared-row"),
  micHint: byId("mic-hint"),
  bypassNote: byId("bypass-note"),
  where: byId("where"),
};
let tabId;
let site;
let timerHandle;
let meterHandle;
const SILENT_MIC_HINT_AFTER_MS = 5000;
async function refresh() {
  const status = await background("recording/status", {});
  render(status);
  const s = await settings.read();
  show(ui.setupNote, !s.setupDone);
  setText(
    ui.where,
    `${s.folderName ? `Saved to the folder "${s.folderName}"` : `Saved to Downloads/${CONFIG.downloadsFolder}`}. Nothing is uploaded.`,
  );
}
/** RMS (0 to 1) as a bar width. Decibels, because that is how loudness is heard: -60 dB is empty, -10 dB is full. */
function barWidth(level) {
  const db = 20 * Math.log10(Math.max(level, 1e-6));
  return `${Math.round(Math.min(1, Math.max(0, (db + 60) / 50)) * 100)}%`;
}
function watchLevels() {
  clearInterval(meterHandle);
  let quietSince = Date.now();
  const tick = async () => {
    try {
      const { levels } = await background("recording/levels", {});
      if (!levels) return;
      ui.meterMic.style.width = barWidth(levels.mic);
      ui.meterTab.style.width = barWidth(levels.tab);
      ui.meterShared.style.width = barWidth(levels.shared);
      // The row appears while a screen or tab shared in the call is being recorded.
      show(ui.sharedRow, levels.sharedActive);
      if (levels.micIn > 0.002 || levels.mic > 0.002) quietSince = Date.now();
      show(ui.micHint, Date.now() - quietSince > SILENT_MIC_HINT_AFTER_MS);
      show(ui.bypassNote, levels.noiseReductionBypassed);
    } catch {
      /* the recording ended while we asked */
    }
  };
  void tick();
  meterHandle = setInterval(() => void tick(), 500);
}
function render(status) {
  clearInterval(timerHandle);
  clearInterval(meterHandle);
  show(ui.idle, status.phase === "idle");
  show(ui.recording, status.phase === "recording");
  show(ui.saving, status.phase === "saving");
  if (status.phase === "recording") {
    setText(ui.siteName, status.siteName);
    setText(ui.tabTitle, status.tabTitle);
    const tick = () => setText(ui.timer, formatDuration(Date.now() - status.startedAt));
    tick();
    timerHandle = setInterval(tick, 500);
    watchLevels();
    return;
  }
  if (status.phase === "idle" && site) {
    setText(ui.siteName, site.siteName);
    setText(ui.tabTitle, site.tabTitle || site.host);
    show(ui.badgeNote, site.consent === "badge");
    show(ui.consentRow, site.consent === "recorder-confirms");
    updateStart();
  }
}
function updateStart() {
  ui.start.disabled = !site || (site.consent === "recorder-confirms" && !ui.consent.checked);
}
/** Chrome only lets a folder be re-allowed from a click, so Start does it here, while the click is fresh. */
async function reallowFolder() {
  const s = await settings.read();
  if (!s.folderName) return;
  const handle = await directoryHandleStore.get();
  if (handle && (await handle.queryPermission({ mode: "readwrite" })) !== "granted") {
    await handle.requestPermission({ mode: "readwrite" }).catch(() => {});
  }
}
async function onStart() {
  if (tabId === undefined) return;
  show(ui.error, false);
  ui.start.disabled = true;
  try {
    await reallowFolder();
    await background("recording/start", { tabId, consentConfirmed: ui.consent.checked });
    await refresh();
  } catch (e) {
    showError(ui.error, e);
    updateStart();
  }
}
async function onStop() {
  show(ui.error, false);
  ui.stop.disabled = true;
  show(ui.recording, false);
  show(ui.saving, true);
  try {
    await background("recording/stop", {});
  } catch (e) {
    showError(ui.error, e);
  } finally {
    ui.stop.disabled = false;
    await refresh();
  }
}
async function init() {
  ui.start.addEventListener("click", () => void onStart());
  ui.stop.addEventListener("click", () => void onStop());
  ui.consent.addEventListener("change", updateStart);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  if (tabId !== undefined) {
    try {
      site = await background("site/describe", { tabId });
    } catch (e) {
      showError(ui.error, e);
    }
  }
  await refresh();
}
void init();
