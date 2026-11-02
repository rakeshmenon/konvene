import { soundPlanFor } from "../domain/shareKind.js";
import { messageOf } from "../domain/errors.js";
/** Below this level (RMS, 0 to 1) a source counts as silent. Quiet speech is around 0.01 and above. */
const SOUND_THRESHOLD = 0.002;
const SAMPLE_EVERY_MS = 250;
/**
 * One recording from start to stop. It owns the order of things (open, mix, write, encode, finish) and nothing
 * about how each step is done, so every step can be replaced or faked. Chunks are written as they arrive,
 * so memory use stays flat however long the call is.
 */
export class RecordingSession {
  d;
  running = null;
  /** Chunk writes run one after another, so the file keeps the order the encoder produced. */
  writes = Promise.resolve();
  writeError = null;
  onEnded = () => {};
  constructor(d) {
    this.d = d;
  }
  get recording() {
    return this.running !== null;
  }
  /** Loudness of each source right now, or null when not recording. */
  levels() {
    return this.running ? { ...this.running.mix.levels(), sharedActive: this.running.shares.size > 0 } : null;
  }
  async start(req, onEnded) {
    if (this.running) throw new Error("A recording is already running.");
    this.onEnded = onEnded;
    this.writes = Promise.resolve();
    this.writeError = null;
    const undo = [];
    try {
      const profile = await this.d.chooseProfile();
      const inputs = await this.d.inputs.open(req.streamId, { browserNoiseSuppression: !req.noiseReduction });
      undo.push(() => inputs.close());
      const mix = await this.d.mixer.build(inputs, { noiseReduction: req.noiseReduction });
      undo.push(() => mix.dispose());
      await this.d.sink.open(req.stagingName);
      undo.push(() => this.d.sink.close());
      const running = {
        noiseReduction: req.noiseReduction,
        heardSound: false,
        stagingName: req.stagingName,
        profile,
        startedAt: this.d.clock.now(),
        inputs,
        mix,
        shares: new Map(),
        // Listens for sound all the way through, so a recording that stayed silent can be flagged when it ends.
        sampler: setInterval(() => {
          const l = mix.levels();
          if (Math.max(l.mic, l.tab, l.shared) > SOUND_THRESHOLD) running.heardSound = true;
        }, SAMPLE_EVERY_MS),
      };
      undo.push(() => clearInterval(running.sampler));
      this.running = running;
      this.d.encoder.start(
        mix.stream,
        profile,
        (chunk) => this.write(chunk),
        (e) => void this.end("error", e),
      );
      inputs.onTabEnded(() => void this.end("tab-closed"));
      return profile;
    } catch (e) {
      this.running = null;
      for (const step of undo.reverse()) {
        try {
          await step();
        } catch {
          /* best effort cleanup */
        }
      }
      throw e;
    }
  }
  /**
   * Takes the sound of a screen or tab the call page is sharing and mixes it in, as its kind decides. It leaves the
   * mix again when the page stops sharing, and the recording carries on, with the call tab's own sound back if it had
   * stepped aside. Returns the reply for the page.
   */
  async addShare({ shareId, kind, offer }) {
    const run = this.running;
    if (!run) throw new Error("Not recording.");
    if (run.shares.has(shareId)) throw new Error("That share is already being recorded.");
    const accepted = await this.d.receiver.accept(offer);
    if (this.running !== run) {
      accepted.close();
      throw new Error("The recording ended before the shared sound could be added.");
    }
    let remove;
    try {
      remove = run.mix.addSource(accepted.audio, soundPlanFor(kind));
    } catch (e) {
      accepted.close();
      throw e;
    }
    const share = {
      leave: () => {
        if (run.shares.get(shareId) !== share) return;
        run.shares.delete(shareId);
        remove();
        accepted.close();
      },
    };
    run.shares.set(shareId, share);
    accepted.onClosed(share.leave);
    return accepted.answer;
  }

  /** The page stopped sharing. */
  removeShare(shareId) {
    this.running?.shares.get(shareId)?.leave();
  }

  /** The user pressed Stop. */
  async stop() {
    if (!this.running) throw new Error("Not recording.");
    return this.finish();
  }
  write(chunk) {
    this.writes = this.writes
      .then(() => this.d.sink.append(chunk))
      .catch((e) => {
        this.writeError ??= e instanceof Error ? e : new Error(messageOf(e));
        void this.end("error", this.writeError);
      });
  }
  /** The session ended without the user asking: the tab closed or something failed. */
  async end(reason, error) {
    if (!this.running) return;
    const capture = await this.finish();
    this.onEnded({ capture, reason, error: error?.message });
  }
  async finish() {
    const run = this.running;
    if (!run) throw new Error("Not recording.");
    this.running = null; // first, so a second ending (tab closed while stopping) is ignored
    clearInterval(run.sampler);
    const last = run.mix.levels();
    if (Math.max(last.mic, last.tab, last.shared) > SOUND_THRESHOLD) run.heardSound = true;
    await this.d.encoder.stop();
    await this.writes;
    const sizeBytes = await this.d.sink.close();
    [...run.shares.values()].forEach((share) => share.leave());
    run.mix.dispose();
    run.inputs.close();
    return {
      stagingName: run.stagingName,
      sizeBytes,
      durationMs: this.d.clock.now() - run.startedAt,
      mimeType: run.profile.mimeType,
      soundDetected: run.heardSound,
    };
  }
}

/**
 * @typedef {object} SessionDeps
 * @property {InputOpener} inputs
 * @property {ShareReceiver} receiver
 * @property {MixBuilder} mixer
 * @property {Encoder} encoder
 * @property {ChunkSink} sink
 * @property {() => Promise<EncodingProfile>} chooseProfile
 * @property {Clock} clock
 */

/**
 * @typedef {object} SessionEnd
 * @property {CaptureFile} capture
 * @property {"tab-closed" | "error"} reason
 * @property {string} [error]
 */

/**
 * @typedef {object} Running
 * @property {boolean} noiseReduction
 * @property {boolean} heardSound
 * @property {ReturnType<typeof setInterval>} sampler
 * @property {string} stagingName
 * @property {EncodingProfile} profile
 * @property {number} startedAt
 * @property {CallInputs} inputs
 * @property {MixedStream} mix
 * @property {Map<string, { leave: () => void }>} shares The screens and tabs being shared in the call, by id.
 */
