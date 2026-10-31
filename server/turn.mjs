// Short-lived TURN relay passwords for browsers. Used by the Netlify and Vercel functions.
//
// Most calls connect directly. On strict networks (some offices, hotels, mobile carriers) a
// direct route is impossible and the call needs a TURN relay. The relay forwards encrypted
// media and cannot decrypt it. Your provider's API secret stays on the server; browsers only
// ever get passwords that expire.
//
// Environment variables (set them in your host's dashboard, never in the code):
//   CLOUDFLARE_TURN_KEY_ID, CLOUDFLARE_TURN_API_TOKEN  Cloudflare Realtime TURN (free tier available)
//   TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL          or any TURN server you run yourself
//   TURN_TTL                                           password lifetime in seconds (default 14400, 4 hours)

export async function turnCredentials(env = process.env) {
  const ttl = Math.max(600, Math.min(172800, Number(env.TURN_TTL) || 14400));
  if (env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_API_TOKEN) {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CLOUDFLARE_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_TURN_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl }),
    });
    if (!r.ok) throw new Error(`Cloudflare TURN answered ${r.status}`);
    const j = await r.json();
    return { iceServers: j.iceServers || [], ttl };
  }
  if (env.TURN_URLS) {
    const urls = env.TURN_URLS.split(",").map((u) => u.trim()).filter(Boolean);
    return { iceServers: [{ urls, username: env.TURN_USERNAME || "", credential: env.TURN_CREDENTIAL || "" }], ttl };
  }
  return null; // no relay configured: calls connect directly only
}

export async function respond(env) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const c = await turnCredentials(env);
    if (!c) return { status: 200, headers, body: JSON.stringify({ iceServers: [], note: "No TURN relay configured on this site" }) };
    return { status: 200, headers, body: JSON.stringify(c) };
  } catch (e) {
    console.error("turn:", e.message);
    return { status: 502, headers, body: JSON.stringify({ iceServers: [] }) };
  }
}
