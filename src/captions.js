// Live captions, made on the devices in the call. Never on a server.
//
// Chrome 139+ (desktop) can turn speech into text on the device itself (the Web Speech API with
// processLocally = true, the same engine as Chrome's Live Caption). With processLocally the
// browser must not send the audio anywhere; if it can't do it on the device, it fails rather
// than falling back to Google's servers. So Konvene only ever uses it with processLocally on.
//
// The first time, the browser downloads a language pack for it (Chrome fetches this itself,
// once; nothing about your call is part of that request).
//
// Who captions whom (main.js): each person whose browser can do it captions their own voice
// (what the others hear, so nothing while muted) and sends the words straight to the people who
// turned captions on. Someone whose browser can't is captioned by the browser of whoever wants
// captions, from the audio it already receives.

const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
// Only desktop Google Chrome 139+ for now. Other Chromium builds expose the same API without the
// on-device engine, and asking them about it can crash the page (plain Chromium does), which
// mid-call would drop you. (konveneFake: the test's stand-in for the engine.)
function trusted() {
  if (SR && SR.konveneFake) return true;
  const d = typeof navigator !== "undefined" && navigator.userAgentData;
  return !!(d && !d.mobile && d.brands.some((b) => b.brand === "Google Chrome" && Number(b.version) >= 139));
}
export const CAN_LOCAL = !!(SR && "processLocally" in SR.prototype && typeof SR.available === "function" && trusted());

// the first language this browser can caption on the device: "available" (ready), "downloadable"
// (needs a one-time download), or null if none
export async function findLanguage() {
  if (!CAN_LOCAL) return null;
  const want = [...new Set([...(navigator.languages || []), navigator.language, "en-US"].filter(Boolean))];
  let fallback = null;
  for (const lang of want) {
    let st;
    try { st = await SR.available({ langs: [lang], processLocally: true }); } catch { continue; }
    if (st === "available") return { lang, ready: true };
    if (!fallback && (st === "downloadable" || st === "downloading")) fallback = { lang, ready: false };
  }
  return fallback;
}

// the one-time language pack download (needs a click, so call it from one)
export async function install(lang) {
  try { return await SR.install({ langs: [lang], processLocally: true }); } catch { return false; }
}

// Turns one audio track into text, continuously. onText(text, final) for each phrase as it forms.
export class Transcriber {
  constructor({ lang, track, onText, onFail }) {
    this.lang = lang; this.track = track; this.onText = onText; this.onFail = onFail;
    this.rec = null; this.running = false; this.fails = 0; this.timer = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.open();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    const r = this.rec;
    this.rec = null;
    if (r) { r.onend = null; r.onresult = null; r.onerror = null; try { r.abort(); } catch { /* stopped */ } }
  }

  // a new microphone: listen to that instead
  setTrack(track) {
    if (track === this.track) return;
    this.track = track;
    if (this.running) { this.stop(); this.start(); }
  }

  open() {
    if (!this.running) return;
    if (!this.track || this.track.readyState !== "live") { this.timer = setTimeout(() => this.open(), 1000); return; }
    const r = new SR();
    r.lang = this.lang;
    r.continuous = true;
    r.interimResults = true;
    r.processLocally = true; // on this device, or not at all
    r.onresult = (e) => {
      this.fails = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = String((res[0] && res[0].transcript) || "").trim();
        if (text) this.onText(text, !!res.isFinal);
      }
    };
    r.onerror = (e) => {
      const err = e && e.error;
      if (err === "no-speech" || err === "aborted") return;
      // it can't run on this device (no language pack, not allowed): stop for good
      if (err === "service-not-allowed" || err === "language-not-supported" || err === "not-allowed" || err === "audio-capture") { this.fail(err); }
    };
    // the engine stops after a while or after silence: start it again
    r.onend = () => {
      if (this.rec !== r || !this.running) return;
      this.rec = null;
      this.fails++;
      this.timer = setTimeout(() => this.open(), Math.min(5000, 250 * this.fails));
    };
    this.rec = r;
    try { r.start(this.track); } catch (err) { this.rec = null; this.fail(err && err.name); }
  }

  fail(why) {
    const was = this.running;
    this.stop();
    if (was && this.onFail) this.onFail(why);
  }
}
