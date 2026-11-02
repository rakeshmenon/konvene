// Composition root of the recorder engine. This is the only place that knows which real classes are used.
// It runs in the offscreen document, which keeps recording while the popup is closed.
import { selectProfile } from "../domain/codecSelector.js";
import { containerMimeType } from "../domain/fileNamer.js";
import { CHANNEL } from "../shared/api.js";
import { chromeRuntime } from "../shared/chromeRuntime.js";
import { directoryHandleStore } from "../shared/directoryHandleStore.js";
import { createCaller, serve } from "../shared/rpc.js";
import { systemClock } from "../shared/system.js";
import { BrowserCodecProbe } from "./browserCodecProbe.js";
import { ChromeInputOpener } from "./chromeInputOpener.js";
import { DirectoryFolderWriter } from "./folderWriter.js";
import { MediaRecorderEncoder } from "./mediaRecorderEncoder.js";
import { OpfsChunkSink } from "./opfsChunkSink.js";
import { OpfsStagingStore } from "./opfsStagingStore.js";
import { RecordingSession } from "./recordingSession.js";
import { RnnoiseReducer } from "./rnnoiseReducer.js";
import { WebAudioMixBuilder } from "./webAudioMixBuilder.js";
import { WebRtcShareReceiver } from "./webRtcShareReceiver.js";
const probe = new BrowserCodecProbe();
const session = new RecordingSession({
  inputs: new ChromeInputOpener(),
  receiver: new WebRtcShareReceiver(),
  mixer: new WebAudioMixBuilder(new RnnoiseReducer()),
  encoder: new MediaRecorderEncoder(),
  sink: new OpfsChunkSink(() => new Worker(chrome.runtime.getURL("opfsWriter.js"))),
  chooseProfile: () => selectProfile(probe),
  clock: systemClock,
});
const staging = new OpfsStagingStore();
const folder = new DirectoryFolderWriter(directoryHandleStore);
const background = createCaller(CHANNEL.background, chromeRuntime);
function reportEnded(capture, reason, error) {
  background("engine/ended", { capture, reason, error }).catch((e) => console.warn("Could not report the end of the recording", e));
}
serve(
  CHANNEL.offscreen,
  {
    "engine/status": async () => ({ recording: session.recording }),
    "engine/levels": async () => ({ levels: session.levels() }),
    "engine/start": async ({ streamId, stagingName, noiseReduction }) => {
      const profile = await session.start({ streamId, stagingName, noiseReduction }, (end) =>
        reportEnded(end.capture, end.reason, end.error),
      );
      return { mimeType: profile.mimeType, extension: profile.extension };
    },
    "engine/stop": () => session.stop(),
    "engine/share-offer": async (offer) => ({ answer: await session.addShare(offer) }),
    "engine/share-ended": async ({ shareId }) => {
      session.removeShare(shareId);
      return {};
    },
    "engine/export": async ({ stagingName, fileName, mimeType }) => {
      const file = await staging.read(stagingName);
      // A file read from private storage has no type, and Chrome would save it as ".txt". slice() keeps the data on
      // disk (nothing is copied into memory) and lets us say what it is.
      const typed = file.slice(0, file.size, containerMimeType(mimeType));
      return { stagingName, fileName, mimeType, sizeBytes: file.size, blobUrl: URL.createObjectURL(typed) };
    },
    "engine/release": async ({ stagingName, blobUrl, deleteStaging }) => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      if (deleteStaging) await staging.remove(stagingName);
      return {};
    },
    "engine/write-to-folder": async ({ stagingName, fileName }) => folder.write(await staging.read(stagingName), fileName),
  },
  chromeRuntime,
);
