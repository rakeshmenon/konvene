/**
 * The captured tab plus the microphone.
 * @typedef {object} CallInputs
 * @property {MediaStream} tab Video and audio of the call tab.
 * @property {MediaStream} mic
 * @property {(callback: () => void) => void} onTabEnded Calls back once when the tab stops sharing, for example because it was closed.
 * @property {() => void} close
 */

/**
 * @typedef {object} InputOptions
 * @property {boolean} browserNoiseSuppression Whether the browser should also suppress noise on the microphone. Off while RNNoise does it, because two noise suppressors in a row make speech warble and score worse than either one alone.
 */

/**
 * @typedef {object} InputOpener
 * @property {(streamId: string, options: InputOptions) => Promise<CallInputs>} open
 */

/**
 * Takes the sound of a share the call page offers, while the recording runs.
 * @typedef {object} ShareReceiver
 * @property {(offer: string) => Promise<AcceptedShare>} accept
 */

/**
 * @typedef {object} AcceptedShare
 * @property {string} answer The reply to send back to the page.
 * @property {MediaStream} audio The shared sound.
 * @property {(callback: () => void) => void} onClosed Calls back once when the connection ends, for example when the page stops sharing.
 * @property {() => void} close
 */

/**
 * The stream to record: tab video plus one mixed audio track.
 * @typedef {object} MixedStream
 * @property {MediaStream} stream
 * @property {() => Levels} levels How loud each source is right now.
 * @property {(audio: MediaStream, plan: SoundPlan) => () => void} addSource Mixes in another stream while recording, as the plan says. Returns a function that takes it out again.
 * @property {() => void} dispose
 */

/**
 * @typedef {object} MixOptions
 * @property {boolean} noiseReduction
 */

/**
 * @typedef {object} MixBuilder
 * @property {(inputs: CallInputs, options: MixOptions) => Promise<MixedStream>} build
 */

/**
 * @typedef {object} Encoder
 * @property {(stream: MediaStream, profile: EncodingProfile, onChunk: (chunk: Blob) => void, onFail: (error: Error) => void) => void} start
 * @property {() => Promise<void>} stop Resolves after the last chunk has been delivered.
 */

/**
 * Appends chunks to a file as they arrive and keeps them on disk.
 * @typedef {object} ChunkSink
 * @property {(stagingName: string) => Promise<void>} open
 * @property {(chunk: Blob) => Promise<void>} append
 * @property {() => Promise<number>} close Returns the final size in bytes.
 */

/**
 * Turns a mic into a cleaner mic. Returns null when it is not available, and the mic is used as it is.
 * @typedef {object} NoiseReducer
 * @property {(context: AudioContext) => Promise<{ node: AudioNode; dispose(): void } | null>} create
 */

/**
 * Files in the browser's private file system.
 * @typedef {object} StagingStore
 * @property {(stagingName: string) => Promise<File>} read
 * @property {(stagingName: string) => Promise<void>} remove
 */

/**
 * Writes a staged file into the folder the user chose.
 * @typedef {object} FolderWriter
 * @property {(file: File, fileName: string) => Promise<{ folderName: string }>} write
 */

export {};
