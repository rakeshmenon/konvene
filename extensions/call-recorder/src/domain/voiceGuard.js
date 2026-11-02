export const DEFAULT_VOICE_GUARD = { rawThreshold: 0.03, processedThreshold: 0.002, afterMs: 1500 };
/**
 * A safety net for noise reduction. If the microphone is clearly loud but nothing comes out of the noise reduction,
 * for a few seconds in total, the noise reduction is swallowing the voice. Losing someone's voice is far worse
 * than keeping some background noise, so we ask for it to be bypassed, and stay bypassed for the rest of the recording.
 *
 * Speech has pauses, so the time is added up across words rather than needing one unbroken stretch. It starts over
 * only when the cleaned sound really does carry a voice. Loud steady noise with nobody speaking can also trip it,
 * which is the safe way to be wrong.
 */
export class VoiceGuard {
  options;
  silentMs = 0;
  tripped = false;
  constructor(options = DEFAULT_VOICE_GUARD) {
    this.options = options;
  }
  get bypassed() {
    return this.tripped;
  }
  /** Call regularly with the current levels and the time since the last call. Returns true once bypass is wanted. */
  observe(rawLevel, processedLevel, elapsedMs) {
    if (this.tripped) return true;
    if (processedLevel >= this.options.processedThreshold) {
      this.silentMs = 0; // the noise reduction is letting sound through, so it is working
    } else if (rawLevel > this.options.rawThreshold) {
      this.silentMs += elapsedMs; // loud in, nothing out
    } // quiet in and quiet out: a pause, so neither add nor reset
    if (this.silentMs >= this.options.afterMs) this.tripped = true;
    return this.tripped;
  }
}

/**
 * @typedef {object} VoiceGuardOptions
 * @property {number} rawThreshold The microphone counts as "someone is talking" above this level (0 to 1).
 * @property {number} processedThreshold The cleaned microphone counts as "silent" below this level.
 * @property {number} afterMs How long that has to last before we act, so a single cough or keystroke never triggers it.
 */
