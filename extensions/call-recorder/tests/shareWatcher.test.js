import { describe, expect, it } from "vitest";
import { ShareWatcher } from "../src/content/shareWatcher.js";

/** A stand-in for what getDisplayMedia returns: a picture and, optionally, a sound. */
function fakeStream({ surface = "monitor", sound = true } = {}) {
  const listeners = [];
  const audio = { addEventListener: (_type, cb) => listeners.push(cb) };
  return {
    stream: {
      getAudioTracks: () => (sound ? [audio] : []),
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: surface }) }],
    },
    stopSharing: () => listeners.forEach((cb) => cb()),
  };
}

function build({ answer = "the-answer" } = {}) {
  const calls = [];
  const peers = [];
  const watcher = new ShareWatcher({
    request: async (type, payload) => {
      calls.push({ type, payload });
      return { answer: type === "offer" ? answer : undefined };
    },
    createPeer: () => {
      const peer = {
        closed: false,
        accepted: null,
        createOffer: async () => "the-offer",
        accept: async (a) => {
          peer.accepted = a;
        },
        close: () => {
          peer.closed = true;
        },
      };
      peers.push(peer);
      return peer;
    },
  });
  return { watcher, calls, peers };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("ShareWatcher", () => {
  it("offers a share that starts while a recording runs, with what kind it is", async () => {
    const { watcher, calls, peers } = build();
    watcher.setRecording(true);
    watcher.watch(fakeStream({ surface: "monitor" }).stream);
    await settle();
    expect(calls).toEqual([{ type: "offer", payload: { shareId: "share-1", kind: "screen", offer: "the-offer" } }]);
    expect(peers[0].accepted).toBe("the-answer");
  });

  it("reads a shared tab as a tab", async () => {
    const { watcher, calls } = build();
    watcher.setRecording(true);
    watcher.watch(fakeStream({ surface: "browser" }).stream);
    await settle();
    expect(calls[0].payload.kind).toBe("tab");
  });

  it("offers nothing until a recording starts, then offers the share that was already running", async () => {
    const { watcher, calls } = build();
    watcher.watch(fakeStream().stream);
    await settle();
    expect(calls).toHaveLength(0);
    watcher.setRecording(true);
    await settle();
    expect(calls.map((c) => c.type)).toEqual(["offer"]);
  });

  it("ignores a share that has no sound", async () => {
    const { watcher, calls } = build();
    watcher.setRecording(true);
    watcher.watch(fakeStream({ sound: false }).stream);
    await settle();
    expect(calls).toHaveLength(0);
  });

  it("lets go of the connection when the recorder says it is not recording this share", async () => {
    const { watcher, peers } = build({ answer: null });
    watcher.setRecording(true);
    watcher.watch(fakeStream().stream);
    await settle();
    expect(peers[0].closed).toBe(true);
  });

  it("tells the recorder when the share ends, and lets go of the connection", async () => {
    const { watcher, calls, peers } = build();
    watcher.setRecording(true);
    const share = fakeStream();
    watcher.watch(share.stream);
    await settle();
    share.stopSharing();
    await settle();
    expect(calls.at(-1)).toEqual({ type: "ended", payload: { shareId: "share-1" } });
    expect(peers[0].closed).toBe(true);
  });

  it("drops its connections when the recording stops, and offers the share again if another recording starts", async () => {
    const { watcher, calls, peers } = build();
    watcher.setRecording(true);
    watcher.watch(fakeStream().stream);
    await settle();
    watcher.setRecording(false);
    expect(peers[0].closed).toBe(true);
    watcher.setRecording(true);
    await settle();
    expect(calls.filter((c) => c.type === "offer")).toHaveLength(2);
  });

  it("stays quiet about an ended share it never offered", async () => {
    const { watcher, calls } = build();
    const share = fakeStream();
    watcher.watch(share.stream);
    share.stopSharing();
    await settle();
    expect(calls).toHaveLength(0);
  });
});
