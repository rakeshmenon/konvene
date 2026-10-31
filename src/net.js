// Rooms without a server of our own.
// Production: Trystero (WebRTC; browsers find each other through public Nostr relays).
// Testing: ?local=1 builds the same WebRTC mesh but does the handshake over a BroadcastChannel,
// so two tabs in one browser can call each other with no network at all.
import { joinRoom as trysteroJoin, selfId as trysteroSelf } from "trystero";
import { CONFIG } from "./config.js";

export function makeRoomCode() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(9));
  let s = "";
  for (let i = 0; i < 9; i++) { s += alphabet[b[i] % alphabet.length]; if (i === 2 || i === 5) s += "-"; }
  return s;
}

function localRoom(roomId) {
  const selfId = "L" + Math.random().toString(36).slice(2, 10);
  const ch = new BroadcastChannel("konvene-" + roomId);
  const peers = new Map(); // id -> { pc, makingOffer, polite }
  const actions = {};
  const streams = new Map(); // our broadcast streams -> metadata
  const remoteMeta = new Map(); // stream id -> metadata, as announced by its sender
  const room = {
    selfId, local: true,
    onPeerJoin: () => {}, onPeerLeave: () => {}, onPeerStream: () => {},
    addStream(stream, opts = {}) {
      const targets = opts.target ? [].concat(opts.target) : null;
      if (!targets) streams.set(stream, opts.metadata);
      for (const [id, p] of peers) {
        if (targets && !targets.includes(id)) continue;
        sendStream(id, p, stream, opts.metadata);
      }
    },
    removeStream(stream) {
      streams.delete(stream);
      const tracks = stream.getTracks();
      for (const [, p] of peers) for (const snd of p.pc.getSenders()) if (snd.track && tracks.includes(snd.track)) p.pc.removeTrack(snd);
    },
    replaceTrack(oldTrack, newTrack) {
      for (const [, p] of peers) for (const snd of p.pc.getSenders()) if (snd.track === oldTrack) snd.replaceTrack(newTrack);
    },
    connections: () => [...peers.values()].map((p) => p.pc),
    makeAction(name) {
      const a = { onMessage: () => {}, send(data, opts = {}) { ch.postMessage({ k: "msg", from: selfId, to: opts.target || null, name, data }); } };
      actions[name] = a;
      return a;
    },
    leave() { ch.postMessage({ k: "bye", from: selfId }); for (const [, p] of peers) p.pc.close(); ch.close(); },
  };
  const send = (to, payload) => ch.postMessage({ k: "sig", from: selfId, to, ...payload });
  function sendStream(id, p, stream, metadata) {
    // announce what the stream is before its tracks arrive (same channel, so it lands first)
    ch.postMessage({ k: "meta", from: selfId, to: id, streamId: stream.id, metadata: metadata || null });
    for (const t of stream.getTracks()) if (!p.pc.getSenders().some((snd) => snd.track === t)) p.pc.addTrack(t, stream);
  }

  function connect(id) {
    if (peers.has(id)) return;
    const pc = new RTCPeerConnection({ iceServers: [] });
    const peer = { pc, makingOffer: false, polite: selfId < id };
    peers.set(id, peer);
    pc.onicecandidate = (e) => { if (e.candidate) send(id, { cand: e.candidate.toJSON() }); };
    pc.onnegotiationneeded = async () => {
      try { peer.makingOffer = true; await pc.setLocalDescription(); send(id, { desc: pc.localDescription.toJSON() }); }
      finally { peer.makingOffer = false; }
    };
    pc.ontrack = (e) => {
      const st = e.streams[0];
      if (st) room.onPeerStream(st, id, remoteMeta.get(st.id) || null);
    };
    pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(pc.connectionState)) drop(id); };
    for (const [st, meta] of streams) sendStream(id, peer, st, meta);
    room.onPeerJoin(id);
  }
  function drop(id) {
    const p = peers.get(id);
    if (!p) return;
    peers.delete(id);
    try { p.pc.close(); } catch { /* closed */ }
    room.onPeerLeave(id);
  }
  ch.onmessage = async (e) => {
    const m = e.data;
    if (!m || m.from === selfId) return;
    if (m.k === "hello") {
      if (!m.to) ch.postMessage({ k: "hello", from: selfId, to: m.from });
      // only one side starts the connection, so the two offers never collide
      if ((!m.to || m.to === selfId) && selfId < m.from) connect(m.from);
      return;
    }
    if (m.k === "bye") { drop(m.from); return; }
    if (m.k === "meta") { if (m.to === selfId) remoteMeta.set(m.streamId, m.metadata); return; }
    if (m.k === "msg") { if ((!m.to || m.to === selfId) && actions[m.name]) actions[m.name].onMessage(m.data, { peerId: m.from }); return; }
    if (m.k === "sig" && m.to === selfId) {
      if (!peers.has(m.from)) connect(m.from);
      const p = peers.get(m.from);
      const pc = p.pc;
      try {
        if (m.desc) {
          const collision = m.desc.type === "offer" && (p.makingOffer || pc.signalingState !== "stable");
          if (collision && !p.polite) return;
          await pc.setRemoteDescription(m.desc);
          if (m.desc.type === "offer") { await pc.setLocalDescription(); send(m.from, { desc: pc.localDescription.toJSON() }); }
        } else if (m.cand) {
          await pc.addIceCandidate(m.cand).catch(() => {});
        }
      } catch (err) { console.warn("signal", err); }
    }
  };
  setTimeout(() => ch.postMessage({ k: "hello", from: selfId, to: null }), 50);
  addEventListener("pagehide", () => room.leave());
  return room;
}

// turn: TURN servers from config.js iceServers(), used only when a direct route fails
export function join(roomId, { local = false, turn = [] } = {}) {
  if (local) return localRoom(roomId);
  const cfg = { appId: CONFIG.appId };
  if (CONFIG.relays.length) cfg.relayConfig = { urls: CONFIG.relays };
  if (turn.length) cfg.turnConfig = turn;
  const room = trysteroJoin(cfg, roomId);
  return {
    selfId: trysteroSelf,
    local: false,
    set onPeerJoin(fn) { room.onPeerJoin = fn; },
    set onPeerLeave(fn) { room.onPeerLeave = fn; },
    set onPeerStream(fn) { room.onPeerStream = fn; },
    addStream: (stream, opts) => room.addStream(stream, opts),
    removeStream: (stream, opts) => room.removeStream(stream, opts),
    replaceTrack: (oldTrack, newTrack, opts) => room.replaceTrack(oldTrack, newTrack, opts),
    connections: () => Object.values(room.getPeers ? room.getPeers() : {}),
    makeAction: (name) => room.makeAction(name),
    leave: () => room.leave(),
  };
}
