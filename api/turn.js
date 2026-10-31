// Vercel Function: GET /api/turn -> short-lived TURN relay passwords (see server/turn.mjs)
import { respond } from "../server/turn.mjs";

export default async function handler(req, res) {
  const r = await respond(process.env);
  res.status(r.status);
  for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  res.send(r.body);
}
