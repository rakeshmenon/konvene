import { waitForIceGathering } from "../shared/iceComplete.js";

/**
 * The recorder's end of the connection from the call page. It answers the page's offer and hands back the sound
 * that arrives. Everything stays inside this browser: no servers, nothing leaves the computer.
 */
export class WebRtcShareReceiver {
  PeerConnection;
  constructor(PeerConnection = RTCPeerConnection) {
    this.PeerConnection = PeerConnection;
  }

  async accept(offer) {
    const pc = new this.PeerConnection({ iceServers: [] });
    const streams = [];
    pc.addEventListener("track", (e) => streams.push(e.streams[0] ?? new MediaStream([e.track])));
    await pc.setRemoteDescription({ type: "offer", sdp: offer });
    const stream = streams[0];
    if (!stream) {
      pc.close();
      throw new Error("The share carried no sound.");
    }
    // Chrome only delivers the sound of a connection to Web Audio while some media element is also playing it.
    const keepAlive = new Audio();
    keepAlive.muted = true;
    keepAlive.srcObject = stream;
    void keepAlive.play().catch(() => {});
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIceGathering(pc);
    let close = () => {};
    return {
      answer: pc.localDescription.sdp,
      audio: stream,
      onClosed: (callback) => {
        let called = false;
        const once = () => {
          if (called) return;
          called = true;
          callback();
        };
        close = once;
        pc.addEventListener("connectionstatechange", () => {
          if (["failed", "closed", "disconnected"].includes(pc.connectionState)) once();
        });
        stream.addEventListener("removetrack", once);
      },
      close: () => {
        keepAlive.srcObject = null;
        pc.close();
        close();
      },
    };
  }
}
