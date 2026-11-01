# Customising Konvene

Run Konvene under your own name and colours, switch features off, and set what new calls start
with, without changing the code. Updates from upstream then merge cleanly.

## 1. Settings

Set these as environment variables in your host's dashboard (Netlify, Vercel, Cloudflare Pages)
or in a `.env` file, then rebuild. All are optional. Full list in [.env.example](../.env.example).

| Variable | Default | What it does |
|---|---|---|
| `KONVENE_NAME` | `Konvene` | The name people see: page titles, the wordmark, messages. A renamed copy says "Built on Konvene" in its footer. |
| `KONVENE_APP_ID` | `konvene-calls-v1` | Calls only meet browsers with the same app ID. Set your own so your calls never meet other copies. |
| `KONVENE_MAX_PEOPLE` | `6` | Most people in one call, 2 to 8. Every browser sends its video to every other one, so more people means more upload for each. |
| `KONVENE_DISABLE` | none | Features to switch off, comma separated: `recording`, `captions`, `screenshare`, `chat`, `effects`, `reactions`. Their buttons disappear. |
| `KONVENE_PASSCODE_DEFAULT` | `false` | New calls start with a passcode switched on. People can still turn it off. |
| `KONVENE_ASK_FIRST_DEFAULT` | `false` | New calls start with "Ask before letting people in" on. |
| `KONVENE_OPERATOR`, `KONVENE_CONTACT_URL` | empty | Who runs your copy, shown on the privacy page. |
| `KONVENE_REPO_URL` | upstream | Where your copy's source lives. The AGPL asks you to offer it if you change Konvene. |
| `KONVENE_SITE_URL` | from your host | Your site's address, for link previews. Netlify and Vercel fill it in. |
| `KONVENE_CUSTOM_DIR` | `custom` | The folder with your branding files (below). |

Example, a company copy with recording off and every call locked by default:

```sh
KONVENE_NAME="Acme Meet"
KONVENE_APP_ID=acme-meet-calls
KONVENE_DISABLE=recording
KONVENE_PASSCODE_DEFAULT=true
KONVENE_ASK_FIRST_DEFAULT=true
```

## 2. Logo, icons and colours

Copy [custom.example/](../custom.example) to `custom/` and change what you need:

- `custom/logo.svg` replaces the logo everywhere.
- `custom/favicon.svg`, `custom/apple-touch-icon.png` and `custom/og-image.png` replace the icons and the link preview picture.
- `custom/custom.css` loads after Konvene's styles. Override the colour tokens:

| Token | Where | Used for |
|---|---|---|
| `--accent`, `--accent-strong` | `:root` | Buttons and highlights on the pre-join page and in calls |
| `--brass` | `:root` | The speaking ring and a raised hand |
| `--bg`, `--surface`, `--ink` | `:root` | Page background, panels, text in the app |
| `--night` | `.home` | Home page background |
| `--gold`, `--gold-2` | `.home` | Home buttons and the glow where the circles meet |
| `--glow`, `--orb`, `--orb-2` | `.home` | The circles in the home page hero |
| `--mist` | `.home` | Home page text |

Any other file in `custom/` is copied over the built site's file with the same name, so you can
also replace `privacy.html` with your own privacy notice. Keep it true: it must say what your
copy sends where.

## 3. Changing more

For bigger changes, fork the repository. The pages are plain HTML in `public/`, the app is plain
JavaScript in `src/`, and `docs/architecture.md` explains how it fits together. Please keep the
promises in [CONTRIBUTING.md](../CONTRIBUTING.md#ground-rules) if your copy still says "private".

## Licence

Konvene is AGPL-3.0. You can rename and rebrand it, including commercially. If you run a changed
version for other people, offer them its source code (set `KONVENE_REPO_URL` to it), and keep the
licence and the notices in `THIRD_PARTY_NOTICES.txt`.
