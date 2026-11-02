/** Picks the first adapter that matches the tab's address, and the fallback when none does. */
export class SiteRegistry {
  adapters;
  fallback;
  constructor(adapters, fallback) {
    this.adapters = adapters;
    this.fallback = fallback;
  }
  resolve(rawUrl) {
    const url = parse(rawUrl);
    const adapter = this.adapters.find((a) => a.matches(url)) ?? this.fallback;
    return { adapter, url };
  }
  /** For records saved earlier: the site id is stored, so the adapter is found without the tab's address. */
  byId(id) {
    return this.adapters.find((a) => a.id === id) ?? this.fallback;
  }
  describe(rawUrl, tabTitle) {
    const { adapter, url } = this.resolve(rawUrl);
    return {
      siteId: adapter.id,
      siteName: adapter.displayName(url),
      host: url.hostname || "unknown",
      tabTitle,
      consent: adapter.consent,
    };
  }
}
function parse(raw) {
  try {
    return new URL(raw);
  } catch {
    return new URL("about:blank");
  }
}
