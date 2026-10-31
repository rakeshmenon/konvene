# Changelog

All notable changes to Klatch. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

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
