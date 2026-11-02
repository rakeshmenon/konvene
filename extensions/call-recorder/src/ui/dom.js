// Small helpers for the extension pages. Text is always set with textContent, never innerHTML,
// because tab titles come from other websites and must never be treated as markup.
import { messageOf } from "../domain/errors.js";
import { CHANNEL } from "../shared/api.js";
import { chromeRuntime } from "../shared/chromeRuntime.js";
import { createCaller } from "../shared/rpc.js";
export const background = createCaller(CHANNEL.background, chromeRuntime);
export function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}
export function show(el, visible) {
  el.hidden = !visible;
}
export function setText(el, text) {
  el.textContent = text;
}
export function showError(el, error) {
  setText(el, messageOf(error));
  show(el, true);
}
export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [k, v] of Object.entries(options.attrs ?? {})) node.setAttribute(k, v);
  if (options.on?.click) node.addEventListener("click", options.on.click);
  for (const child of children) if (child) node.append(child);
  return node;
}

/**
 * @typedef {object} ElOptions
 * @property {string} [class]
 * @property {string} [text]
 * @property {Record<string, string>} [attrs]
 * @property {Partial<Record<"click", (e: Event) => void>>} [on]
 */
