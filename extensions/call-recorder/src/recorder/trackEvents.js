/**
 * Calls back once, the first time any of the tracks ends (a closed tab, or the user pressing Chrome's "Stop sharing").
 * One place for the "only once" rule, so no opener writes it again.
 * @param {MediaStreamTrack[]} tracks
 * @param {() => void} callback
 */
export function onAnyTrackEnded(tracks, callback) {
  let called = false;
  const once = () => {
    if (called) return;
    called = true;
    callback();
  };
  tracks.forEach((t) => t.addEventListener("ended", once, { once: true }));
}
