// The parts of Mediabunny the recorder uses (src/recorder.js). Built as its own file under /vendor
// and loaded only when someone starts recording, so the call page itself stays light.
export {
  Output, Mp4OutputFormat, WebMOutputFormat, StreamTarget, BufferTarget,
  MediaStreamVideoTrackSource, MediaStreamAudioTrackSource, Quality, canEncodeVideo, canEncodeAudio,
  Input, BlobSource, ALL_FORMATS, Conversion,
} from "mediabunny";
