# How Konvene works

Konvene is a static web app. A host serves files; the browsers in a call do everything else.

```
camera ─► vision.js (MediaPipe on the device: face landmarks, person mask)
       ─► matte.js (cleans the mask on the CPU)
       ─► fx.js (WebGL2: cutout edges, background, face, light, looks)
       ─► pipeline.js draws the result on a canvas ─► canvas.captureStream()
       ─► net.js: WebRTC to each person (mesh), via Trystero
```

## Modules (`src/`)

| File | What it does |
|---|---|
| `main.js` | Home page, pre-join page (preview, devices, effects, name), call screen, tiles, spotlight and pinning, chat, people, device menus and pickers, effects drawer with live previews, recording flow, shortcuts |
| `pipeline.js` | Your outgoing video: camera, vision, effects, overlays, the "stepped away" card, keep-in-frame zoom, low-light gain, and the microphone track |
| `fx.js` | WebGL2 shaders: guided-filter edge refinement, mask-weighted background blur, virtual backgrounds, lighting, looks, and the face effects |
| `face.js` | Face geometry from the 478 landmarks: smoothing, eye/mouth/cheek positions, and a soft skin/lips/mouth mask |
| `matte.js` | Person mask clean-up: temporal smoothing, keeps the regions that belong to you, fills holes |
| `vision.js` | Loads MediaPipe models only when an effect needs them and picks the cutout model by speed |
| `stickers.js` | Reactions and expression-triggered effects |
| `backgrounds.js` | Virtual backgrounds drawn in code |
| `net.js` | Rooms: Trystero (handshake over public Nostr relays) or `?local=1` (handshake over a BroadcastChannel, for testing) |
| `recorder.js` | Records the call grid and every voice into one file, in the browser |
| `pip.js` | Picture-in-picture: moves the call's stage into a Document Picture-in-Picture window (auto on tab switch in Chrome 120+ via the media session `enterpictureinpicture` action), with a video PiP fallback |
| `config.js` | Deployment settings built in from `KONVENE_*` variables, and fetching relay passwords |

## Calls

- Each person connects directly to each other person (a mesh), so calls are limited to six. Bigger calls would need a media server (SFU), which Konvene deliberately doesn't have.
- The handshake (a few kilobytes of encrypted connection details) goes through public Nostr relays. Media never does.
- Browsers find a route with public STUN servers. Where no direct route exists, an optional TURN relay passes the encrypted media along (see `server/turn.mjs`).
- The outgoing video is a canvas, so switching cameras or effects needs nothing from the other side. Switching microphones swaps the audio track with `replaceTrack`.
- Peers receive a clone of the microphone track. Muting disables the clone, so the original still shows the "you're talking while muted" reminder.
- Bitrate is set on the video sender every few seconds: 2.5 Mbps with one other person, down to 1 Mbps with five.

## Background cutout

1. `vision.js` gives the segmenter a 320 px wide copy of the frame. It starts with Google's Selfie Multiclass model (person = 1 minus background) and falls back to the faster landscape model for the session only if frames are clearly too slow (a warm-up frame over 3 s, five frames in a row over 100 ms, or an average over 30 ms after 90 frames). `?seg=multi` or `?seg=land` pins one.
2. `matte.js` smooths the mask over time, keeps pixels that are at least half sure and near a very sure pixel (this drops chairs the model is only partly sure about), keeps the connected region under your face plus large regions at the bottom edge, and fills enclosed holes where the model was unsure.
3. `fx.js` refines the edge with a guided filter steered by the camera image, at half resolution in floating point (plain mask where floating-point targets are missing).

## Face effects

`face.js` smooths the landmarks (calm when still, quick when moving) and draws a soft mask of skin, lips and the inside of the mouth into a 256 px texture around the face. The final shader in `fx.js` then:

- **Warps** by moving where each pixel samples from: bulges for eyes and heads, stretches along the face's own axes for slimming and the fun warps. The person mask is sampled at the same warped point so background effects line up.
- **Smooths skin** with a two-ring edge-preserving filter on the skin mask only, then adds back a little texture.
- **Brightens eyes** inside an ellipse fitted to each eye, and lifts the shadow underneath.
- **Whitens teeth** by desaturating and brightening only the bright parts inside the mouth.
- **Colours lips and cheeks** using the lips' own light and shade, so texture and highlights stay.

Live previews in the drawer use a second, small WebGL context and share one camera upload per frame, within a 5 ms budget.

## Privacy by construction

- MediaPipe's usage logging is removed at build time (`build.mjs` fails if it can't find it) and blocked by the Content Security Policy.
- Models, WebAssembly and fonts are served from the site itself.
- Settings live in the browser's local storage. There are no cookies.
- The browser test fails if any request leaves the site.

## Models

| File | Source | Licence |
|---|---|---|
| `public/models/face_landmarker.task` | MediaPipe Face Landmarker (float16, v1) | Apache 2.0 |
| `public/models/selfie_multiclass_256x256.tflite` | MediaPipe Selfie Multiclass, unmodified | Apache 2.0 |
| `public/models/selfie_segmenter_landscape.tflite` | MediaPipe selfie segmentation (landscape) from `@mediapipe/selfie_segmentation`, with Tasks metadata added (input normalisation mean 0, std 255; label "person") using the `mediapipe` Python metadata writer | Apache 2.0 |
