/** chrome.storage.local as a plain key-value store. Works in the service worker and in every extension page. */
export class ChromeKeyValueStore {
  async get(key) {
    const found = await chrome.storage.local.get(key);
    return found[key];
  }
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }
}
