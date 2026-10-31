# Security and privacy

Klatch's main promise is privacy, so a privacy bug is a security bug.

## Reporting a problem

Please **don't open a public issue**. Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce it, and what an attacker could do with it.

You'll get a reply within a week. Once a fix is out, we're happy to credit you in the release notes if you'd like.

## What counts

Anything that breaks the promises in the [README](README.md#why-klatch) or on the privacy page, for example:

- Call media, chat or face data reaching anyone other than the people in the call.
- A way to join, watch or record a call without the others seeing it.
- A request leaving the site that the privacy page doesn't mention.
- Cross-site scripting or injection through names, chat messages or call links.
- The `/api/turn` function leaking the host's secret.

## Known limits (not vulnerabilities)

- People in a call and the public handshake relays and STUN servers can see your IP address, as with any WebRTC call. The privacy page says so.
- Anyone who has a call link can join that call. Links are random (about 45 bits) and calls only exist while someone is in them.
- Anyone can request relay passwords from a deployment's `/api/turn`. They expire after a few hours; hosts can limit use in their TURN provider's dashboard.

## Supported versions

Only the latest version on `main` is supported.
