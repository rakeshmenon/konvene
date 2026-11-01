// Picture-in-picture: the call in a small window that stays on top of everything else.
//
// - Chrome and Edge (Document Picture-in-Picture): the whole call (everyone's tiles) moves into
//   the window, with mic, camera and leave buttons. Chrome 120+ opens it by itself when you
//   switch to another tab during a call (the browser allows this for pages using the mic or
//   camera) and closes it when you come back.
// - Safari and others: the Pop out button shows the person you're looking at in the browser's
//   standard video picture-in-picture.
//
// Nothing here leaves the device; the window is part of this page.

export const PIP_DOC = typeof window !== "undefined" && "documentPictureInPicture" in window;
export const PIP_VIDEO = typeof document !== "undefined" && !!document.pictureInPictureEnabled;

export class Pip {
  // stage: the element holding the tiles. sprite: the <svg> with the icons.
  // ui: { mic(), cam(), toggleMic(), toggleCam(), leave(), pickVideo(), onChange(open) }
  constructor({ stage, sprite, ui }) {
    this.stage = stage;
    this.sprite = sprite;
    this.ui = ui;
    this.win = null;
    this.holder = null;
    this.buttons = null;
  }

  get open() { return !!this.win || (!!document.pictureInPictureElement); }

  async toggle() { if (this.open) this.close(); else await this.show(); }

  async show() {
    if (this.win) return;
    if (!PIP_DOC) {
      const v = this.ui.pickVideo();
      if (v && PIP_VIDEO) { try { await v.requestPictureInPicture(); } catch { /* not allowed now */ } }
      return;
    }
    let w;
    try { w = await window.documentPictureInPicture.requestWindow({ width: 480, height: 330 }); } catch { return; }
    this.win = w;
    const d = w.document;
    // same styles and icons as the page (the window's own address is about:blank, so use full URLs)
    for (const l of document.querySelectorAll('link[rel="stylesheet"]')) { const c = d.createElement("link"); c.rel = "stylesheet"; c.href = l.href; d.head.append(c); }
    d.title = document.title;
    d.documentElement.lang = document.documentElement.lang;
    d.body.className = "pip-body";
    d.body.dataset.screen = "call";
    d.body.append(this.sprite.cloneNode(true));

    // what the page shows while the call is in the small window
    this.holder = document.createElement("div");
    this.holder.className = "pip-holder";
    const msg = document.createElement("p");
    msg.textContent = "Your call is in the picture-in-picture window.";
    const back = document.createElement("button");
    back.type = "button"; back.className = "btn secondary"; back.textContent = "Bring it back here";
    back.addEventListener("click", () => this.close());
    this.holder.append(msg, back);
    this.stage.before(this.holder);

    const wrap = d.createElement("div");
    wrap.className = "pip-wrap";
    wrap.append(this.stage);
    wrap.append(this.dock(d));
    d.body.append(wrap);
    this.replay();
    this.sync();
    w.addEventListener("pagehide", () => this.restore(), { once: true });
    this.ui.onChange(true);
  }

  close() {
    if (this.win) { this.win.close(); return; } // pagehide puts everything back
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  }

  restore() {
    if (this.holder) { this.holder.replaceWith(this.stage); this.holder = null; }
    this.win = null;
    this.buttons = null;
    this.replay();
    this.ui.onChange(false);
  }

  // videos pause when they move between windows
  replay() { for (const v of this.stage.querySelectorAll("video")) v.play().catch(() => {}); }

  dock(d) {
    const icon = (id) => { const s = d.createElementNS("http://www.w3.org/2000/svg", "svg"); const u = d.createElementNS("http://www.w3.org/2000/svg", "use"); u.setAttribute("href", "#" + id); s.append(u); s.setAttribute("aria-hidden", "true"); return s; };
    const btn = (cls, label, ic, fn) => { const b = d.createElement("button"); b.type = "button"; b.className = cls; b.setAttribute("aria-label", label); b.title = label; b.append(icon(ic)); b.addEventListener("click", fn); return b; };
    const bar = d.createElement("div");
    bar.className = "pip-dock";
    const mic = btn("round", "Microphone", "i-mic", () => this.ui.toggleMic());
    const cam = btn("round", "Camera", "i-cam", () => this.ui.toggleCam());
    const leave = btn("leave", "Leave call", "i-leave", () => ask());
    const confirm = d.createElement("div");
    confirm.className = "pip-confirm";
    confirm.hidden = true;
    const q = d.createElement("p"); q.textContent = "Leave the call?";
    const stay = d.createElement("button"); stay.type = "button"; stay.className = "btn secondary small"; stay.textContent = "Stay";
    const go = d.createElement("button"); go.type = "button"; go.className = "btn danger small"; go.textContent = "Leave";
    confirm.append(q, stay, go);
    const ask = () => { confirm.hidden = false; controls.hidden = true; stay.focus(); };
    stay.addEventListener("click", () => { confirm.hidden = true; controls.hidden = false; });
    go.addEventListener("click", () => this.ui.leave());
    const controls = d.createElement("div");
    controls.className = "pip-controls";
    controls.append(mic, cam, leave);
    bar.append(controls, confirm);
    this.buttons = { mic, cam };
    return bar;
  }

  // mirror the mic and camera state on the small window's buttons
  sync() {
    if (!this.buttons) return;
    for (const [k, on] of [["mic", this.ui.mic()], ["cam", this.ui.cam()]]) {
      const b = this.buttons[k];
      b.classList.toggle("off", !on);
      b.setAttribute("aria-pressed", String(on));
      b.querySelector("use").setAttribute("href", `#i-${k}${on ? "" : "-off"}`);
    }
  }
}
