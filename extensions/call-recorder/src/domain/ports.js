/**
 * @typedef {object} Clock
 * @property {() => number} now
 */

/**
 * @typedef {object} IdSource
 * @property {() => string} next
 */

/**
 * @typedef {object} KeyValueStore
 * @property {<T>(key: string) => Promise<T | undefined>} get
 * @property {<T>(key: string, value: T) => Promise<void>} set
 */

/**
 * @typedef {object} RecordingRepository
 * @property {() => Promise<RecordingRecord[]>} all
 * @property {(id: string) => Promise<RecordingRecord | undefined>} get
 * @property {(record: RecordingRecord) => Promise<void>} save
 * @property {(id: string) => Promise<void>} remove
 */

/**
 * @typedef {object} SettingsStore
 * @property {() => Promise<Settings>} read
 * @property {(patch: Partial<Settings>) => Promise<Settings>} write
 */

/**
 * What the browser tab gives us.
 * @typedef {object} TabGateway
 * @property {(tabId: number) => Promise<{ url: string; title: string }>} describe
 * @property {(tabId: number) => Promise<string>} captureStreamId
 * @property {(tabId: number, message: unknown) => Promise<unknown>} send Sends a message to the page's content script and returns its answer, if it gave one.
 */

/**
 * The part of a tab that site adapters may use.
 * @typedef {Pick<TabGateway, "send">} TabMessenger
 */

/**
 * A finished recording sitting in private storage, ready to be copied out.
 * @typedef {object} ExportedFile
 * @property {string} stagingName
 * @property {string} fileName
 * @property {string} mimeType
 * @property {number} sizeBytes
 * @property {string} blobUrl Object URL for the file. Only valid until released.
 */

/**
 * @typedef {object} OutputWriter
 * @property {(file: ExportedFile) => Promise<SavedLocation>} write
 */

/**
 * Actions on a recording after it has been saved.
 * @typedef {object} SavedFileGateway
 * @property {(location: SavedLocation) => Promise<void>} reveal
 * @property {(location: SavedLocation) => Promise<void>} remove
 */

/**
 * @typedef {object} EngineStartRequest
 * @property {string} streamId
 * @property {string} stagingName
 * @property {string} recordId
 * @property {boolean} noiseReduction
 */

/**
 * The recorder engine, which runs in the offscreen document.
 * @typedef {object} RecorderGateway
 * @property {() => Promise<boolean>} isRecording
 * @property {() => Promise<Levels | null>} levels Current loudness of each source, or null when nothing is recording.
 * @property {(req: EngineStartRequest) => Promise<{ mimeType: string; extension: string }>} start
 * @property {() => Promise<CaptureFile>} stop
 * @property {(offer: import("./shareProtocol.js").ShareOffer) => Promise<string>} shareOffer Adds the sound of a share the call page offers. Returns the answer for the page.
 * @property {(shareId: string) => Promise<void>} shareEnded
 * @property {(stagingName: string, fileName: string, mimeType: string) => Promise<ExportedFile>} exportFile Makes a staged file readable by URL.
 * @property {(file: { stagingName: string; blobUrl?: string }, deleteStaging: boolean) => Promise<void>} release Frees the URL, and deletes the staged file when it has been saved.
 * @property {(stagingName: string, fileName: string) => Promise<{ folderName: string }>} writeToFolder
 */

export {};
