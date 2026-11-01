// Cleaning up your microphone, on this device.
//
//   standard: the browser's own echo cancellation, noise suppression and level control
//   strong:   the same, plus RNNoise (a small neural network, run here in an AudioWorklet) that
//             removes steady and sudden noise: fans, keyboards, traffic, dishes
//   off:      original sound for music: no processing at all (wear headphones, or others hear
//             themselves echo back)
//
// The RNNoise files are served from this site (dist/vendor/rnnoise); nothing is fetched elsewhere.
import { RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";

export const NOISE_MODES = [
  { value: "standard", label: "Standard noise reduction", hint: "Your browser's echo and noise control." },
  { value: "strong", label: "Strong noise reduction", hint: "Also removes keyboards, fans and traffic." },
  { value: "off", label: "Original sound (music)", hint: "No processing. Use headphones." },
];
const KEY = "konvene_sound";

export function loadNoise() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "{}").noise; return NOISE_MODES.some((m) => m.value === v) ? v : "standard"; } catch { return "standard"; }
}
export function saveNoise(v) { try { localStorage.setItem(KEY, JSON.stringify({ noise: v })); } catch { /* private */ } }

export const CAN_STRONG = typeof window !== "undefined" && typeof AudioWorkletNode !== "undefined" && typeof WebAssembly !== "undefined";

export function micConstraints(id, mode) {
  const on = mode !== "off";
  const a = { echoCancellation: on, noiseSuppression: on, autoGainControl: on };
  if (id) a.deviceId = { exact: id };
  return { audio: a, video: false };
}

// RNNoise needs 48 kHz audio, so it gets its own audio context
export class Denoiser {
  constructor() { this.ctx = null; this.ready = null; this.chain = null; }

  async load() {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: 48000 });
    if (!this.ready) {
      this.ready = (async () => {
        const bin = await loadRnnoise({ url: "/vendor/rnnoise/rnnoise.wasm", simdUrl: "/vendor/rnnoise/rnnoise_simd.wasm" });
        await this.ctx.audioWorklet.addModule("/vendor/rnnoise/rnnoiseWorklet.js");
        return bin;
      })();
      this.ready.catch(() => { this.ready = null; });
    }
    return this.ready;
  }

  // a cleaned-up copy of the stream's audio; returns { track, dispose }
  async process(stream) {
    const bin = await this.load();
    const ctx = this.ctx;
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const node = new RnnoiseWorkletNode(ctx, { wasmBinary: bin, maxChannels: 1 });
    const dest = ctx.createMediaStreamDestination();
    source.connect(node).connect(dest);
    const track = dest.stream.getAudioTracks()[0];
    const dispose = () => {
      try { source.disconnect(); node.disconnect(); node.destroy(); } catch { /* gone */ }
      track.stop();
    };
    return { track, dispose };
  }

  // the context starts paused until a click; any click can wake it
  resume() { if (this.ctx && this.ctx.state !== "running") this.ctx.resume().catch(() => {}); }
}
