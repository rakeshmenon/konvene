// How a call page (Meet, Konvene) hands the sound of a screen or tab share to the recorder.
// Three hops, each with its own small message set, all named here so no hop invents its own:
//
//   page (main world) ──postMessage──► relay (content script) ──runtime message──► service worker ──► recorder
//
// The page asks Chrome for the share, so only the page can see it. It sends a WebRTC offer carrying a copy of the
// shared sound. The recorder answers, and the sound then flows straight into the recording on this computer.

/** Page to relay (window.postMessage). */
export const SHARE_PAGE_SOURCE = "call-recorder-share-page";
/** Relay to page. */
export const SHARE_RELAY_SOURCE = "call-recorder-share-relay";
/** Service worker to relay (chrome.tabs.sendMessage): a recording started or stopped in this tab. */
export const RECORDING_STATE_MESSAGE = "call-recorder/recording-state";

/**
 * @typedef {object} ShareOffer
 * @property {string} shareId
 * @property {import("./shareKind.js").ShareKind} kind What the user shared.
 * @property {string} offer The WebRTC offer (SDP) that carries a copy of the shared sound.
 */

/**
 * A request from the page. The relay forwards it and posts the reply back with the same `id`.
 * @typedef {{ source: typeof SHARE_PAGE_SOURCE; id: number; type: "offer"; payload: ShareOffer } | { source: typeof SHARE_PAGE_SOURCE; id: number; type: "ended"; payload: { shareId: string } }} PageRequest
 */

/**
 * @typedef {object} RelayReply
 * @property {typeof SHARE_RELAY_SOURCE} source
 * @property {number} id
 * @property {{ answer: string | null }} reply `answer` is null when this share is not being recorded.
 */

/**
 * Relay to page: a recording started (`true`) or stopped (`false`) in this tab.
 * @typedef {object} RelayRecordingState
 * @property {typeof SHARE_RELAY_SOURCE} source
 * @property {boolean} recording
 */
