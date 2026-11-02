// Plain data shapes shared by every layer. No behaviour and no browser APIs in this file.
export const DEFAULT_SETTINGS = { noiseReduction: true, folderName: null, setupDone: false };

/**
 * @typedef {"mp4" | "webm"} Container
 */

/**
 * @typedef {object} EncodingProfile
 * @property {string} mimeType
 * @property {Container} container
 * @property {Container} extension
 * @property {number} videoBitsPerSecond
 * @property {number} audioBitsPerSecond
 */

/**
 * "badge": the site can show everyone a recording badge. "recorder-confirms": only the recorder can be told.
 * @typedef {"badge" | "recorder-confirms"} ConsentMode
 */

/**
 * @typedef {object} SiteInfo
 * @property {string} siteId
 * @property {string} siteName
 * @property {string} host
 * @property {string} tabTitle
 * @property {ConsentMode} consent
 */

/**
 * @typedef {"recording" | "saving" | "saved" | "unfinished" | "failed"} RecordingStatus
 */

/**
 * @typedef {{ kind: "downloads"; downloadId: number; path: string } | { kind: "folder"; folderName: string }} SavedLocation
 */

/**
 * @typedef {object} RecordingRecord
 * @property {string} id
 * @property {number} startedAt
 * @property {number} [endedAt]
 * @property {number} [durationMs]
 * @property {number} [sizeBytes]
 * @property {RecordingStatus} status
 * @property {string} [warning] Something the user should know about a saved recording, such as "no sound was recorded".
 * @property {string} siteId
 * @property {string} siteName
 * @property {string} host
 * @property {string} tabTitle
 * @property {number} tabId
 * @property {string} stagingName Name of the file in the private file system while it is being written.
 * @property {string} fileName Name the finished file gets in the output folder.
 * @property {string} mimeType
 * @property {SavedLocation} [location]
 * @property {string} [error]
 */

/**
 * What the recorder hands back when it stops.
 * @typedef {object} CaptureFile
 * @property {string} stagingName
 * @property {number} sizeBytes
 * @property {number} durationMs
 * @property {string} mimeType
 * @property {boolean} soundDetected False when nothing audible was heard from the call or the microphone for the whole recording.
 */

/**
 * How loud each source is right now, from 0 (silent) to 1. Used for the live meters and the safety check.
 * @typedef {object} Levels
 * @property {number} micIn The microphone as it arrives, before any clean-up.
 * @property {number} mic The microphone as it is recorded.
 * @property {number} tab The other people, from the call tab.
 * @property {number} shared Sound from the whole computer (other tabs, other apps), once it has been added. 0 until then.
 * @property {boolean} sharedActive True while the sound of a screen or tab shared in the call is part of the recording.
 * @property {boolean} noiseReductionBypassed True when noise reduction was switched off during this recording because it was removing your voice.
 */

/**
 * @typedef {object} Settings
 * @property {boolean} noiseReduction Remove noise from the microphone. On by default.
 * @property {string | null} folderName Display name of the chosen output folder, or null to use Downloads.
 * @property {boolean} setupDone True once the setup page has run (mic allowed).
 */

/**
 * @typedef {{ phase: "idle" } | { phase: "recording"; recordId: string; startedAt: number; siteName: string; tabTitle: string } | { phase: "saving"; recordId: string }} ActiveStatus
 */
