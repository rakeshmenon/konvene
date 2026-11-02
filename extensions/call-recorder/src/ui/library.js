import { formatBytes, formatDuration } from "../shared/format.js";
import { background, byId, el, setText, show, showError } from "./dom.js";
const list = byId("list");
const empty = byId("empty");
const errorBox = byId("error");
const STATUS = {
  recording: { label: "Recording", kind: "warn" },
  saving: { label: "Saving", kind: "warn" },
  saved: { label: "Saved", kind: "ok" },
  unfinished: { label: "Not saved yet", kind: "warn" },
  failed: { label: "Failed", kind: "err" },
};
function whereText(r) {
  if (r.status !== "saved" || !r.location) return null;
  return r.location.kind === "folder" ? `Folder: ${r.location.folderName}` : r.location.path;
}
function button(label, onClick, extra = "") {
  return el("button", {
    class: `btn small ${extra}`.trim(),
    text: label,
    on: {
      click: () => {
        show(errorBox, false);
        void onClick()
          .catch((e) => showError(errorBox, e))
          .finally(load);
      },
    },
  });
}
function card(r) {
  const status = STATUS[r.status];
  const live = r.status === "recording" || r.status === "saving";
  const where = whereText(r);
  const actions = [];
  if (r.status === "unfinished" || r.status === "failed") {
    actions.push(button("Save now", () => background("recording/recover", { recordId: r.id }).then(() => {}), "primary"));
  }
  if (r.status === "saved" && r.location?.kind === "downloads") {
    actions.push(button("Show in folder", () => background("recording/reveal", { recordId: r.id }).then(() => {})));
    actions.push(
      button("Delete file", () => background("recording/remove", { recordId: r.id, deleteFile: true }).then(() => {}), "danger"),
    );
  }
  if (!live && !(r.status === "saved" && r.location?.kind === "downloads")) {
    actions.push(
      button("Remove from list", () => background("recording/remove", { recordId: r.id, deleteFile: false }).then(() => {}), "danger"),
    );
  }
  return el("article", { class: "card rec-item" }, [
    el("div", { class: "row spread" }, [
      el("div", { class: "title clip", text: r.tabTitle || r.siteName }),
      el("span", { class: `chip ${status.kind}`.trim(), text: status.label }),
    ]),
    el("div", { class: "meta" }, [
      el("span", { text: r.siteName }),
      el("span", { text: new Date(r.startedAt).toLocaleString() }),
      r.durationMs !== undefined ? el("span", { text: formatDuration(r.durationMs) }) : null,
      r.sizeBytes !== undefined ? el("span", { text: formatBytes(r.sizeBytes) }) : null,
    ]),
    where ? el("div", { class: "faint clip", text: where, attrs: { title: where } }) : null,
    r.warning ? el("p", { class: "notice warn", text: r.warning }) : null,
    r.error && r.status !== "saved" ? el("p", { class: "notice err", text: r.error }) : null,
    actions.length ? el("div", { class: "row" }, actions) : null,
  ]);
}
let poll;
async function load() {
  clearTimeout(poll);
  try {
    const records = await background("recording/list", {});
    list.replaceChildren(...records.map(card));
    show(empty, records.length === 0);
    // While something is recording or saving the page keeps itself fresh.
    if (records.some((r) => r.status === "recording" || r.status === "saving")) poll = setTimeout(() => void load(), 2000);
  } catch (e) {
    showError(errorBox, e);
  }
}
setText(byId("empty"), "No recordings yet. Open a call tab, click the extension icon and press Start.");
void load();
