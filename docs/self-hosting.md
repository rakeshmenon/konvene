# Self-hosting Konvene

Konvene builds to a folder of static files (`dist/`) plus one optional function for relay passwords. Any web host can serve it. The same guide is on every Konvene site at `/self-host.html`.

## 1. Netlify (one click)

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/rakeshmenon/konvene)

Or by hand: fork the repository, then in Netlify choose **Add new site > Import an existing project**, pick your fork and deploy. `netlify.toml` already sets the build command (`npm run build`), the publish folder (`dist`) and the functions folder. Call links and `/api/turn` are routed by `public/_redirects`.

Settings: **Site configuration > Environment variables**, then **Deploys > Trigger deploy**.

## 2. Vercel (one click)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Frakeshmenon%2Fkonvene)

Or import your fork in Vercel. `vercel.json` sets the build, the output folder and the rewrites; `api/turn.js` becomes the `/api/turn` function. Settings: **Project > Settings > Environment Variables**, then redeploy.

## 3. Any static host

```sh
npm ci
npm run build      # writes dist/
```

Upload `dist/`. Configure one rewrite: unknown paths go to `/index.html`, because call links are paths like `/abc-def-ghj`.

| Host | Rewrite |
|---|---|
| Cloudflare Pages | Included (`_redirects`). Build `npm run build`, output `dist`. |
| nginx | `try_files $uri $uri/ /index.html;` (full config in `deploy/nginx.conf`) |
| Apache | `FallbackResource /index.html` |
| Caddy | `try_files {path} /index.html` |
| GitHub Pages | Nothing to do on a root domain: `404.html` is a copy of the app. |

The site must be served over HTTPS (browsers only allow cameras on HTTPS and `localhost`). Serve `.wasm` files as `application/wasm`.

## 4. Docker

```sh
docker build -t konvene --build-arg KONVENE_APP_ID=my-calls .
docker run -p 8080:80 konvene
```

Put it behind a proxy that adds HTTPS. The container serves static files only, so use `KONVENE_TURN_*` if you need a relay.

## Settings

All optional; see `.env.example` for the full list with comments.

- `KONVENE_*` settings are built into the page and visible to anyone. Rebuild after changing them.
- Secrets (`CLOUDFLARE_TURN_*`, `TURN_*`) are read by the `/api/turn` function at request time and never reach the browser.

Set `KONVENE_APP_ID` to something of your own, so your calls never meet browsers on other copies of Konvene.

## A relay for strict networks (TURN)

Most calls connect directly. Some networks (strict offices, hotels, some mobile carriers) block that; those calls need a TURN relay, which passes the encrypted media along without being able to decrypt it.

**Cloudflare (free allowance):**

1. Cloudflare dashboard > **Realtime** > **TURN Server** > create a TURN key.
2. Copy the key ID and API token.
3. Set `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` in Netlify or Vercel (mark them secret) and redeploy.
4. Check: open `https://your-site/api/turn`. You should see JSON with `iceServers`.

**Your own coturn:** set `TURN_URLS` (comma separated, for example `turns:turn.example.com:443?transport=tcp`), `TURN_USERNAME` and `TURN_CREDENTIAL`.

**Static hosts:** set `KONVENE_TURN_URLS`, `KONVENE_TURN_USERNAME` and `KONVENE_TURN_CREDENTIAL`. These are visible in the page, so only use credentials created for this and limit them at the TURN provider.

## Troubleshooting calls

Add `?debug` to a call link (for example `https://your-site/abc-def-ghj?debug`) to show a connection log at the bottom of the page. It lists each connection attempt, the route it took (`host` means the same network, `srflx` a direct route through the internet, `relay` your TURN server), and why it ended. It stays on that device; use **Copy** to paste it into a bug report. If connections reach "checking" and then fail, the network needs a TURN relay.

## Staying up to date

```sh
git remote add upstream https://github.com/rakeshmenon/konvene
git pull upstream main
```

## Licence duties

Konvene is AGPL-3.0. If you run a changed version for other people, offer them its source: publish your fork and set `KONVENE_REPO_URL`, and the site's links do the rest. Keep `LICENSE` and `THIRD_PARTY_NOTICES.txt`.
