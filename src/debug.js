// Connection log for troubleshooting: add ?debug to any Klatch address to see it.
// It shows how each connection to another person forms and why it ends, on this device only.
// Nothing here is sent anywhere. Peer ids are shortened so a screenshot is safe to share.

export const DEBUG = new URLSearchParams(location.search).has("debug");

const lines = [];
const t0 = performance.now();
let box = null;
const short = (s) => String(s).replace(/[A-Za-z0-9]{16,}/g, (m) => m.slice(0, 4));

export function dlog(msg) {
  if (!DEBUG) return;
  const line = `${((performance.now() - t0) / 1000).toFixed(1)} ${short(msg)}`;
  lines.push(line);
  if (lines.length > 400) lines.shift();
  if (box) { box.textContent = lines.slice(-120).join("\n"); box.scrollTop = box.scrollHeight; }
}

function panel() {
  const wrap = document.createElement("div");
  wrap.setAttribute("role", "log");
  wrap.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;max-height:38vh;display:flex;flex-direction:column;background:rgba(8,21,15,.92);color:#e7eee9;border-radius:10px;font:11px/1.45 ui-monospace,Menlo,monospace;box-shadow:0 8px 30px rgba(0,0,0,.4)";
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.12)";
  const title = document.createElement("strong"); title.textContent = "Connection log"; title.style.flex = "1";
  const ua = navigator.userAgent.match(/(iPhone|iPad|Android|Mac OS X|Windows)[^;)]*/);
  title.textContent += ua ? ` (${ua[0].replace(/_/g, ".")})` : "";
  const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "Copy";
  const hide = document.createElement("button"); hide.type = "button"; hide.textContent = "Hide";
  for (const b of [copy, hide]) b.style.cssText = "font:inherit;color:inherit;background:rgba(255,255,255,.12);border:0;border-radius:6px;padding:3px 8px";
  copy.onclick = () => navigator.clipboard && navigator.clipboard.writeText(lines.join("\n")).then(() => { copy.textContent = "Copied"; setTimeout(() => (copy.textContent = "Copy"), 1500); });
  hide.onclick = () => { const h = box.style.display !== "none"; box.style.display = h ? "none" : ""; hide.textContent = h ? "Show" : "Hide"; };
  bar.append(title, copy, hide);
  box = document.createElement("pre");
  box.style.cssText = "margin:0;padding:8px 10px;overflow:auto;white-space:pre-wrap;flex:1";
  wrap.append(bar, box);
  document.body.appendChild(wrap);
  dlog("log started");
}

if (DEBUG) {
  // every WebRTC connection: how it forms, which route it takes, and how it ends
  const Orig = window.RTCPeerConnection;
  let n = 0;
  const Wrapped = function (cfg, ...rest) {
    const pc = new Orig(cfg, ...rest);
    const k = ++n;
    dlog(`pc${k} created (${(cfg && cfg.iceServers ? cfg.iceServers : []).map((s) => [].concat(s.urls)[0].split(":")[0]).join(",") || "no ice servers"})`);
    pc.addEventListener("signalingstatechange", () => dlog(`pc${k} signaling ${pc.signalingState}`));
    pc.addEventListener("iceconnectionstatechange", () => dlog(`pc${k} ice ${pc.iceConnectionState}`));
    pc.addEventListener("connectionstatechange", async () => {
      let via = "";
      if (pc.connectionState === "connected") {
        try {
          const st = await pc.getStats();
          st.forEach((r) => {
            if (r.type === "transport" && r.selectedCandidatePairId) {
              const p = st.get(r.selectedCandidatePairId), l = p && st.get(p.localCandidateId), m = p && st.get(p.remoteCandidateId);
              via = ` via ${l && l.candidateType}/${l && l.protocol} to ${m && m.candidateType}`;
            }
          });
        } catch { /* stats unsupported */ }
      }
      dlog(`pc${k} ${pc.connectionState}${via}`);
    });
    pc.addEventListener("datachannel", (e) => e.channel.addEventListener("close", () => dlog(`pc${k} data channel closed`)));
    const mk = pc.createDataChannel.bind(pc);
    pc.createDataChannel = (...a) => { const ch = mk(...a); ch.addEventListener("close", () => dlog(`pc${k} data channel closed`)); return ch; };
    pc.addEventListener("track", (e) => dlog(`pc${k} receiving ${e.track.kind}`));
    const close = pc.close.bind(pc);
    pc.close = () => { dlog(`pc${k} closed by this device`); close(); };
    for (const m of ["setLocalDescription", "setRemoteDescription", "addIceCandidate"]) {
      const f = pc[m].bind(pc);
      pc[m] = (...a) => f(...a).catch((e) => { dlog(`pc${k} ${m} FAILED: ${e && (e.name + " " + e.message)}`); throw e; });
    }
    return pc;
  };
  Wrapped.prototype = Orig.prototype;
  Object.setPrototypeOf(Wrapped, Orig);
  window.RTCPeerConnection = Wrapped;
  // library warnings and page errors
  for (const lvl of ["warn", "error"]) {
    const f = console[lvl].bind(console);
    console[lvl] = (...a) => { dlog(`${lvl.toUpperCase()} ${a.map((x) => (x && x.message) || String(x)).join(" ").slice(0, 220)}`); f(...a); };
  }
  addEventListener("error", (e) => dlog(`PAGE ERROR ${e.message}`));
  addEventListener("unhandledrejection", (e) => dlog(`UNHANDLED ${(e.reason && (e.reason.message || e.reason)) || e.reason}`));
  addEventListener("pagehide", () => dlog("page hidden"));
  document.addEventListener("visibilitychange", () => dlog(`visibility ${document.visibilityState}`));
  if (document.body) panel(); else addEventListener("DOMContentLoaded", panel);
}
