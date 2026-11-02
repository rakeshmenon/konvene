// A tiny typed request and reply layer over chrome.runtime messaging. It knows nothing about our messages;
// the types come from the API maps in api.js. `RuntimeLike` is the part of chrome.runtime it needs, so tests can fake it.
import { AppError, messageOf } from "../domain/errors.js";
export function createCaller(channel, runtime) {
  return async (type, payload) => {
    const envelope = { channel, type, payload };
    const reply = await runtime.sendMessage(envelope);
    if (!reply) throw new Error(`No answer from ${channel} for ${type}`);
    if (!reply.ok) throw reply.code ? new AppError(reply.code, reply.error) : new Error(reply.error);
    return reply.data;
  };
}
export function serve(channel, handlers, runtime) {
  runtime.onMessage.addListener((message, sender, sendResponse) => {
    const envelope = message;
    // Messages for another channel are not ours: stay silent so the right listener can answer.
    if (!envelope || envelope.channel !== channel) return false;
    const handler = handlers[envelope.type];
    if (!handler) {
      sendResponse({ ok: false, error: `Unknown message ${envelope.type}` });
      return false;
    }
    handler(envelope.payload, { tabId: sender?.tab?.id }).then(
      (data) => sendResponse({ ok: true, data }),
      (e) => sendResponse({ ok: false, error: messageOf(e), code: e instanceof AppError ? e.code : undefined }),
    );
    return true; // the reply is asynchronous
  });
}

/**
 * @typedef {object} RuntimeLike
 * @property {(message: unknown) => Promise<unknown>} sendMessage
 * @property {{ addListener(listener: (message: unknown, sender: unknown, sendResponse: (reply: unknown) => void) => boolean | void): void; }} onMessage
 */

/**
 * Any interface whose every key maps to { req, res }. Written as a mapped type so plain interfaces qualify.
 * @template A
 * @typedef {{ [K in keyof A]: { req: unknown; res: unknown } }} ApiShape
 */

/**
 * @typedef {object} Envelope
 * @property {string} channel
 * @property {string} type
 * @property {unknown} payload
 */

/**
 * @template T
 * @typedef {{ ok: true; data: T } | { ok: false; error: string; code?: ErrorCode }} Reply
 */

/**
 * @template {ApiShape<A>} A
 * @typedef {<K extends keyof A & string>(type: K, payload: A[K]["req"]) => Promise<A[K]["res"]>} Caller
 */

/**
 * @template {ApiShape<A>} A
 * @typedef {{ [K in keyof A]: (payload: A[K]["req"], from: { tabId?: number }) => Promise<A[K]["res"]> }} Handlers
 */
