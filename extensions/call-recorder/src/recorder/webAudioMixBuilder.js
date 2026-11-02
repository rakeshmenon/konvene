import { CONFIG } from "../config.js";
import { AppError } from "../domain/errors.js";
import { VoiceGuard } from "../domain/voiceGuard.js";
const GUARD_INTERVAL_MS = 250;
/** About +3 dB. The old compressors raised the level by about this much without anyone asking, and recordings were already quiet. */
const MAKEUP_GAIN = 1.4;
/**
 * Builds the audio that gets recorded:
 *
 *   tab audio ─┬─► your earphones (so the call stays audible)
 *              └─────────────────┐
 *   shared sound ─► (added later; a whole screen's sound replaces the tab's copy of the call)
 *                                 ├─► +3 dB ─► soft clip ─► one mono track
 *   microphone ─► RNNoise ─► high-pass ─┘
 *
 * and pairs it with the tab's video. Each source also feeds a level meter, and a safety check
 * (VoiceGuard) bypasses RNNoise if it ever swallows the voice, so a recording is never silent because of it.
 *
 * There is deliberately no compressor. A Web Audio compressor adds automatic make-up gain, which lifts the noise
 * that rides along with the voice and makes it pump. A soft clip only touches peaks and leaves everything else alone.
 */
export class WebAudioMixBuilder {
  noise;
  constructor(noise) {
    this.noise = noise;
  }
  async build(inputs, options) {
    const ctx = new AudioContext({ sampleRate: CONFIG.audio.sampleRate });
    await this.requireRunning(ctx);
    const disposers = [];
    const out = ctx.createMediaStreamDestination();
    out.channelCount = 1;
    out.channelCountMode = "explicit";
    // Two voices at once can add up past full scale. This rounds off only those peaks, so there is no harsh
    // digital clipping and no change to ordinary levels.
    const softClip = ctx.createWaveShaper();
    softClip.curve = softClipCurve();
    softClip.oversample = "2x";
    softClip.connect(out);
    const makeup = ctx.createGain();
    makeup.gain.value = MAKEUP_GAIN;
    makeup.connect(softClip);
    // The captured tab goes quiet for the user unless we play it back ourselves.
    const tab = ctx.createMediaStreamSource(inputs.tab);
    tab.connect(ctx.destination);
    // The recording's own copy of the call. It steps aside when a whole screen's sound is added (see soundPlanFor), because that
    // sound already contains the call, and two copies a few milliseconds apart would sound like an echo.
    const tabToMix = ctx.createGain();
    tab.connect(tabToMix).connect(makeup);
    const tabMeter = meter(ctx, tab);
    // Shared sound is added later and meets the rest here.
    const sharedBus = ctx.createGain();
    sharedBus.connect(makeup);
    const sharedMeter = meter(ctx, sharedBus);
    let closed = false;
    let callCopyBlockers = 0;
    // The microphone. With noise reduction, two routes lead to the same place and one is open at a time:
    // the cleaned one, and the raw one that the guard switches to if the cleaned one goes silent.
    const mic = ctx.createMediaStreamSource(inputs.mic);
    const micInMeter = meter(ctx, mic);
    const highPass = ctx.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = 80;
    const reducer = options.noiseReduction ? await this.noise.create(ctx) : null;
    let useRaw = null;
    if (reducer) {
      const cleaned = ctx.createGain();
      const raw = ctx.createGain();
      raw.gain.value = 0;
      mic.connect(reducer.node).connect(cleaned).connect(highPass);
      mic.connect(raw).connect(highPass);
      disposers.push(reducer.dispose);
      useRaw = () => {
        cleaned.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        raw.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
      };
    } else {
      mic.connect(highPass);
      // RNNoise was wanted but could not start. The microphone was opened without the browser's noise
      // suppression because RNNoise was meant to do the job, so turn the browser's on after all.
      if (options.noiseReduction) {
        void inputs.mic
          .getAudioTracks()[0]
          ?.applyConstraints({ noiseSuppression: true })
          .catch(() => {});
      }
    }
    highPass.connect(makeup);
    const micMeter = meter(ctx, highPass);
    // The safety net: loud microphone, silent result for a moment means noise reduction is eating the voice.
    const guard = new VoiceGuard();
    if (useRaw) {
      const switchToRaw = useRaw;
      const timer = setInterval(() => {
        if (!guard.bypassed && guard.observe(micInMeter(), micMeter(), GUARD_INTERVAL_MS)) {
          console.warn("Noise reduction was removing your voice, so it was switched off for this recording.");
          switchToRaw();
        }
      }, GUARD_INTERVAL_MS);
      disposers.push(() => clearInterval(timer));
    }
    const audio = out.stream.getAudioTracks();
    const stream = new MediaStream([...inputs.tab.getVideoTracks(), ...audio]);
    return {
      stream,
      levels: () => ({
        micIn: micInMeter(),
        mic: micMeter(),
        tab: tabMeter(),
        shared: sharedMeter(),
        noiseReductionBypassed: guard.bypassed,
      }),
      addSource: (audio, plan) => {
        if (closed) throw new AppError("capture-failed", "The recording has ended.");
        const source = ctx.createMediaStreamSource(audio);
        // Not played back: what the user shares in the picker keeps playing on their own speakers.
        source.connect(sharedBus);
        // Two whole-screen shares at once keep the copy out until both are gone.
        if (!plan.keepCallTabCopy) {
          callCopyBlockers++;
          tabToMix.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        }
        return () => {
          source.disconnect();
          if (!plan.keepCallTabCopy && --callCopyBlockers === 0) tabToMix.gain.setTargetAtTime(1, ctx.currentTime, 0.02);
        };
      },
      dispose: () => {
        closed = true;
        disposers.forEach((d) => d());
        audio.forEach((t) => t.stop());
        void ctx.close().catch(() => {});
      },
    };
  }
  /**
   * A suspended audio context records silence without any error, which is the worst way to fail.
   * Chrome may start it suspended when the page has had no click, so try to resume it and check.
   */
  async requireRunning(ctx) {
    const state = () => ctx.state; // it changes while we wait, so read it fresh each time
    for (let attempt = 0; attempt < 10 && state() !== "running"; attempt++) {
      await ctx.resume().catch(() => {});
      if (state() !== "running") await new Promise((r) => setTimeout(r, 100));
    }
    if (state() !== "running") {
      void ctx.close().catch(() => {});
      throw new AppError(
        "capture-failed",
        "The audio engine could not start, so the recording would have no sound. Reload the extension and try again.",
      );
    }
  }
}
/**
 * Exactly 1:1 up to 0.8 of full scale, then a smooth round-off towards 1.0 (tanh, joined without a kink).
 * Ordinary speech never reaches the bend, so it is not touched. Only the peaks of two loud voices at once are.
 */
function softClipCurve() {
  const points = 4096;
  const knee = 0.8;
  const curve = new Float32Array(new ArrayBuffer(points * 4));
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    const magnitude = Math.abs(x);
    const y = magnitude <= knee ? magnitude : knee + (1 - knee) * Math.tanh((magnitude - knee) / (1 - knee));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}
/** Taps a node and returns a function that reads its current loudness (RMS, 0 to 1). */
function meter(ctx, node) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  node.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  return () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const v of samples) sum += v * v;
    return Math.sqrt(sum / samples.length);
  };
}
