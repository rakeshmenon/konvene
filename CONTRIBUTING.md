# Contributing to Konvene

Thanks for helping. Konvene is small on purpose: plain JavaScript modules, one bundler, no framework, no server of its own. Contributions that keep it that way are the easiest to accept.

## Ground rules

These are what Konvene promises its users. Pull requests that break them can't be merged.

1. **Nothing stored on a server.** Media goes peer to peer. Recordings are made and saved in the recorder's browser only.
2. **No telemetry.** No analytics, tracking pixels, error reporting services or third-party requests. The test fails if a request leaves the site.
3. **Effects run on the sender's device.** Never upload frames, audio or face data for processing.
4. **Recording is visible.** Starting a recording asks first and shows everyone a named badge. No silent recording.
5. **Effects never label emotions or identify people.** Face landmarks place effects; expressions only trigger fun effects.
6. **The privacy page tells the truth.** If your change sends anything new off the device, update `public/privacy.html` in the same pull request.

## Set up

```sh
git clone https://github.com/rakeshmenon/konvene
cd konvene
npm install
npx playwright install chromium
npm run dev          # http://localhost:8790, two tabs on /?local=1 for a call
```

`npm run dev` builds once. After changing `src/` or `public/`, run `npm run build` and reload.

## Making a change

1. For anything bigger than a small fix, open an issue first so we can agree on the approach.
2. Branch from `main`. Keep pull requests focused on one thing.
3. Run `npm run lint`, `npm run build` and `npm test` (or all three with `npm run check`). They must pass. If you touched face or background effects, run the test with `FACE_VIDEO=<a .y4m video of a face>` too, and check the effect by eye in a real browser.
4. For visible changes, add before and after screenshots to the pull request.
5. Add a line to `CHANGELOG.md` under "Unreleased".

## Code style

- Modern JavaScript modules, no TypeScript, no framework. Two-space indentation (see `.editorconfig`).
- Comments explain why, in plain words. User-facing text is short, plain English, without em dashes.
- GPU work goes in `src/fx.js` shaders; anything per pixel on the CPU must stay within a few milliseconds at 30 frames a second.
- New dependencies need a good reason, a permissive or compatible licence, and an entry in `THIRD_PARTY_NOTICES.txt`.
- Keep the pages accessible: real buttons, labels, keyboard focus, enough contrast.

## Where things live

See the project layout in the [README](README.md#project-layout) and the design notes in [docs/architecture.md](docs/architecture.md).

## Licence of contributions

Konvene is licensed under the AGPL-3.0. By sending a pull request you agree that your contribution is licensed under the same terms, and that you have the right to submit it.
