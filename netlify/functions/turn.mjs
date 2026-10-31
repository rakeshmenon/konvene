// Netlify Function: short-lived TURN relay passwords (see server/turn.mjs).
// Served at /.netlify/functions/turn; public/_redirects maps /api/turn to it.
import { respond } from "../../server/turn.mjs";

export default async () => {
  const r = await respond(process.env);
  return new Response(r.body, { status: r.status, headers: r.headers });
};
