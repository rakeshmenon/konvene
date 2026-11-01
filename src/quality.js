// Keeping calls clear on weak connections, without a server.
//
// Every 2 seconds this browser looks at each connection it sends video over (WebRTC stats:
// estimated bandwidth, packet loss, round trip) and picks a tier for that person:
//   good: full quality       weak: up to 720p, 24 fps
//   poor: up to 360p, 15 fps bad:  video paused to that person, voice kept (audio only)
// It steps down quickly (after 4 s) and back up slowly (one step after 10 s of better numbers,
// longer if it keeps falling back), so the picture doesn't bounce.
//
// The people you call also say how big they show you (tile width in pixels), so nobody gets
// full HD for a small tile, and a hidden tab gets a small picture. In a mesh call you upload a
// separate copy to everyone, so this is what keeps six-person calls workable.

export const TIERS = ["good", "weak", "poor", "bad"];
const RANK = { good: 0, weak: 1, poor: 2, bad: 3 };
const PRESET = {
  good: { maxH: 1080, fps: 30, cap: 1 },
  weak: { maxH: 720, fps: 24, cap: 0.55 },
  poor: { maxH: 360, fps: 15, cap: 0.22 },
};
// bandwidth needed for each tier (bits per second), and packet loss limits
const NEED = [1_200_000, 500_000, 180_000];
const LOSS = [0.03, 0.08, 0.15];

export const worse = (a, b) => (RANK[a || "good"] >= RANK[b || "good"] ? a || "good" : b || "good");

// the tier these numbers allow on their own (loss is a fraction, rtt in seconds)
export function tierFrom({ avail, loss, rtt }) {
  let t = 0;
  if (avail != null) t = Math.max(t, avail >= NEED[0] ? 0 : avail >= NEED[1] ? 1 : avail >= NEED[2] ? 2 : 3);
  if (loss != null) t = Math.max(t, loss < LOSS[0] ? 0 : loss < LOSS[1] ? 1 : loss < LOSS[2] ? 2 : 3);
  if (rtt != null && rtt > 1) t = Math.max(t, 2);
  return TIERS[t];
}

// upload per copy of your video, shared out as the call grows
export function baseBitrate(people) {
  return people <= 1 ? 2_500_000 : people === 2 ? 1_800_000 : people === 3 ? 1_300_000 : 1_000_000;
}

// encoder settings for one person: tier, how wide they show you, your video's size
export function encoding(tier, viewW, out, people) {
  const p = PRESET[tier] || PRESET.good;
  let scale = Math.max(1, out.h / p.maxH);
  if (viewW > 0) scale = Math.max(scale, out.w / Math.max(160, viewW));
  scale = Math.round(scale * 100) / 100;
  const area = 1 / (scale * scale);
  const bps = Math.round(Math.max(120_000, baseBitrate(people) * p.cap * Math.min(1, Math.max(0.12, area * 1.3))));
  return { scaleResolutionDownBy: scale, maxBitrate: bps, maxFramerate: p.fps };
}

export class Quality {
  // conns(): [[peerId, RTCPeerConnection]]; camTrack(): the outgoing video track;
  // out(): { w, h } of that video; onTier(peerId, tier) when a person's tier changes
  constructor({ conns, camTrack, out, onTier }) {
    this.conns = conns; this.camTrack = camTrack; this.out = out; this.onTier = onTier;
    this.peers = new Map(); // id -> { tier, worse, better, backoff, lastBad, view, sender, forced, prev }
  }

  get(id) {
    let p = this.peers.get(id);
    if (!p) { p = { tier: "good", worse: 0, better: 0, backoff: 1, lastBad: 0, view: 0, sender: null, forced: null, prev: null }; this.peers.set(id, p); }
    return p;
  }

  tierOf(id) { return this.peers.has(id) ? this.peers.get(id).tier : "good"; }
  setView(id, w) { const p = this.get(id); if (p.view !== w) { p.view = w; p.prev = null; } }
  // for tests and troubleshooting: pin a person's tier (null to measure again)
  force(id, tier) { const p = this.get(id); p.forced = tier; if (tier) this.setTier(id, p, tier); }

  async tick() {
    const conns = this.conns();
    const alive = new Set(conns.map(([id]) => id));
    for (const id of this.peers.keys()) if (!alive.has(id)) this.peers.delete(id);
    for (const [id, pc] of conns) {
      if (!pc || pc.connectionState === "closed") continue;
      const p = this.get(id);
      if (!p.forced) this.judge(id, p, await this.measure(pc));
      this.apply(pc, p, conns.length);
    }
  }

  async measure(pc) {
    const m = { avail: null, loss: null, rtt: null };
    try {
      const st = await pc.getStats();
      let audioLoss = null;
      st.forEach((r) => {
        if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded") {
          if (r.availableOutgoingBitrate != null) m.avail = r.availableOutgoingBitrate;
          if (r.currentRoundTripTime != null) m.rtt = r.currentRoundTripTime;
        }
        if (r.type === "remote-inbound-rtp" && r.fractionLost != null) {
          if (r.kind === "video") m.loss = r.fractionLost; else audioLoss = r.fractionLost;
        }
      });
      if (m.loss == null) m.loss = audioLoss; // video paused: judge by the voice
    } catch { /* stats unavailable */ }
    return m;
  }

  judge(id, p, m) {
    const raw = tierFrom(m);
    if (RANK[raw] > RANK[p.tier]) {
      p.better = 0;
      if (++p.worse >= 2) {
        // falling back soon after recovering: wait longer before trying again
        if (raw === "bad" || RANK[raw] >= 2) { p.backoff = performance.now() - p.lastBad < 30000 ? Math.min(6, p.backoff * 2) : 1; p.lastBad = performance.now(); }
        this.setTier(id, p, raw);
      }
    } else if (RANK[raw] < RANK[p.tier]) {
      p.worse = 0;
      // a capped connection can't show more bandwidth than it's allowed, so loss decides going up
      if (++p.better >= 5 * p.backoff) { p.better = 0; this.setTier(id, p, TIERS[RANK[p.tier] - 1]); }
    } else { p.worse = 0; p.better = 0; }
  }

  setTier(id, p, tier) {
    if (p.tier === tier) return;
    p.tier = tier; p.worse = 0; p.better = 0; p.prev = null;
    if (this.onTier) this.onTier(id, tier);
  }

  apply(pc, p, people) {
    const cam = this.camTrack();
    if (!p.sender || !pc.getSenders().includes(p.sender)) p.sender = pc.getSenders().find((s) => s.track && s.track === cam) || null;
    const snd = p.sender;
    if (!snd) return;
    // audio only: stop sending video to this person (others still get it)
    if (p.tier === "bad") { if (snd.track) snd.replaceTrack(null).catch(() => {}); return; }
    if (!snd.track && cam) snd.replaceTrack(cam).catch(() => {});
    const out = this.out();
    const want = encoding(p.tier, p.view, out, people);
    const key = JSON.stringify(want);
    if (key === p.prev) return;
    const prm = snd.getParameters();
    if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}];
    Object.assign(prm.encodings[0], want);
    prm.degradationPreference = "balanced";
    snd.setParameters(prm).then(() => { p.prev = key; }).catch(() => {
      // some browsers refuse a setting (often maxFramerate): try the rest without it
      delete prm.encodings[0].maxFramerate;
      snd.setParameters(prm).then(() => { p.prev = key; }).catch(() => {});
    });
  }
}
