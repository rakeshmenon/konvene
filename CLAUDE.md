# Klatch: notes for AI coding assistants

Read `README.md`, `CONTRIBUTING.md` and `docs/architecture.md` first. This file is the short version.

## Commands

- `npm install` once, then `npm run dev` (builds to `dist/` and serves http://localhost:8790).
- `npm run build` after every change to `src/` or `public/`. Never edit `dist/`.
- `npm test` runs the Playwright call test (needs `npx playwright install chromium` once). `FACE_VIDEO=<face.y4m>` adds face checks.
- Two tabs on `/?local=1` make a call on one machine without the internet.

## Rules that must not break

- Nothing stored on a server; media is peer to peer; recordings stay in the recorder's browser.
- No telemetry or third-party requests. The test asserts nothing leaves the site; keep it passing.
- Effects run on the sender's device. Never upload frames, audio or face data.
- Recording always asks first and shows everyone a named badge.
- Effects never label emotions or identify people.
- Anything new that leaves the device goes on `public/privacy.html` in the same change.
- New bundled libraries, models or fonts go in `THIRD_PARTY_NOTICES.txt`.
- Secrets never start with `KLATCH_` (those are built into the page). Server secrets are read only in `server/turn.mjs`.

## Style

- Plain JavaScript modules, no framework, no TypeScript. Comments say why.
- User-facing text: short, plain English, no em dashes.
- Pages are static HTML in `public/`; `build.mjs` fills `{{REPO}}`, `{{OPERATOR}}` and `<!--demo-->` blocks.
