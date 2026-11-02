/**
 * A site we cannot talk to, such as Google Meet. We cannot show the other people a badge,
 * so the recorder has to confirm they told everyone. One class covers every such site.
 */
export class ConfirmOnlyAdapter {
  options;
  consent = "recorder-confirms";
  id;
  constructor(options) {
    this.options = options;
    this.id = options.id;
  }
  matches(url) {
    return this.options.matches(url);
  }
  displayName(url) {
    const n = this.options.name;
    return typeof n === "function" ? n(url) : n;
  }
  async announce() {
    // Nothing to do: there is no channel to the site.
  }
}
export function hostAdapter(id, name, hosts) {
  return new ConfirmOnlyAdapter({ id, name, matches: (url) => hosts.includes(url.hostname) });
}

/**
 * @typedef {object} ConfirmOnlyOptions
 * @property {string} id
 * @property {string | ((url: URL) => string)} name
 * @property {(url: URL) => boolean} matches
 */
