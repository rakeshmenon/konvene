import { DEFAULT_SETTINGS } from "../domain/types.js";
const RECORDINGS_KEY = "recordings";
const SETTINGS_KEY = "settings";
export class KeyValueRecordingRepository {
  store;
  /** Reads and writes are chained so two quick saves cannot overwrite each other. */
  queue = Promise.resolve();
  constructor(store) {
    this.store = store;
  }
  all() {
    return this.enqueue(() => this.load());
  }
  async get(id) {
    return (await this.all()).find((r) => r.id === id);
  }
  save(record) {
    return this.enqueue(async () => {
      const list = await this.load();
      const i = list.findIndex((r) => r.id === record.id);
      if (i >= 0) list[i] = record;
      else list.push(record);
      await this.store.set(RECORDINGS_KEY, list);
    });
  }
  remove(id) {
    return this.enqueue(async () => {
      const list = await this.load();
      await this.store.set(
        RECORDINGS_KEY,
        list.filter((r) => r.id !== id),
      );
    });
  }
  async load() {
    return (await this.store.get(RECORDINGS_KEY)) ?? [];
  }
  enqueue(job) {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
export class KeyValueSettingsStore {
  store;
  constructor(store) {
    this.store = store;
  }
  async read() {
    return { ...DEFAULT_SETTINGS, ...(await this.store.get(SETTINGS_KEY)) };
  }
  async write(patch) {
    const next = { ...(await this.read()), ...patch };
    await this.store.set(SETTINGS_KEY, next);
    return next;
  }
}
