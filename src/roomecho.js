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
//
// The direction matters. In one room, a sound reaches this microphone first and arrives from
// the other device a moment later. When this device's speakers leak into its own microphone
// (loud speakers, echo cancellation off or overwhelmed), the other person's voice arrives first
// and reaches this microphone after it: they hear themselves, but it isn't the same room, and
// the fix is headphones or a lower volume here, so that gets its own message (onLeak).

const FRAME_MS = 25;
const KEEP = 240; // 6 s of loudness values
const WINDOW = 160; // compare the last 4 s
const MAX_LAG = 32; // up to 800 ms behind
const MATCH = 0.7; // how closely they must follow each other
const NEEDED = 5; // matching checks (about 5 s of talking) before we say anything
const LEAK_MATCH = 0.6; // their voice in this microphone, at a steady delay
const LEAK_NEEDED = 4; // such checks (people take turns, so they come in bursts)
const LEAK_GAP = 20; // checks (seconds) a run of leak checks may pause for
const LEAK_MAX_LAG = 16; // speakers to microphone takes at most about 400 ms (Bluetooth included)

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

// which way the sound runs between this microphone and someone's audio: the best match over
// delays in both directions. lag >= 0: theirs follows this microphone, or arrives with it
// (same room); lag < 0: this microphone follows theirs (their voice out of our speakers, which
// always takes a moment: the speakers' and microphone's own delays).
// Both arrays are the last WINDOW + maxLag values.
export function direction(local, remote, maxLag = MAX_LAG) {
  const old = (a) => a.slice(0, a.length - maxLag);
  const fwd = follow(old(local), remote, maxLag), rev = follow(old(remote), local, maxLag);
  if (!fwd && !rev) return null;
  if (fwd && (!rev || fwd.r >= rev.r)) return { r: fwd.r, lag: fwd.lag };
  return { r: rev.r, lag: -rev.lag };
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
  // onLeak(id): called once (until again(id)) when this microphone keeps picking up that
  //   person's voice from our speakers; counted only while canLeak() (our microphone is on)
  constructor({ mic, others, onMatch, onLeak = () => {}, canLeak = () => true }) {
    this.mic = mic; this.others = others; this.onMatch = onMatch; this.onLeak = onLeak; this.canLeak = canLeak;
    this.leaks = new Map(); // id -> { lag, n, at }
    this.leakDone = new Set();
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

  stop() { clearInterval(this.timer); this.timer = 0; this.local = []; this.remote.clear(); this.hits.clear(); this.leaks.clear(); this.leakDone.clear(); }

  // listen for that person's voice in our speakers again (after the card was dismissed)
  again(id) { this.leakDone.delete(id); this.leaks.delete(id); }

  forget(id) { this.remote.delete(id); this.hits.delete(id); this.leaks.delete(id); }

  sample() {
    const m = this.mic();
    if (!m) return;
    push(this.local, loudness(m));
    const seen = new Set();
    for (const [id, a] of this.others()) {
      if (!a || (this.done.has(id) && this.leakDone.has(id))) continue;
      seen.add(id);
      if (!this.remote.has(id)) this.remote.set(id, []);
      push(this.remote.get(id), loudness(a));
    }
    for (const id of this.remote.keys()) if (!seen.has(id)) this.forget(id);
    if (++this.tick % 40 === 0) this.check(); // once a second
  }

  check() {
    if (this.local.length < WINDOW + MAX_LAG) return;
    const local = this.local.slice(-(WINDOW + MAX_LAG));
    for (const [id, values] of this.remote) {
      if (values.length < WINDOW + MAX_LAG) continue;
      const res = direction(local, values.slice(-(WINDOW + MAX_LAG)));
      if (res && res.lag < 0 && res.lag >= -LEAK_MAX_LAG && res.r >= LEAK_MATCH && !this.leakDone.has(id) && this.canLeak()) this.leakCheck(id, res.lag);
      if (this.done.has(id)) continue;
      const h = this.hits.get(id) || 0;
      if (res && res.lag >= 0 && res.r >= MATCH) this.hits.set(id, h + 1);
      else if (res) this.hits.set(id, Math.max(0, h - 1));
      if ((this.hits.get(id) || 0) >= NEEDED) {
        this.done.add(id);
        this.hits.delete(id);
        this.onMatch(id);
      }
    }
  }

  // a speaker leak has one steady delay (the speakers' own); unrelated sounds don't
  leakCheck(id, lag) {
    const now = this.tick / 40, L = this.leaks.get(id);
    if (L && Math.abs(lag - L.lag) <= 1 && now - L.at <= LEAK_GAP) { L.n++; L.at = now; }
    else this.leaks.set(id, { lag, n: 1, at: now });
    if (this.leaks.get(id).n >= LEAK_NEEDED) {
      this.leakDone.add(id);
      this.leaks.delete(id);
      this.onLeak(id);
    }
  }
}

function push(a, v) { a.push(v); if (a.length > KEEP) a.shift(); }
