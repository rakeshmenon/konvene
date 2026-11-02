// Runs the REAL recording engine in a real browser with synthetic inputs, to prove the pieces work together:
// codec choice, Web Audio mix with RNNoise, MediaRecorder, the OPFS writer worker and reading the file back.
// Only tab capture and the real microphone are replaced, because they need a person to click the extension.
// scripts/smoke.mjs builds this file into a copy of the extension and drives it with Playwright.
import { selectProfile } from "../../src/domain/codecSelector.js";
import { BrowserCodecProbe } from "../../src/recorder/browserCodecProbe.js";
import { openMicrophone } from "../../src/recorder/chromeInputOpener.js";
import { MediaRecorderEncoder } from "../../src/recorder/mediaRecorderEncoder.js";
import { OpfsChunkSink } from "../../src/recorder/opfsChunkSink.js";
import { OpfsStagingStore } from "../../src/recorder/opfsStagingStore.js";
import { RecordingSession } from "../../src/recorder/recordingSession.js";
import { RnnoiseReducer } from "../../src/recorder/rnnoiseReducer.js";
import { WebRtcShareReceiver } from "../../src/recorder/webRtcShareReceiver.js";
import { WebAudioMixBuilder } from "../../src/recorder/webAudioMixBuilder.js";
import { systemClock } from "../../src/shared/system.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Options come from the page address, so scripts/audio-probe.mjs can try variants of the same run:
//   mic=real   use getUserMedia exactly like the extension does (the browser can feed it a speech file)
//   tab=silent the "call tab" carries no sound, so only the microphone can be heard
//   noise=off  skip RNNoise
//   profile=<mime> force a container and codec instead of letting the codec choice decide
//   seconds=<n> how long to record
const options = new URLSearchParams(location.search);
const MIC = options.get("mic") ?? "tone";
const TAB = options.get("tab") ?? "tone";
const NOISE = options.get("noise") ?? "on";
const FORCED_PROFILE = options.get("profile");
const SECONDS = Number(options.get("seconds") ?? 5);
const BNS = options.get("bns"); // force the browser's own noise suppression on or off (default: as the extension does it)
const BITRATE = Number(options.get("bitrate") ?? 32_000); // audio bits per second
const DUMP = options.get("dump") === "1"; // hand the recorded file back, so a script can analyse it with ffmpeg
/** A moving picture and a tone for the "tab", and a different tone for the "microphone". */
function syntheticInputs() {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const g = canvas.getContext("2d");
  let frame = 0;
  const painter = setInterval(() => {
    g.fillStyle = "#10261f";
    g.fillRect(0, 0, 640, 360);
    g.fillStyle = "#e0a93c";
    g.fillRect((frame * 8) % 600, 150, 40, 60);
    frame++;
  }, 50);
  const video = canvas.captureStream(15);
  const ctx = new AudioContext();
  const tone = (hz) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = hz;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    return { stream: dest.stream, osc };
  };
  const tabTone = tone(440);
  const micTone = tone(220);
  if (TAB === "silent") {
    const mute = ctx.createGain();
    mute.gain.value = 0;
    // the oscillator keeps running but nothing audible reaches the "tab" stream
    tabTone.osc.disconnect();
    tabTone.osc.connect(mute).connect(ctx.createMediaStreamDestination());
    const silent = ctx.createMediaStreamDestination();
    const quiet = ctx.createConstantSource();
    quiet.offset.value = 0;
    quiet.connect(silent);
    quiet.start();
    tabTone.stream = silent.stream;
  }
  const opener = {
    async open(_streamId, inputOptions) {
      const tab = new MediaStream([...video.getVideoTracks(), ...tabTone.stream.getAudioTracks()]);
      // the same request ChromeInputOpener makes for the microphone
      const mic =
        MIC === "real"
          ? await openMicrophone(navigator.mediaDevices, {
              browserNoiseSuppression: BNS ? BNS !== "off" : inputOptions.browserNoiseSuppression,
            })
          : micTone.stream;
      return { tab, mic, onTabEnded: () => {}, close: () => {} };
    },
  };
  return {
    opener,
    stop: () => {
      clearInterval(painter);
      tabTone.osc.stop();
      micTone.osc.stop();
      void ctx.close();
    },
  };
}
function forcedProfile(mimeType) {
  const container = mimeType.includes("mp4") ? "mp4" : "webm";
  return { mimeType, container, extension: container, videoBitsPerSecond: 800_000, audioBitsPerSecond: BITRATE };
}
async function run() {
  const probe = new BrowserCodecProbe();
  const supported = Object.fromEntries(
    ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1,opus", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus"].map(
      (m) => [m, probe.isTypeSupported(m)],
    ),
  );
  const hardwareH264 = await probe.hasHardwareH264();
  const { opener, stop } = syntheticInputs();
  const session = new RecordingSession({
    inputs: opener,
    receiver: new WebRtcShareReceiver(),
    mixer: new WebAudioMixBuilder(new RnnoiseReducer()),
    encoder: new MediaRecorderEncoder(),
    sink: new OpfsChunkSink(() => new Worker(chrome.runtime.getURL("opfsWriter.js"))),
    chooseProfile: () => (FORCED_PROFILE ? Promise.resolve(forcedProfile(FORCED_PROFILE)) : selectProfile(probe)),
    clock: systemClock,
  });
  const name = `harness-${Date.now()}`;
  const profile = await session.start({ streamId: "synthetic", stagingName: name, noiseReduction: NOISE !== "off" }, () => {});
  // A test page can offer shares to this recording, as the call page does through the extension.
  window.__share = { offer: (offer) => session.addShare(offer), end: (shareId) => session.removeShare(shareId) };
  // Watch the levels while recording, once a second, so a source that goes quiet is visible afterwards.
  const levelTrace = [];
  const seconds = Math.max(2, SECONDS);
  let midSize = 0;
  for (let t = 0; t < seconds; t++) {
    await sleep(1000);
    const l = session.levels();
    if (l)
      levelTrace.push({
        micIn: Number(l.micIn.toFixed(3)),
        mic: Number(l.mic.toFixed(3)),
        tab: Number(l.tab.toFixed(3)),
        bypassed: l.noiseReductionBypassed,
      });
    if (t === 1) midSize = (await new OpfsStagingStore().read(name)).size; // readable while still recording
  }
  const capture = await session.stop();
  const staging = new OpfsStagingStore();
  const file = await staging.read(name);
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.src = url;
  const meta = await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => reject(new Error("The recorded file cannot be played."));
    setTimeout(() => reject(new Error("Timed out loading the recorded file.")), 10_000);
  });
  // does the file really hold sound? decode it and look at the loudest sample
  const decoded = await new AudioContext().decodeAudioData(await file.arrayBuffer());
  let peak = 0;
  for (const v of decoded.getChannelData(0).subarray(0, 48_000 * 3)) peak = Math.max(peak, Math.abs(v));
  // loudness for every second, so a recording that is silent for part of the time shows up
  const data = decoded.getChannelData(0);
  const rmsPerSecond = [];
  for (let start = 0; start + decoded.sampleRate <= data.length; start += decoded.sampleRate) {
    let sum = 0;
    for (let i = start; i < start + decoded.sampleRate; i++) sum += (data[i] ?? 0) ** 2;
    rmsPerSecond.push(Number(Math.sqrt(sum / decoded.sampleRate).toFixed(4)));
  }
  // How much of each tone is in each second of the file (Goertzel), to see what was really mixed in.
  const toneAt = (hz) => {
    const per = [];
    const w = (2 * Math.PI * hz) / decoded.sampleRate;
    for (let start = 0; start + decoded.sampleRate <= data.length; start += decoded.sampleRate) {
      let re = 0,
        im = 0;
      for (let i = 0; i < decoded.sampleRate; i++) {
        const v = data[start + i] ?? 0;
        re += v * Math.cos(w * i);
        im += v * Math.sin(w * i);
      }
      per.push(Number(((2 * Math.hypot(re, im)) / decoded.sampleRate).toFixed(4)));
    }
    return per;
  };
  const callTonePerSecond = toneAt(440);
  const sharedTonePerSecond = toneAt(1000);
  let fileBase64;
  if (DUMP) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    fileBase64 = btoa(binary);
  }
  await staging.remove(name);
  stop();
  return {
    fileBase64,
    profile: profile.mimeType,
    supported,
    hardwareH264,
    capture,
    levelTrace,
    midSize,
    fileSize: file.size,
    ...meta,
    rmsPerSecond,
    callTonePerSecond,
    sharedTonePerSecond,
    audioChannels: decoded.numberOfChannels,
    audioSeconds: Number(decoded.duration.toFixed(1)),
    audioPeak: Number(peak.toFixed(3)),
  };
}
const out = document.getElementById("out");
run().then(
  (r) => {
    window.__result = r;
    if (out) out.textContent = JSON.stringify(r, null, 2);
  },
  (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    window.__error = msg;
    if (out) out.textContent = `ERROR: ${msg}`;
  },
);
