import { KONVENE_TAB_MESSAGE } from "./konveneProtocol.js";
/** Konvene is our own app: it shows everyone a named recording badge when we tell it to. */
export class KonveneAdapter {
  origins;
  id = "konvene";
  consent = "badge";
  constructor(origins) {
    this.origins = origins;
  }
  matches(url) {
    return this.origins.includes(url.origin);
  }
  displayName() {
    return "Konvene";
  }
  async announce(tabId, recording, tabs) {
    const message = { type: KONVENE_TAB_MESSAGE, recording };
    const reply = await tabs.send(tabId, message);
    // Switching the badge off is best effort. Switching it on must be confirmed, or nobody would see it.
    if (recording && reply?.shown !== true) {
      throw new Error("The Konvene page did not confirm that the recording badge is showing.");
    }
  }
}
