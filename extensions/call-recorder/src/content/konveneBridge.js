// Runs on Konvene pages only. It carries "recording started or stopped" from the extension to the page,
// and waits for the page to confirm its badge is showing, so a recording never starts unseen.
import { KONVENE_PAGE_ACK_SOURCE, KONVENE_PAGE_SOURCE, KONVENE_TAB_MESSAGE } from "../domain/sites/konveneProtocol.js";
const ACK_TIMEOUT_MS = 1500;
function isTabMessage(m) {
  return typeof m === "object" && m !== null && m.type === KONVENE_TAB_MESSAGE;
}
function isAck(data) {
  return typeof data === "object" && data !== null && data.source === KONVENE_PAGE_ACK_SOURCE;
}
/** Tells the page, then resolves true if the page confirms this exact state within the time limit. */
function tellPage(recording) {
  return new Promise((resolve) => {
    const done = (shown) => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(shown);
    };
    const onMessage = (e) => {
      if (e.source === window && e.origin === location.origin && isAck(e.data) && e.data.recording === recording) done(true);
    };
    const timer = setTimeout(() => done(false), ACK_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    const message = { source: KONVENE_PAGE_SOURCE, recording };
    window.postMessage(message, location.origin);
  });
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isTabMessage(message)) return false;
  void tellPage(message.recording).then((shown) => sendResponse({ shown }));
  return true; // the answer comes after the page has replied
});
