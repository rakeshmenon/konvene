export const CHANNEL = { background: "background", offscreen: "offscreen" };

/**
 * @template Req
 * @template Res
 * @typedef {object} Call
 * @property {Req} req
 * @property {Res} res
 */

/**
 * @typedef {Record<string, never>} None
 */

/**
 * @typedef {object} EngineEndedEvent
 * @property {CaptureFile} capture
 * @property {"tab-closed" | "error"} reason
 * @property {string} [error]
 */

/**
 * Messages the service worker answers. Sent by the popup, the library page and the offscreen engine.
 * @typedef {object} BackgroundApi
 * @property {Call<{ tabId: number }, SiteInfo>} site/describe
 * @property {Call<{ tabId: number; consentConfirmed: boolean }, { recordId: string }>} recording/start
 * @property {Call<None, { recordId: string }>} recording/stop
 * @property {Call<None, ActiveStatus>} recording/status
 * @property {Call<None, { levels: Levels | null }>} recording/levels
 * @property {Call<None, RecordingRecord[]>} recording/list
 * @property {Call<{ recordId: string }, None>} recording/recover
 * @property {Call<{ recordId: string; deleteFile: boolean }, None>} recording/remove
 * @property {Call<{ recordId: string }, None>} recording/reveal
 * @property {Call<ShareOffer, { answer: string | null }>} share/offer
 * @property {Call<{ shareId: string }, None>} share/ended
 * @property {Call<EngineEndedEvent, None>} engine/ended
 */

/**
 * Messages the offscreen engine answers. Sent by the service worker only.
 * @typedef {object} OffscreenApi
 * @property {Call<None, { recording: boolean }>} engine/status
 * @property {Call<None, { levels: Levels | null }>} engine/levels
 * @property {Call<EngineStartRequest, { mimeType: string; extension: string }>} engine/start
 * @property {Call<None, CaptureFile>} engine/stop
 * @property {Call<ShareOffer, { answer: string }>} engine/share-offer
 * @property {Call<{ shareId: string }, None>} engine/share-ended
 * @property {Call<{ stagingName: string; fileName: string; mimeType: string }, ExportedFile>} engine/export
 * @property {Call<{ stagingName: string; blobUrl?: string; deleteStaging: boolean }, None>} engine/release
 * @property {Call<{ stagingName: string; fileName: string }, { folderName: string }>} engine/write-to-folder
 */
