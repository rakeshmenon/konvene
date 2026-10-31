<div align="center">

<img src="public/favicon.svg" width="72" height="72" alt="">

# Klatch

**Video calls that stay between you.**

Free, private video calls in the browser. Peer to peer, no account, no server in the middle,
and every effect worked out on your own device.

[Live demo](https://klatch-calls.netlify.app) · [Run your own](#run-your-own) · [How it works](docs/architecture.md) · [Contributing](CONTRIBUTING.md)

[![CI](https://github.com/rakeshmenon/klatch/actions/workflows/ci.yml/badge.svg)](https://github.com/rakeshmenon/klatch/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-14523d.svg)](LICENSE)

</div>

## Why Klatch

Most video apps promise to look after your data. Klatch is built so there is nothing to look after.

- **Straight to them.** Video, voice, screens and chat travel directly between browsers over WebRTC, encrypted the whole way.
- **Nothing kept.** No server records your call or your chat. Recordings are made and saved on the recorder's own device.
- **No account.** Type a name, share the link, start talking.
- **No tracking.** No cookies, no analytics, no ads. The build strips MediaPipe's usage logging, and the page's Content Security Policy blocks it too.
- **Your face stays home.** Background blur, virtual backgrounds, lighting, touch-up, makeup and face warps run on your GPU before the picture is sent.
- **Recording is never secret.** It asks first and shows everyone a badge naming who is recording.

## Features

| | |
|---|---|
| **Calls** | Up to 6 people, clean links (`/abc-def-ghj`), join muted with camera off, microphone required to join, refresh rejoins the call |
| **Video** | Follows your camera up to full HD, bitrate tuned to the number of people |
| **Background** | Blur (two strengths), virtual backgrounds, your own image, with a cutout that follows hair and leaves furniture out |
| **Face** | Smooth skin, brighter eyes, whiter teeth, slimmer face, bigger eyes, lip colour, blush, and six fun warps |
| **Light and looks** | Studio, ring light, golden hour, spotlight and more; nine colour looks |
| **Smart** | Pauses your video when you step away, keeps you in frame, fixes low light, tells you when you talk while muted |
| **Together** | Screen sharing with spotlight, chat, reactions, raise hand, pin, full screen, in-browser recording |
| **Devices** | Pick camera, microphone and speakers from the call controls |

## Run your own

### One click

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/rakeshmenon/klatch)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Frakeshmenon%2Fklatch)

Build settings are already in `netlify.toml` and `vercel.json`. Add settings later as environment variables in your host's dashboard (see [Settings](#settings)).

### On your computer

Needs [Node.js](https://nodejs.org) 22 or newer.

```sh
git clone https://github.com/rakeshmenon/klatch
cd klatch
npm install
npm run dev
```

Open <http://localhost:8790>. To try a call on one computer, open <http://localhost:8790/?local=1> in two tabs (the handshake then runs inside the browser, no internet needed). A call between two computers needs HTTPS, so deploy it.

### Anywhere else

`npm run build` writes a static site to `dist/`. Upload it to any web host and send unknown paths to `/index.html` (call links are paths). Ready-made setups: Cloudflare Pages (`_redirects` included), nginx (`deploy/nginx.conf`), Docker (`docker build -t klatch . && docker run -p 8080:80 klatch`). Full guide: [docs/self-hosting.md](docs/self-hosting.md).

## Settings

Copy `.env.example` to `.env`, or set the same names in your host's dashboard. All optional.

| Variable | What it does |
|---|---|
| `KLATCH_APP_ID` | Calls only meet browsers with the same app ID. Set your own to keep your calls separate from other copies. |
| `KLATCH_OPERATOR`, `KLATCH_CONTACT_URL` | Who runs your copy, shown on the privacy page. |
| `KLATCH_REPO_URL` | Where your copy's source lives; the site's GitHub links point here. |
| `KLATCH_RELAYS` | Your own Nostr relays for the handshake. |
| `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` | **Secret.** A TURN relay for strict networks, via Cloudflare. |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | **Secret.** Any other TURN server. |

`KLATCH_*` values are built into the page, so anyone can read them. Secrets stay on the server: the `/api/turn` function (Netlify or Vercel) trades them for relay passwords that expire after a few hours.

## How it works

```
 camera ─► MediaPipe (face landmarks + person mask, on device)
        ─► WebGL2 effects (cutout, blur, light, face) ─► canvas.captureStream()
        ─► WebRTC, directly to each person in the call (Trystero, handshake over public Nostr relays)
```

There is no Klatch server in a call. The host serves static files and, optionally, one small function that hands out relay passwords. Details, including how the background cutout is cleaned up, are in [docs/architecture.md](docs/architecture.md).

## Project layout

```
src/            the app (plain JavaScript modules, bundled by esbuild)
public/         pages, styles and the MediaPipe models, copied into dist/
server/         TURN relay passwords, shared by the Netlify and Vercel functions
netlify/        Netlify function
api/            Vercel function
scripts/        local server and .env reader
tests/          end-to-end browser test (Playwright)
deploy/         nginx config for your own server or Docker
docs/           architecture and self-hosting guides
```

## Testing

```sh
npx playwright install chromium   # once
npm test
```

The test runs a real two-person call in headless Chromium with fake devices: joining, muting, chat, screen sharing, recording, device switching, refresh rejoining, and that no request leaves the site. Set `FACE_VIDEO` to a `.y4m` video of a face to also test face tracking and effects.

## Contributing

Bug reports, ideas and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md); please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Found a security or privacy problem? See [SECURITY.md](SECURITY.md).

## License

Klatch is licensed under the [GNU Affero General Public License v3.0](LICENSE). You may use, change and share it, including commercially. If you run a changed version for other people, you must offer them its source code.

Bundled libraries, models and fonts keep their own licences (MIT, Apache 2.0, OFL). See [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt); the same notices are appended to the built `app.js`.
