// Settings for this deployment. build.mjs fills __KONVENE__ from KONVENE_* environment variables
// (see .env.example), so the same code runs on any host with its own settings.
// (__KONVENE__ is declared for the linter in eslint.config.js)
const C = typeof __KONVENE__ === "object" ? __KONVENE__ : {};

export const CONFIG = {
  // the name people see (KONVENE_NAME)
  name: C.name || "Konvene",
  // calls only meet other browsers using the same app ID; change it to keep your deployment's calls separate
  appId: C.appId || "konvene-calls-v1",
  // most people in one call (2 to 8)
  maxPeople: C.maxPeople || 6,
  // features switched off on this deployment: recording, captions, screenshare, chat, effects, reactions
  disabled: new Set(C.disabled || []),
  // what new calls start with on the pre-join page
  passcodeDefault: !!C.passcodeDefault,
  askFirstDefault: !!C.askFirstDefault,
  // Nostr relays used for the handshake (empty: Trystero's defaults)
  relays: C.relays || [],
  // where the browser asks for short-lived TURN relay passwords (a Netlify or Vercel function)
  turnEndpoint: C.turnEndpoint === undefined ? "/api/turn" : C.turnEndpoint,
  // a fixed TURN server baked into the page (anyone can read it; prefer the endpoint)
  turn: C.turn || null,
};

// STUN and TURN servers for this call. Never throws: no relay just means direct connections only.
export async function iceServers() {
  const list = [];
  if (CONFIG.turn && CONFIG.turn.urls && CONFIG.turn.urls.length) list.push(CONFIG.turn);
  if (CONFIG.turnEndpoint) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      const r = await fetch(CONFIG.turnEndpoint, { cache: "no-store", signal: ctl.signal });
      clearTimeout(t);
      if (r.ok && (r.headers.get("content-type") || "").includes("json")) {
        const j = await r.json();
        for (const s of j.iceServers || []) {
          const urls = [].concat(s.urls || []).filter((u) => /^turns?:/.test(u) && !/:53(\?|$)/.test(u)); // browsers block port 53
          if (urls.length) list.push({ urls, username: s.username, credential: s.credential });
        }
      }
    } catch { /* no relay on this host */ }
  }
  return list;
}
