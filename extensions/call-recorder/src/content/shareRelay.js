// Runs in the extension's own world on the call page. It carries the page's share requests to the extension and the
// answers back, and tells the page when a recording starts or stops. The page cannot reach the extension directly.
import { CHANNEL } from "../shared/api.js";
import { chromeRuntime } from "../shared/chromeRuntime.js";
import { createCaller } from "../shared/rpc.js";
import { RECORDING_STATE_MESSAGE, SHARE_PAGE_SOURCE, SHARE_RELAY_SOURCE } from "../domain/shareProtocol.js";

const background = createCaller(CHANNEL.background, chromeRuntime);
const post = (message) => window.postMessage({ source: SHARE_RELAY_SOURCE, ...message }, location.origin);

window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.source !== SHARE_PAGE_SOURCE || typeof m.id !== "number") return;
  const call = m.type === "offer" ? background("share/offer", m.payload) : m.type === "ended" ? background("share/ended", m.payload) : null;
  if (!call) return;
  // On any failure the page is told "not recorded", so it lets go of the connection.
  call.then(
    (reply) => post({ id: m.id, reply: { answer: reply?.answer ?? null } }),
    () => post({ id: m.id, reply: { answer: null } }),
  );
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === RECORDING_STATE_MESSAGE) post({ recording: Boolean(message.recording) });
  return false;
});
