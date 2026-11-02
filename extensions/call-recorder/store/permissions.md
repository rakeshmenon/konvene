# Permission justifications

Paste these into the Chrome Web Store dashboard, under **Privacy practices**. Each heading matches a permission in
`manifest.json`, and `npm run validate` fails if one is missing.

**Single purpose:** Record the tab you choose, plus your microphone and any screen or tab you share in the call, into a video file saved on your own computer.

## tabCapture

Records the video and sound of the call tab the user chose by clicking the extension icon. This is the extension's core
function. The recording starts only after the user presses Start, and Chrome shows its own recording indicator on the tab.

## offscreen

Keeps the recording running when the popup closes. A popup closes the moment the user clicks elsewhere, so the recording
engine runs in an offscreen document (reason: USER_MEDIA) that has access to the captured tab and the microphone.

## activeTab

Lets the extension read the title and address of the tab the user clicked it on, to recognise the site and to name the
recording (for example "Google Meet"). It is granted only for that tab, only after the user clicks. The extension has no
host permissions and cannot read any other tab.

## downloads

Saves the finished recording to the Downloads folder (in a "Call Recordings" subfolder), and lets the user show a saved
recording in its folder or delete the file from the library page.

## storage

Keeps the library of recordings (time, length, size, site, tab title, where the file went) and the user's settings, in
Chrome's local extension storage on the user's computer. Nothing is synced or sent anywhere.

## Content security policy: wasm-unsafe-eval

The manifest allows `'wasm-unsafe-eval'` for extension pages. It is needed to run the noise reduction model (RNNoise, compiled
to WebAssembly) inside the audio worklet. It only lets the extension's own bundled WebAssembly files run. It does not allow
`eval` or any remote code. Without it the noise reduction cannot start.

## Content scripts on Google Meet and Konvene

Two small content scripts run only on `https://meet.google.com/*` and Konvene pages (`https://konvene-calls.netlify.app/*`).
They exist for one reason: when the user shares a screen or a tab in the call, the sound of that share is added to the recording.
Only the call page itself can see what it shares, so the script runs in the page and notices when the page asks Chrome for a screen
share. It then offers a copy of the shared sound to the recorder over a WebRTC connection that stays inside the browser on the
same computer. It does nothing unless a recording is running in that tab. It does not read the page's text, forms, accounts, or
anyone's messages, and it sends nothing over the network. A third script on Konvene also passes "recording started" and
"recording stopped" to the page, so Konvene can show everyone in the call a recording badge.

## Remote code

No. All code and fonts are inside the package. The extension makes no network requests.

## Data usage (dashboard checkboxes)

| Question | Answer |
|---|---|
| Collects personally identifiable information, health, financial, authentication data, personal communications, location, web history, user activity, website content | **Website content and personal communications are handled on the device only** (call audio and video are recorded to a local file at the user's request). Nothing is transmitted. Declare accordingly and state this in the privacy policy. |
| Sold to third parties | No |
| Used or transferred for purposes unrelated to the single purpose | No |
| Used or transferred to determine creditworthiness or for lending | No |

## Notes for the reviewer

How to test, no account needed:

1. Open any web page that plays sound or video in a tab, for example a video page.
2. Click the extension icon. The setup page opens on first install: press **Allow microphone**.
3. Click the icon again on the video tab. Because it is not a known call site, tick the box that says you have told everyone.
4. Press **Start recording**, wait a few seconds, then press **Stop and save**.
5. The file appears in Downloads/Call Recordings. The extension's **Library** page lists it.

On a Konvene call (`https://konvene-calls.netlify.app`), the confirmation box is replaced by a recording badge shown to everyone in the call.
