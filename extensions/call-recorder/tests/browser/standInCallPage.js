// A stand-in for Meet in the smoke test: it shares a fake screen, and plays the part of the extension's relay by
// handing the page's requests to the test, which passes them to a recorder running in another page.
import "./fakeDisplayMedia.js";
import "../../src/content/sharePage.js";
import { SHARE_PAGE_SOURCE, SHARE_RELAY_SOURCE } from "../../src/domain/shareProtocol.js";

window.addEventListener("message", async (e) => {
  const m = e.data;
  if (e.source !== window || !m || m.source !== SHARE_PAGE_SOURCE) return;
  const reply = await window.__bridge(m.type, m.payload);
  window.postMessage({ source: SHARE_RELAY_SOURCE, id: m.id, reply }, location.origin);
});

window.__recording = (on) => window.postMessage({ source: SHARE_RELAY_SOURCE, recording: on }, location.origin);
window.__startShare = async (surface) => {
  window.__surface = surface;
  await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
};
