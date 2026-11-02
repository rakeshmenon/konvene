// The two small messages that carry "recording started or stopped" from the extension to the Konvene page.
// Shared by the service worker, the content script and the Konvene patch, so the names live in one place.
/** Service worker to content script (chrome.tabs.sendMessage). */
export const KONVENE_TAB_MESSAGE = "konvene-recorder/recording-state";
/** Content script to the page (window.postMessage). The page checks this exact value. */
export const KONVENE_PAGE_SOURCE = "konvene-recorder-extension";
/** The page answers the content script with this source once its badge is on screen, so recording never starts unseen. */
export const KONVENE_PAGE_ACK_SOURCE = "konvene-page";

/**
 * What the content script tells the service worker. `shown` is true only when the page confirmed.
 * @typedef {object} KonveneTabReply
 * @property {boolean} shown
 */

/**
 * @typedef {object} KonvenePageAck
 * @property {typeof KONVENE_PAGE_ACK_SOURCE} source
 * @property {boolean} recording
 */

/**
 * @typedef {object} KonveneTabMessage
 * @property {typeof KONVENE_TAB_MESSAGE} type
 * @property {boolean} recording
 */

/**
 * @typedef {object} KonvenePageMessage
 * @property {typeof KONVENE_PAGE_SOURCE} source
 * @property {boolean} recording
 */
