/**
 * Resolves once the connection has found all its local addresses, or after a short wait.
 * Both ends do this before sending their description, so one request and one answer carry everything and no
 * candidates need passing back and forth. Both ends are on the same computer, so it is quick.
 * @param {RTCPeerConnection} pc
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export function waitForIceGathering(pc, timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}
