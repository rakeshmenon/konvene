// Same-room detection, worked out on this device only.
//
// Two devices in one room echo: each microphone picks up the other device's speakers, and a
// browser's echo cancellation only knows its own device's sound. The giveaway is in the levels:
// when someone in the room talks, this device's microphone hears it, and a moment later the
// same rise and fall arrives from the other device (its microphone heard it too). Real remote
// people don't line up with this room like that.
//
// So every 25 ms we note the loudness of this microphone and of each person's incoming audio,
// and every second we check whether the last few seconds of one person's audio follow this
// microphone, up to 800 ms behind. Only loudness numbers are kept, for 6 seconds, in memory;
// no audio is stored or sent anywhere.

const FRAME_MS = 25;
const KEEP = 240; // 6 s of loudness values
const WINDOW = 160; // compare the last 4 s
const MAX_LAG = 32; // up to 800 ms behind
const MATCH = 0.7; // how closely they must follow each other
const NEEDED = 5; // matching checks (about 5 s of talking) before we say anything

// how closely `remote` follows `local`, at the best delay: Pearson correlation of the two
// loudness curves, -1..1, with the delay in frames. null when there's too little sound to judge.
export function follow(local, remote, maxLag = MAX_LAG, minSpread = 0.08) {
  const n = Math.min(local.length, remote.length) - maxLag;
  if (n < 40) return null;
  const spread = (a, from, len) => {
    let s = 0, s2 = 0;
    for (let i = from; i < from + len; i++) { s += a[i]; s2 += a[i] * a[i]; }
    const m = s / len;
    return Math.sqrt(Math.max(0, s2 / len - m * m));
  };
  // both sides need real ups and downs (speech), not a steady hum or silence
  if (spread(local, 0, n) < minSpread || spread(remote, maxLag, n) < minSpread) return null;
  let best = -1, bestLag = 0;
  for (let lag = 0; lag <= maxLag; lag++) {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let i = 0; i < n; i++) {
      const a = local[i], b = remote[i + lag];
      sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
    }
    const cov = sab / n - (sa / n) * (sb / n);
    const va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
    if (va <= 0 || vb <= 0) continue;
    const r = cov / Math.sqrt(va * vb);
    if (r > best) { best = r; bestLag = lag; }
  }
  return { r: best, lag: bestLag };
}

const buf = new Float32Array(1024);
function loudness(analyser) {
  analyser.getFloatTimeDomainData(buf);
  let s = 0;
  const n = Math.min(buf.length, analyser.fftSize);
  for (let i = 0; i < n; i++) s += buf[i] * buf[i];
  return Math.log10(Math.sqrt(s / n) + 1e-4); // log, so loud and quiet rooms compare alike
}

export class RoomEcho {
  // mic(): this device's raw microphone analyser (or null)
  // others(): [[id, analyser], ...] for the people in the call
  // onMatch(id): called once per person whose audio keeps following this room
  constructor({ mic, others, onMatch }) {
    this.mic = mic; this.others = others; this.onMatch = onMatch;
    this.local = [];
    this.remote = new Map(); // id -> loudness values
    this.hits = new Map();
    this.done = new Set();
    this.timer = 0; this.tick = 0;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.sample(), FRAME_MS);
  }

  stop() { clearInterval(this.timer); this.timer = 0; this.local = []; this.remote.clear(); this.hits.clear(); }

  forget(id) { this.remote.delete(id); this.hits.delete(id); }

  sample() {
    const m = this.mic();
    if (!m) return;
    push(this.local, loudness(m));
    const seen = new Set();
    for (const [id, a] of this.others()) {
      if (!a || this.done.has(id)) continue;
      seen.add(id);
      if (!this.remote.has(id)) this.remote.set(id, []);
      push(this.remote.get(id), loudness(a));
    }
    for (const id of this.remote.keys()) if (!seen.has(id)) this.forget(id);
    if (++this.tick % 40 === 0) this.check(); // once a second
  }

  check() {
    if (this.local.length < WINDOW + MAX_LAG) return;
    const local = this.local.slice(-(WINDOW + MAX_LAG), -MAX_LAG);
    for (const [id, values] of this.remote) {
      if (values.length < WINDOW + MAX_LAG) continue;
      const res = follow(local, values.slice(-(WINDOW + MAX_LAG)));
      const h = this.hits.get(id) || 0;
      if (res && res.r >= MATCH) this.hits.set(id, h + 1);
      else if (res) this.hits.set(id, Math.max(0, h - 1));
      if ((this.hits.get(id) || 0) >= NEEDED) {
        this.done.add(id);
        this.forget(id);
        this.onMatch(id);
      }
    }
  }
}

function push(a, v) { a.push(v); if (a.length > KEEP) a.shift(); }
