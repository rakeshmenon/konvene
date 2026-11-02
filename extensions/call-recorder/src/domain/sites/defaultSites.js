import { CONFIG } from "../../config.js";
import { ConfirmOnlyAdapter, hostAdapter } from "./confirmOnlyAdapter.js";
import { KonveneAdapter } from "./konveneAdapter.js";
import { SiteRegistry } from "./siteRegistry.js";
/** The one place that lists the sites we know. Order matters: first match wins. */
export function createSiteRegistry() {
  const generic = new ConfirmOnlyAdapter({
    id: "web",
    name: (url) => url.hostname || "this page",
    matches: () => true,
  });
  return new SiteRegistry(
    [new KonveneAdapter(CONFIG.konveneOrigins), hostAdapter("google-meet", "Google Meet", ["meet.google.com"])],
    generic,
  );
}
