# Changelog

All notable changes to Konvene. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

- Added: Cloudflare Pages support: `functions/api/turn.js` for relay passwords, and security headers moved to `public/_headers` (read by both Netlify and Cloudflare). Cloudflare builds skip `404.html` so call links answer 200.
- Changed: the home page shows real Konvene screens instead of a drawn call window: three moments (check how you look, decide who comes in, talk with captions) that play in turn, and real screenshots in the features explorer. The people are VRoid sample characters standing in for cameras.
- Fixed: on phones the call controls ran off the right edge of the screen. They now sit in two rows, and Share screen is hidden on browsers that can't share a screen.

## 1.1.0 (2026-11-01)

- Added: customising without changing the code. `KONVENE_NAME` (your name in titles, the wordmark and messages; a renamed copy credits Konvene in its footer), `KONVENE_MAX_PEOPLE` (2 to 8, now enforced: whoever joined last steps back when a call is full), `KONVENE_DISABLE` (switch off recording, captions, screen sharing, chat, effects or reactions), `KONVENE_PASSCODE_DEFAULT` and `KONVENE_ASK_FIRST_DEFAULT`, and a `custom/` folder for your logo, icons, link preview picture and `custom.css` colour tokens (see `custom.example/` and `docs/customising.md`). The home page's colours are now tokens too.
- Added: link previews (Open Graph and Twitter card tags, `og-image.png`; `KONVENE_SITE_URL`, filled in by Netlify and Vercel).
- Added: ESLint (`npm run lint`, run in CI), a CodeQL workflow that starts once the repository is public, CODEOWNERS, `.gitattributes`, `AGENTS.md`, and README screenshots and a browser table.

- Changed: the home page again, now night green with brass, around one idea: two circles, you and them, drift together on load and the space where they overlap lights up ("The space between you stays yours."). They follow the pointer a little; reduced motion shows them still. Then the call window with notes that appear as its story plays, where your call goes, the feature explorer, open source, questions and a closing call to action.
- Changed: a new logo and favicon (two points joined by one brass line), an Apple touch icon, and a lowercase "konvene" wordmark.
- Fixed: the previous home page's styles leaked into the app (pre-join Effects button, in-call caption lines and dialog notes). Home-only class names are now distinct, the shared styles are back, and the test checks caption lines stay visible.

- Changed: a new home page. Light, like the call screen, with Bricolage Grotesque headings (self-hosted, OFL). The hero shows a Konvene call that plays a short loop: the background blurs on the laptop, a guest asks to join and is let in, and captions appear (pure CSS, paused when off screen, still for reduced motion). Then where your call goes (moving packets, only while visible), a feature explorer with a small scene per feature, an open-source band, questions and answers, and a footer. The old "just us." headline with the live camera is gone; the home page no longer touches the camera at all.

- Added: a Noise reduction choice next to the microphone (pre-join page, Devices panel and the mic button's menu): standard (the browser's echo cancellation, noise suppression and level control, as before), strong (adds RNNoise, a small neural network run in an AudioWorklet on your device, for keyboards, fans and traffic) and original sound for music (no processing; use headphones). Remembered for next time. RNNoise's files are served from the site.

- Added: live captions, made on the devices in the call (Chrome on a computer, version 139 or newer, using its on-device speech recognition with `processLocally`; never a cloud service). Press the CC button or C. Each person's browser captions their own voice and sends the words only to the people who turned captions on; anyone whose browser can't is captioned by the viewer's browser from the audio it receives. Other browsers still see captions from people on Chrome. The first time, Chrome downloads a language pack once.

- Added: passcodes and asking to join. A new call can have a passcode (made for you, and editable) and can ask before letting people in. The passcode encrypts the handshake, so a browser without it can't connect; the link you copy includes it after the `#`, which never reaches any server, and there's a "Copy link without passcode" button. Someone asking to join waits on the pre-join page while everyone in the call sees "Name wants to join" with Let in and Don't let in (also in the People panel, with a soft sound). Until they're let in, nobody sends them video, voice, chat or names. Anyone in the call can turn asking first on or off. The person who started a call gets straight back in from the same browser for a week, and a refresh keeps you in.

- Added: weak-connection handling. Each browser checks every connection every 2 seconds (bandwidth, packet loss, delay) and picks full quality, 720p, 360p at 15 fps, or audio only for that one person, stepping down quickly and back up slowly. Tiles show a signal indicator when a connection isn't good, and "Video paused to keep the sound clear" when it's audio only. People also say how big they show you, so nobody gets full HD for a small tile or a hidden tab, which cuts upload in six-person calls.

- Added: picture-in-picture. In Chrome and Edge the call moves into a small always-on-top window (with mic, camera and leave buttons); Chrome opens it by itself when you switch tabs during a call. Elsewhere, the Pop out button uses the browser's video picture-in-picture.
- Added: Leave asks for confirmation, and warns if you're recording.
- Fixed: a small page scroll during calls (a hidden screen-reader element added 16px).
- Changed: the privacy diagram on the home page now contrasts most video apps (through their servers) with Konvene (straight to them).

- Added: a pre-join page. Starting a call or opening a call link now shows a large preview with camera, microphone and speaker choices, effects and your name, before anyone can see or hear you. Your last choices, including whether the camera and microphone were on, come back next time. The home page no longer has camera or microphone controls.

- Renamed Klatch to Konvene. Settings are now `KONVENE_*` (rename your `KLATCH_*` environment variables). The app ID default is now `konvene-calls-v1`, so Konvene calls don't meet browsers still running Klatch.

- Fixed: a call between a Mac and an iPhone flickered between one and two people. Both browsers added their video at the same moment, Safari dropped the connection, and it reconnected in a loop. Now one side sends its video first and the other follows.
- Added: a connection log for troubleshooting. Add `?debug` to any call link to see how each connection forms and why it ends.

## 1.0.0 (2026-10-31)

First public release.

- Peer-to-peer calls for up to six people with clean call links, refresh rejoining, and join muted with the camera off. A microphone is required to join.
- Video follows the camera up to full HD, with bitrate tuned to the number of people.
- Background blur and virtual backgrounds with a cleaned-up person cutout (MediaPipe Selfie Multiclass, with a fast fallback model).
- Face tab: smooth skin, brighter eyes, whiter teeth, slimmer face, bigger eyes, lip colour, blush and six fun warps, all on the GPU from face landmarks.
- Lighting presets and colour looks.
- Smart features on the device: pause when you step away, keep me in frame, fix low light, muted reminder.
- Screen sharing, chat, reactions, raise hand, pin, full screen, device menus and in-browser recording with a visible badge.
- Deploy anywhere: Netlify and Vercel configs, an optional TURN relay function, Docker and nginx setups, settings through environment variables.
