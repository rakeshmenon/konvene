# Konvene: notes for AI coding agents

These notes apply to every AI coding agent (Claude Code, Codex, Cursor, Copilot and others).

Read `README.md`, `CONTRIBUTING.md` and `docs/architecture.md` first. This file is the short version.

## Commands

- `npm install` once, then `npm run dev` (builds to `dist/` and serves http://localhost:8790).
- `npm run build` after every change to `src/` or `public/`. Never edit `dist/`.
- `npm run lint` (ESLint) must pass; CI runs it.
- Deployment settings: `KONVENE_*` in `.env.example` and `docs/customising.md`; branding lives in `custom/`, never in code.
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
- Secrets never start with `KONVENE_` (those are built into the page). Server secrets are read only in `server/turn.mjs`.

## Style

- Plain JavaScript modules, no framework, no TypeScript. Comments say why.
- User-facing text: short, plain English, no em dashes.
- Pages are static HTML in `public/`; `build.mjs` fills `{{REPO}}`, `{{OPERATOR}}`, `{{CREDIT}}`, `{{MAX}}`, `{{SITE}}` and `<!--demo-->` blocks, and swaps in `KONVENE_NAME` and `custom/logo.svg`.
- Home page class names must not clash with the app's (the home page shares the stylesheet). Scope home rules under `.home` and give them distinct names; a home `.live` once shrank every Effects preview.

## Commits

- Plain, descriptive messages in the maintainer's name. No AI attribution trailers (no `Co-Authored-By` lines for agents, no session links, no "Generated with" footers), in commits or pull requests.
