import { shareKindOf } from "../domain/shareKind.js";

/**
 * Follows the screens and tabs the call page shares, and offers the sound of each one to the recorder while a
 * recording is running. It knows nothing about Chrome or WebRTC: how to send a request and how to build a
 * peer are handed in, so the rules (when to offer, when to stop) can be tested on their own.
 */
export class ShareWatcher {
  d;
  recording = false;
  shares = new Map();
  nextId = 1;

  /** @param {{ request: (type: "offer" | "ended", payload: object) => Promise<{ answer?: string | null }>, createPeer: (tracks: MediaStreamTrack[]) => SharePeer }} deps */
  constructor(deps) {
    this.d = deps;
  }

  /** Called with every stream the page got from getDisplayMedia. */
  watch(stream) {
    const tracks = stream.getAudioTracks();
    // A share without sound has nothing to record.
    if (!tracks.length) return;
    const kind = shareKindOf(stream.getVideoTracks()[0]?.getSettings?.().displaySurface);
    const share = { id: `share-${this.nextId++}`, kind, tracks, peer: null };
    this.shares.set(share.id, share);
    // The page stops sharing by stopping the tracks, or the user presses Chrome's "Stop sharing".
    tracks[0].addEventListener("ended", () => this.finish(share), { once: true });
    if (this.recording) void this.offer(share);
  }

  /** The recording started or stopped in this tab. A share that was already running is offered at once. */
  setRecording(on) {
    if (this.recording === on) return;
    this.recording = on;
    for (const share of this.shares.values()) {
      if (on) void this.offer(share);
      else this.drop(share);
    }
  }

  async offer(share) {
    if (share.peer) return;
    const peer = this.d.createPeer(share.tracks);
    share.peer = peer;
    try {
      const offer = await peer.createOffer();
      const { answer } = await this.d.request("offer", { shareId: share.id, kind: share.kind, offer });
      // The share may have ended, or the recording stopped, while the offer was on its way.
      if (!answer || share.peer !== peer) return this.drop(share, peer);
      await peer.accept(answer);
    } catch {
      this.drop(share, peer);
    }
  }

  drop(share, peer = share.peer) {
    peer?.close();
    if (share.peer === peer) share.peer = null;
  }

  finish(share) {
    if (!this.shares.delete(share.id)) return;
    const hadPeer = Boolean(share.peer);
    this.drop(share);
    if (hadPeer) void this.d.request("ended", { shareId: share.id }).catch(() => {});
  }
}

/**
 * @typedef {object} SharePeer
 * @property {() => Promise<string>} createOffer Resolves with the finished offer (SDP).
 * @property {(answer: string) => Promise<void>} accept
 * @property {() => void} close
 */
