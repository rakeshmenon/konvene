/** Saves into the chosen folder by asking the recorder engine, which holds the folder handle and the file. */
export class FolderOutputWriter {
  recorder;
  constructor(recorder) {
    this.recorder = recorder;
  }
  async write(file) {
    const { folderName } = await this.recorder.writeToFolder(file.stagingName, file.fileName);
    return { kind: "folder", folderName };
  }
}
/** Tries the first writer, and on any failure uses the second. Same interface as both, so callers never know. */
export class FallbackOutputWriter {
  primary;
  fallback;
  onFallback;
  constructor(primary, fallback, onFallback = () => {}) {
    this.primary = primary;
    this.fallback = fallback;
    this.onFallback = onFallback;
  }
  async write(file) {
    try {
      return await this.primary.write(file);
    } catch (e) {
      this.onFallback(e);
      return this.fallback.write(file);
    }
  }
}
/** Chooses the destination from the settings at the moment of saving: the chosen folder if any, else Downloads. */
export class ConfiguredOutputWriter {
  settings;
  folder;
  downloads;
  onFallback;
  constructor(settings, folder, downloads, onFallback = () => {}) {
    this.settings = settings;
    this.folder = folder;
    this.downloads = downloads;
    this.onFallback = onFallback;
  }
  async write(file) {
    const { folderName } = await this.settings.read();
    const writer = folderName ? new FallbackOutputWriter(this.folder, this.downloads, this.onFallback) : this.downloads;
    return writer.write(file);
  }
}
