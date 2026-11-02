import { waitForIceGathering } from "../shared/iceComplete.js";

/**
 * The page's end of the connection to the recorder. It sends a copy of the shared sound and nothing else.
 * No servers are involved: both ends are in this browser, on this computer.
 * @param {MediaStreamTrack[]} tracks The sound tracks of the share. Copies are sent, so the call itself is untouched.
 * @param {typeof RTCPeerConnection} [PeerConnection] The page's own constructor, taken before the page could replace it.
 * @returns {import("./shareWatcher.js").SharePeer}
 */
export function createRtcSharePeer(tracks, PeerConnection = RTCPeerConnection) {
  const pc = new PeerConnection({ iceServers: [] });
  const copies = tracks.map((t) => t.clone());
  const stream = new MediaStream(copies);
  copies.forEach((t) => pc.addTrack(t, stream));
  return {
    async createOffer() {
      await pc.setLocalDescription(await pc.createOffer());
      await waitForIceGathering(pc);
      return pc.localDescription.sdp;
    },
    accept: (answer) => pc.setRemoteDescription({ type: "answer", sdp: answer }),
    close: () => {
      copies.forEach((t) => t.stop());
      pc.close();
    },
  };
}
