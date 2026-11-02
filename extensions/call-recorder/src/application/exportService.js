import { AppError, messageOf } from "../domain/errors.js";
import { buildFileName, extensionFromMime } from "../domain/fileNamer.js";
/**
 * Copies a finished recording out of private storage to its destination and updates the index.
 * Used for a normal stop and for recovering an unfinished recording, so the two paths cannot drift apart.
 */
export class ExportService {
  deps;
  warn;
  constructor(deps) {
    this.deps = deps;
    this.warn = deps.warn ?? ((m, e) => console.warn(m, e));
  }
  async export(record) {
    const { recorder, output, repo } = this.deps;
    const fileName =
      record.fileName ||
      buildFileName({
        startedAt: record.startedAt,
        siteId: record.siteId,
        extension: extensionFromMime(record.mimeType),
      });
    let file;
    try {
      file = await recorder.exportFile(record.stagingName, fileName, record.mimeType);
    } catch (e) {
      await repo.save({ ...record, fileName, status: "failed", error: `The recording file could not be read: ${messageOf(e)}` });
      throw new AppError("not-found", "The recording file could not be found.");
    }
    try {
      const location = await output.write(file);
      const { error: _cleared, ...rest } = record;
      const saved = { ...rest, fileName, sizeBytes: file.sizeBytes, status: "saved", location };
      await repo.save(saved);
      await recorder.release(file, true).catch((e) => this.warn("Could not delete the staging file", e));
      return saved;
    } catch (e) {
      // Keep the staged copy: the user can retry from the library.
      await repo.save({ ...record, fileName, status: "unfinished", error: messageOf(e) });
      await recorder.release(file, false).catch((err) => this.warn("Could not release the file URL", err));
      throw new AppError("save-failed", `Saving failed: ${messageOf(e)}`);
    }
  }
}

/**
 * @typedef {object} ExportDeps
 * @property {RecorderGateway} recorder
 * @property {OutputWriter} output
 * @property {RecordingRepository} repo
 * @property {(message: string, error: unknown) => void} [warn]
 */
