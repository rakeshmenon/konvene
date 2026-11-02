# Call recorder: implementation plan

Where each piece lives, what is done, and what a person still has to check by hand. See [design.md](design.md) for how it fits together.

## Milestones

| # | Milestone | What it covers | Status |
|---|---|---|---|
| 1 | Core recorder | Tab and microphone capture, Web Audio mix, MediaRecorder, codec choice (H.264 or VP9), flushed writes to the private file system, save to Downloads or a chosen folder, library of recordings | Done |
| 2 | Voice quality | RNNoise in an audio worklet, `VoiceGuard` bypass, no double noise suppression, a bitrate that keeps speech clear, silence warning, live level meters | Done |
| 3 | Consent | Konvene shows a named badge and confirms it before recording starts. Other sites ask the recorder to confirm | Done (needs the Konvene change in `src/main.js`) |
| 4 | Store readiness | Setup page (microphone, folder), brand look, icons, listing text, permission reasons, privacy policy, `validate` and `package` scripts | Done. Listing placeholders and a hosted privacy page are left to the publisher |
| 5 | Shared sound | Notice a shared screen or tab in the call page, send its sound to the recorder, mix it in while shared | Done. Tried by hand on real Meet |
| 6 | Upstream | Land the extension in Konvene as `extensions/call-recorder` | This pull request |

## Where things are

| Piece | Files |
|---|---|
| Start, stop, recover, list, remove, accept a share | `src/application/recordingController.js` |
| One recording from start to stop, including shares | `src/recorder/recordingSession.js` |
| Audio mix, RNNoise, soft clip, level meters | `src/recorder/webAudioMixBuilder.js`, `rnnoiseReducer.js`, `src/domain/voiceGuard.js` |
| Codec choice | `src/domain/codecSelector.js`, `src/recorder/browserCodecProbe.js` |
| Writing and saving the file | `src/recorder/opfsChunkSink.js`, `opfsWriter.worker.js`, `src/application/exportService.js`, `outputWriters.js` |
| Site rules and consent | `src/domain/sites/` |
| Shared sound, page side | `src/content/sharePage.js`, `shareWatcher.js`, `rtcSharePeer.js` |
| Shared sound, extension side | `src/content/shareRelay.js`, `src/recorder/webRtcShareReceiver.js`, `src/domain/shareKind.js`, `shareProtocol.js` |
| Messages between parts | `src/shared/api.js` (the whole contract), `rpc.js` |
| Screens | `src/ui/popup.js`, `setup.js`, `library.js` |

## How it is tested

- `npm test`: unit tests for every rule and every use case, with the browser faked (110 tests).
- `npm run smoke`: loads the built extension in real Chromium and checks that the service worker answers, the pages render in the brand fonts, the Konvene bridge confirms or refuses, the real engine records synthetic video and sound to disk, a speech sample survives noise reduction, a share is picked up by the page hook, and the sound of a shared tab or screen is in the file only while it is shared (34 checks). It needs `npm run build:dev` first and Playwright.
- `npm run check`: tests, build and store validation. The Konvene end-to-end test is unaffected.
- `npm run probe:audio` and `npm run quality`: record the same speech several ways and score it (PESQ and STOI), for the next time a recording sounds wrong. `scripts/make-voice-fixture.sh` makes the speech sample.

## Still to check by a person

Chrome only allows these after a real click on the extension or with real hardware, so a script cannot do them:

1. Real tab capture on a long live call, and that the call stays audible to you while recording.
2. Sharing a real screen and a real tab on Meet and Konvene, on macOS and on Windows. The system sound of a whole screen depends on Chrome and the operating system offering it in Meet's own picker.
3. Echo on speakers (browser echo cancellation should keep the other side out of your microphone).
4. The H.264 hardware path and AAC inside MP4, and that a crash still leaves a playable file.
5. A chosen output folder: Chrome may ask to allow it again in a new session. The code falls back to Downloads.
6. A very long recording (an hour) while the service worker saves it.

## Next

- Record to separate tracks per speaker, if ever wanted (the design mixes to one track on purpose).
- Add other call sites by adding an adapter and a match in `src/domain/sites/` and `shareOrigins.json`.
- Publish to the Chrome Web Store (`store/SUBMIT.md` lists the steps).
