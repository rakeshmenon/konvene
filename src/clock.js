// One clock for everything that draws: the video you send, your own tiles and the recording.
//
// While this tab is visible it follows the screen (requestAnimationFrame). When the tab is in the
// background, Chrome stops animation frames and slows the page's own timers to about once a
// second (unless the tab happens to be making sound), so your video would reach the others at one
// frame a second and a recording would freeze. Timers inside a worker aren't slowed like that, so
// in the background a tiny worker sends the beat instead. That's also what keeps the picture-in-
// picture window moving, since it belongs to this (hidden) tab.
//
// The worker is built here from a few lines of text, so there's no extra file to host. If a site
// blocks workers, the page's own timer is used (slower in the background, but never broken).

const BG_MS = 50; // background beat: 20 a second, enough for 15 fps video and smooth rings

const subs = new Set();
let started = false;
let worker = null;
let fallback = 0;

function beat(now) {
  for (const fn of subs) {
    try { fn(now); } catch (e) { console.error(e); }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!document.hidden) beat(now);
}

// The worker waits, sends one beat, and waits again only after this page has drawn it, so a slow
// computer gets fewer frames instead of a growing queue of them.
function background() {
  if (!document.hidden) return;
  beat(performance.now());
  if (worker) worker.postMessage(BG_MS);
}

function startWorker() {
  try {
    const src = `let t = 0; onmessage = (e) => { clearTimeout(t); if (e.data > 0) t = setTimeout(() => postMessage(0), e.data); };`;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = background;
    worker.onerror = () => { worker = null; useFallback(); };
  } catch {
    worker = null;
  }
}

function useFallback() {
  if (!fallback) fallback = setInterval(() => { if (document.hidden) beat(performance.now()); }, BG_MS);
}

function onVisibility() {
  // only beat from the worker while hidden: no point waking the page twice per frame
  if (worker) worker.postMessage(document.hidden ? BG_MS : 0);
}

function start() {
  if (started) return;
  started = true;
  requestAnimationFrame(frame);
  startWorker();
  if (!worker) useFallback();
  document.addEventListener("visibilitychange", onVisibility);
  onVisibility();
}

// fn(now) runs on every beat, in this tab or the background. Returns a function that stops it.
export function onBeat(fn) {
  subs.add(fn);
  start();
  return () => subs.delete(fn);
}
