/**
 * Everything the recorder needs to know about the site in the tab. Add a site by adding an adapter to the list in defaultSites.js. The recording code never changes for a new site.
 * @typedef {object} SiteAdapter
 * @property {string} id
 * @property {ConsentMode} consent
 * @property {(url: URL) => boolean} matches
 * @property {(url: URL) => string} displayName
 * @property {(tabId: number, recording: boolean, tabs: TabMessenger) => Promise<void>} announce Tell the site that recording started or stopped, when the site can show it to everyone.
 */

export {};
