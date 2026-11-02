// Stands in for Chrome's share picker, which a script cannot click: getDisplayMedia hands back a picture and a tone,
// and says what was "shared" through the same `displaySurface` setting a real share reports.
// It must be loaded before the page's share hook, so the hook wraps this instead of the real thing.
const ctx = new AudioContext();
const osc = ctx.createOscillator();
osc.frequency.value = 1000;
const dest = ctx.createMediaStreamDestination();
osc.connect(dest);
osc.start();

const canvas = document.createElement("canvas");
canvas.width = 320;
canvas.height = 180;
canvas.getContext("2d").fillRect(0, 0, 320, 180);

MediaDevices.prototype.getDisplayMedia = async function () {
  void ctx.resume();
  const video = canvas.captureStream(5).getVideoTracks()[0];
  const surface = window.__surface ?? "monitor";
  video.getSettings = () => ({ displaySurface: surface });
  const audio = dest.stream.getAudioTracks()[0].clone();
  window.__fakeShare = { video, audio };
  return new MediaStream([video, audio]);
};

/** The user pressing Chrome's "Stop sharing". */
window.__stopSharing = () => {
  const { video, audio } = window.__fakeShare;
  [video, audio].forEach((t) => {
    t.stop();
    t.dispatchEvent(new Event("ended"));
  });
};
