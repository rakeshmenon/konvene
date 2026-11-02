import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordingSession } from "../src/recorder/recordingSession.js";
import { FakeClock } from "./helpers/fakes.js";
const PROFILE = {
  mimeType: "video/webm;codecs=vp9,opus",
  container: "webm",
  extension: "webm",
  videoBitsPerSecond: 1,
  audioBitsPerSecond: 1,
};
const blob = (text) => new Blob([text]);
const stream = {};
function build() {
  const log = [];
  const clock = new FakeClock();
  let tabEnded = () => {};
  let extraEnded = () => {};
  const shared = { kind: "tab" };
  let emit = () => {};
  let fail = () => {};
  const written = [];
  let sinkClosed = false;
  const inputs = {
    open: async (_streamId, options) => {
      log.push(options.browserNoiseSuppression ? "open-with-browser-noise-suppression" : "open");
      return {
        tab: stream,
        mic: stream,
        onTabEnded: (cb) => {
          tabEnded = cb;
        },
        close: () => log.push("inputs-closed"),
      };
    },
  };
  const receiver = {
    accept: async (offer) => {
      log.push(`accept:${offer}`);
      return {
        answer: `answer-to-${offer}`,
        audio: stream,
        onClosed: (cb) => {
          extraEnded = cb;
        },
        close: () => log.push("share-closed"),
      };
    },
  };
  const level = { mic: 0, tab: 0, shared: 0 };
  const mixer = {
    build: async (_inputs, options) => {
      log.push(options.noiseReduction ? "mix" : "mix-without-noise-reduction");
      return {
        stream,
        levels: () => ({ micIn: level.mic, mic: level.mic, tab: level.tab, shared: level.shared, noiseReductionBypassed: false }),
        addSource: (_audio, plan) => {
          log.push(`mix-add-source:${plan.keepCallTabCopy ? "keep-call-copy" : "drop-call-copy"}`);
          return () => log.push("mix-remove-source");
        },
        dispose: () => log.push("mix-disposed"),
      };
    },
  };
  const encoder = {
    start: (_s, profile, onChunk, onFail) => {
      log.push(`encode:${profile.mimeType}`);
      emit = onChunk;
      fail = onFail;
    },
    stop: async () => {
      log.push("encoder-stopped");
      emit(blob("last"));
    },
  };
  const sinkState = { failOn: "" };
  const sink = {
    open: async (name) => {
      log.push(`sink-open:${name}`);
    },
    append: async (chunk) => {
      const text = await chunk.text();
      if (text === sinkState.failOn) throw new Error("disk full");
      written.push(text);
    },
    close: async () => {
      sinkClosed = true;
      return written.join("").length;
    },
  };
  const session = new RecordingSession({ inputs, receiver, mixer, encoder, sink, chooseProfile: async () => PROFILE, clock });
  return {
    session,
    log,
    level,
    clock,
    written,
    sinkState,
    isSinkClosed: () => sinkClosed,
    emit: (c) => emit(c),
    fail: (e) => fail(e),
    endTab: () => tabEnded(),
    endShared: () => extraEnded(),
    shared,
  };
}
afterEach(() => {
  vi.useRealTimers();
});
describe("RecordingSession", () => {
  it("opens, mixes, writes and encodes in order, then reports the file on stop", async () => {
    const t = build();
    const profile = await t.session.start({ streamId: "s", stagingName: "rec-1", noiseReduction: true }, () => {});
    expect(profile).toBe(PROFILE);
    expect(t.log).toEqual(["open", "mix", "sink-open:rec-1", `encode:${PROFILE.mimeType}`]);
    expect(t.session.recording).toBe(true);
    t.emit(blob("aa"));
    t.emit(blob("bb"));
    t.clock.advance(62_000);
    const capture = await t.session.stop();
    expect(t.written).toEqual(["aa", "bb", "last"]);
    expect(capture).toEqual({ stagingName: "rec-1", sizeBytes: 8, durationMs: 62_000, mimeType: PROFILE.mimeType, soundDetected: false });
    expect(t.log.slice(-3)).toEqual(["encoder-stopped", "mix-disposed", "inputs-closed"]);
    expect(t.session.recording).toBe(false);
  });
  it("rejects a second start while recording, and stop when idle", async () => {
    const t = build();
    await expect(t.session.stop()).rejects.toThrow("Not recording.");
    await t.session.start({ streamId: "s", stagingName: "a", noiseReduction: true }, () => {});
    await expect(t.session.start({ streamId: "s", stagingName: "b", noiseReduction: true }, () => {})).rejects.toThrow("already running");
  });
  it("finishes by itself when the tab closes", async () => {
    const t = build();
    const ends = [];
    await t.session.start({ streamId: "s", stagingName: "rec-1", noiseReduction: true }, (e) => ends.push(e));
    t.emit(blob("xyz"));
    t.endTab();
    await new Promise((r) => setTimeout(r, 0));
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ reason: "tab-closed", capture: { stagingName: "rec-1", sizeBytes: 7 } });
    expect(t.session.recording).toBe(false);
  });
  it("finishes and reports the error when the encoder fails", async () => {
    const t = build();
    const ends = [];
    await t.session.start({ streamId: "s", stagingName: "rec-1", noiseReduction: true }, (e) => ends.push(e));
    t.fail(new Error("encoder blew up"));
    await new Promise((r) => setTimeout(r, 0));
    expect(ends[0]).toMatchObject({ reason: "error", error: "encoder blew up" });
  });
  it("finishes and reports the error when a chunk cannot be written", async () => {
    const t = build();
    const ends = [];
    await t.session.start({ streamId: "s", stagingName: "rec-1", noiseReduction: true }, (e) => ends.push(e));
    t.sinkState.failOn = "bad";
    t.emit(blob("good"));
    t.emit(blob("bad"));
    await new Promise((r) => setTimeout(r, 10));
    expect(ends[0]).toMatchObject({ reason: "error", error: "disk full" });
    expect(t.written).toEqual(["good", "last"]);
  });
  it("ignores a tab ending that arrives while the user is stopping", async () => {
    const t = build();
    const ends = [];
    await t.session.start({ streamId: "s", stagingName: "rec-1", noiseReduction: true }, (e) => ends.push(e));
    const stopping = t.session.stop();
    t.endTab();
    await stopping;
    expect(ends).toHaveLength(0);
  });
  it("cleans up what it opened when a later step fails", async () => {
    const log = [];
    const session = new RecordingSession({
      inputs: {
        open: async () => ({ tab: stream, mic: stream, onTabEnded: () => {}, close: () => log.push("inputs-closed") }),
      },
      receiver: {
        accept: async () => {
          throw new Error("unused");
        },
      },
      mixer: {
        build: async () => {
          throw new Error("audio graph failed");
        },
      },
      encoder: { start: () => {}, stop: async () => {} },
      sink: { open: async () => {}, append: async () => {}, close: async () => 0 },
      chooseProfile: async () => PROFILE,
      clock: new FakeClock(),
    });
    await expect(session.start({ streamId: "s", stagingName: "a", noiseReduction: true }, () => {})).rejects.toThrow("audio graph failed");
    expect(log).toEqual(["inputs-closed"]);
    expect(session.recording).toBe(false);
  });
  it("passes the noise reduction choice to the mixer", async () => {
    const t = build();
    await t.session.start({ streamId: "s", stagingName: "a", noiseReduction: false }, () => {});
    expect(t.log).toContain("mix-without-noise-reduction");
  });
  it("lets the browser suppress noise on the microphone only when RNNoise is off, never both", async () => {
    const on = build();
    await on.session.start({ streamId: "s", stagingName: "a", noiseReduction: true }, () => {});
    expect(on.log[0]).toBe("open"); // RNNoise does it, so the browser does not
    const off = build();
    await off.session.start({ streamId: "s", stagingName: "a", noiseReduction: false }, () => {});
    expect(off.log[0]).toBe("open-with-browser-noise-suppression"); // RNNoise is off, so the browser does it
  });
  it("reports levels only while recording", async () => {
    const t = build();
    expect(t.session.levels()).toBeNull();
    await t.session.start({ streamId: "s", stagingName: "a", noiseReduction: true }, () => {});
    t.level.mic = 0.2;
    expect(t.session.levels()).toMatchObject({ mic: 0.2 });
    await t.session.stop();
    expect(t.session.levels()).toBeNull();
  });
  it("says sound was detected when the call or the microphone was audible at any time", async () => {
    vi.useFakeTimers();
    const t = build();
    await t.session.start({ streamId: "s", stagingName: "rec-1", noiseReduction: true }, () => {});
    await vi.advanceTimersByTimeAsync(1000); // silence
    t.level.tab = 0.05; // someone speaks on the call
    await vi.advanceTimersByTimeAsync(500);
    t.level.tab = 0;
    const capture = await t.session.stop();
    expect(capture.soundDetected).toBe(true);
  });
  it("says no sound was detected when everything stayed silent", async () => {
    vi.useFakeTimers();
    const t = build();
    await t.session.start({ streamId: "s", stagingName: "rec-1", noiseReduction: true }, () => {});
    await vi.advanceTimersByTimeAsync(3000);
    const capture = await t.session.stop();
    expect(capture.soundDetected).toBe(false);
  });
  describe("shared sound", () => {
    const START = { streamId: "s", stagingName: "rec-1", noiseReduction: true };
    const SHARE = { shareId: "share-1", kind: "tab", offer: "offer-1" };
    const started = async (t, onEnded = () => {}) => {
      await t.session.start(START, onEnded);
      return t;
    };

    it("takes the sound of a share the page offers while recording, and returns the answer for the page", async () => {
      const t = await started(build());
      expect(await t.session.addShare(SHARE)).toBe("answer-to-offer-1");
      expect(t.log).toContain("mix-add-source:keep-call-copy");
      expect(t.session.levels().sharedActive).toBe(true);
    });

    it("drops the call tab's own copy when the whole screen's sound is shared, because it holds the call already", async () => {
      const t = await started(build());
      await t.session.addShare({ ...SHARE, kind: "screen" });
      expect(t.log).toContain("mix-add-source:drop-call-copy");
    });

    it("refuses a share when nothing is recording, and the same share twice", async () => {
      const t = build();
      await expect(t.session.addShare(SHARE)).rejects.toThrow("Not recording");
      await started(t);
      await t.session.addShare(SHARE);
      await expect(t.session.addShare(SHARE)).rejects.toThrow("already being recorded");
    });

    it("takes the sound out when the page stops sharing, and the recording carries on", async () => {
      const ends = [];
      const t = await started(build(), (e) => ends.push(e));
      await t.session.addShare(SHARE);
      t.session.removeShare("share-1");
      expect(t.log).toContain("mix-remove-source");
      expect(t.log).toContain("share-closed");
      expect(t.session.levels().sharedActive).toBe(false);
      expect(t.session.recording).toBe(true);
      expect(ends).toHaveLength(0);
    });

    it("takes the sound out when the connection closes by itself", async () => {
      const t = await started(build());
      await t.session.addShare(SHARE);
      t.endShared();
      expect(t.log).toContain("mix-remove-source");
      expect(t.session.recording).toBe(true);
    });

    it("lets go of a share once, however it ends", async () => {
      const t = await started(build());
      await t.session.addShare(SHARE);
      t.session.removeShare("share-1");
      t.endShared();
      await t.session.stop();
      expect(t.log.filter((l) => l === "share-closed")).toHaveLength(1);
    });

    it("lets go of the shares when the recording stops", async () => {
      const t = await started(build());
      await t.session.addShare(SHARE);
      await t.session.stop();
      expect(t.log).toContain("share-closed");
    });

    it("takes a second share after the first one ended", async () => {
      const t = await started(build());
      await t.session.addShare(SHARE);
      t.session.removeShare("share-1");
      await t.session.addShare({ ...SHARE, shareId: "share-2" });
      expect(t.session.levels().sharedActive).toBe(true);
    });

    it("counts shared sound as sound heard", async () => {
      vi.useFakeTimers();
      const t = await started(build());
      await t.session.addShare(SHARE);
      t.level.shared = 0.2;
      await vi.advanceTimersByTimeAsync(500);
      t.level.shared = 0;
      expect((await t.session.stop()).soundDetected).toBe(true);
    });

    it("closes the connection if the recording ended while the share was being accepted", async () => {
      const t = await started(build());
      const adding = t.session.addShare(SHARE);
      await t.session.stop();
      await expect(adding).rejects.toThrow("ended");
      expect(t.log).toContain("share-closed");
    });
  });
});
