// Runs inside the call page itself (Chrome's "main world"), because only the page can see the screen it shares.
// It does nothing until the page asks Chrome for a share, and it never changes what the page gets back.
import { SHARE_PAGE_SOURCE, SHARE_RELAY_SOURCE } from "../domain/shareProtocol.js";
import { createRtcSharePeer } from "./rtcSharePeer.js";
import { ShareWatcher } from "./shareWatcher.js";

// Taken now, before the page can replace them.
const PeerConnection = window.RTCPeerConnection;
const pending = new Map();
let nextRequest = 1;

/** Asks the relay (the extension's content script) and waits for its answer. */
function request(type, payload) {
  return new Promise((resolve, reject) => {
    const id = nextRequest++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("No answer from the recorder."));
    }, 10_000);
    pending.set(id, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    window.postMessage({ source: SHARE_PAGE_SOURCE, id, type, payload }, location.origin);
  });
}

const watcher = new ShareWatcher({ request, createPeer: (tracks) => createRtcSharePeer(tracks, PeerConnection) });

window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.source !== SHARE_RELAY_SOURCE) return;
  if (typeof m.id === "number") pending.get(m.id)?.(m.reply);
  if (typeof m.recording === "boolean") watcher.setRecording(m.recording);
});

const original = window.MediaDevices?.prototype?.getDisplayMedia;
if (original) {
  window.MediaDevices.prototype.getDisplayMedia = async function getDisplayMedia(...args) {
    const stream = await original.apply(this, args);
    try {
      watcher.watch(stream);
    } catch {
      // Watching must never get in the way of the page's own share.
    }
    return stream;
  };
}
