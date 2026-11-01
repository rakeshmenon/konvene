// Cloudflare Pages Function: GET /api/turn -> short-lived TURN relay passwords (see server/turn.mjs).
// Functions run before public/_redirects, so the Netlify rule for /api/turn doesn't apply here.
import { respond } from "../../server/turn.mjs";

export async function onRequestGet({ env }) {
  const r = await respond(env);
  return new Response(r.body, { status: r.status, headers: r.headers });
}
