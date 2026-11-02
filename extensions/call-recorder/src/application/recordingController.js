import { AppError, messageOf } from "../domain/errors.js";
import { buildFileName, buildStagingName } from "../domain/fileNamer.js";
import { RECORDING_STATE_MESSAGE } from "../domain/shareProtocol.js";
const isLive = (r) => r.status === "recording" || r.status === "saving";
/**
 * The use cases of the extension: start, stop, recover, list, remove. It holds no state of its own except
 * the set of recordings being saved right now. Everything else lives in the repository, so a restarted
 * service worker picks up exactly where the last one stopped.
 */
export class RecordingController {
  d;
  saving = new Set();
  constructor(d) {
    this.d = d;
  }
  async describeSite(tabId) {
    return (await this.inspect(tabId)).site;
  }
  async start(req) {
    if ((await this.reconcile()).some(isLive)) throw new AppError("busy", "A recording is already running.");
    const { site, adapter } = await this.inspect(req.tabId);
    if (site.consent === "recorder-confirms" && !req.consentConfirmed) {
      throw new AppError("consent-required", `Confirm that you have told everyone on ${site.siteName} that you are recording.`);
    }
    const id = this.d.ids.next();
    const startedAt = this.d.clock.now();
    const base = {
      id,
      startedAt,
      status: "recording",
      tabId: req.tabId,
      siteId: site.siteId,
      siteName: site.siteName,
      host: site.host,
      tabTitle: site.tabTitle,
      stagingName: buildStagingName(id),
      fileName: "",
      mimeType: "",
    };
    // On a site that shows a badge, a failed announcement means people would be recorded unseen: do not record.
    if (site.consent === "badge") {
      try {
        await adapter.announce(req.tabId, true, this.d.tabs);
      } catch {
        throw new AppError("capture-failed", `${site.siteName} did not answer. Reload the tab and try again.`);
      }
    }
    await this.d.repo.save(base);
    try {
      // The stream id expires quickly, so it is asked for as late as possible.
      const streamId = await this.captureStreamId(req.tabId);
      const { noiseReduction } = await this.d.settings.read();
      const engine = await this.d.recorder.start({ streamId, stagingName: base.stagingName, recordId: id, noiseReduction });
      await this.d.repo.save({
        ...base,
        mimeType: engine.mimeType,
        fileName: buildFileName({ startedAt, siteId: site.siteId, extension: engine.extension }),
      });
    } catch (e) {
      await this.d.repo.save({ ...base, status: "failed", error: messageOf(e) });
      await adapter.announce(req.tabId, false, this.d.tabs).catch(() => {});
      throw e instanceof AppError ? e : new AppError("capture-failed", messageOf(e));
    }
    // A screen or tab that was already being shared can be offered now.
    await this.tellPage(req.tabId, true);
    return { recordId: id };
  }
  /**
   * The call page offers the sound of a screen or tab it is sharing. It is taken only from the tab that is being
   * recorded, and only while recording. The answer is null when the share is not being recorded.
   */
  async acceptShare(offer, from) {
    const record = (await this.d.repo.all()).find((r) => r.status === "recording");
    if (!record || record.tabId !== from.tabId || !(await this.d.recorder.isRecording())) return { answer: null };
    try {
      return { answer: await this.d.recorder.shareOffer(offer) };
    } catch {
      return { answer: null };
    }
  }
  /** The page stopped sharing. */
  async endShare({ shareId }, from) {
    const record = (await this.d.repo.all()).find((r) => r.status === "recording");
    if (record && record.tabId === from.tabId) await this.d.recorder.shareEnded(shareId).catch(() => {});
  }
  async stop() {
    const record = (await this.d.repo.all()).find((r) => r.status === "recording");
    if (!record) throw new AppError("not-found", "Nothing is recording.");
    const capture = await this.d.recorder.stop();
    await this.finish(record, capture);
    return { recordId: record.id };
  }
  /** The recorder stopped by itself: the call tab was closed, or the encoder failed. */
  async handleEngineEnded(capture) {
    const record = (await this.d.repo.all()).find((r) => r.status === "recording" && r.stagingName === capture.stagingName);
    if (record) await this.finish(record, capture);
  }
  async status() {
    const live = (await this.reconcile()).find(isLive);
    if (!live) return { phase: "idle" };
    if (live.status === "saving") return { phase: "saving", recordId: live.id };
    return {
      phase: "recording",
      recordId: live.id,
      startedAt: live.startedAt,
      siteName: live.siteName,
      tabTitle: live.tabTitle,
    };
  }
  levels() {
    return this.d.recorder.levels();
  }
  async list() {
    return (await this.reconcile()).sort((a, b) => b.startedAt - a.startedAt);
  }
  async recover(recordId) {
    const record = await this.require(recordId);
    if (record.status !== "unfinished" && record.status !== "failed")
      throw new AppError("busy", "This recording is not waiting to be saved.");
    await this.save(record);
  }
  async remove(recordId, deleteFile) {
    const record = await this.require(recordId);
    const running = record.status === "recording" && (await this.d.recorder.isRecording());
    if (running || this.saving.has(record.id)) throw new AppError("busy", "Stop the recording before removing it.");
    if (deleteFile && record.location) await this.d.files.remove(record.location);
    if (record.status !== "saved") await this.d.recorder.release({ stagingName: record.stagingName }, true).catch(() => {});
    await this.d.repo.remove(record.id);
  }
  async reveal(recordId) {
    const record = await this.require(recordId);
    if (!record.location) throw new AppError("not-found", "This recording has not been saved.");
    await this.d.files.reveal(record.location);
  }
  // ---- private ----
  async finish(record, capture) {
    const ended = {
      ...record,
      mimeType: capture.mimeType || record.mimeType,
      endedAt: this.d.clock.now(),
      durationMs: capture.durationMs,
      sizeBytes: capture.sizeBytes,
      // A file with video but no sound is easy to miss until it is too late, so say so right away.
      ...(capture.soundDetected
        ? {}
        : {
            warning:
              "No sound was recorded. Check that your microphone works and that the call has sound, then try a short test recording.",
          }),
    };
    await this.d.sites
      .byId(record.siteId)
      .announce(record.tabId, false, this.d.tabs)
      .catch(() => {});
    await this.tellPage(record.tabId, false);
    if (capture.sizeBytes <= 0) {
      await this.d.repo.save({ ...ended, status: "failed", error: "Nothing was recorded." });
      await this.d.recorder.release({ stagingName: record.stagingName }, true).catch(() => {});
      throw new AppError("capture-failed", "Nothing was recorded.");
    }
    await this.save(ended);
  }
  async save(record) {
    this.saving.add(record.id);
    try {
      await this.d.repo.save({ ...record, status: "saving" });
      await this.d.exporter.export(record);
    } finally {
      this.saving.delete(record.id);
    }
  }
  /** A record that says "recording" or "saving" but has no live work behind it was cut short: mark it unfinished. */
  async reconcile() {
    const all = await this.d.repo.all();
    const recording = all.some((r) => r.status === "recording") ? await this.d.recorder.isRecording() : false;
    const fixed = [];
    for (const r of all) {
      const stale = (r.status === "recording" && !recording) || (r.status === "saving" && !this.saving.has(r.id));
      if (stale) {
        const next = { ...r, status: "unfinished", error: r.error ?? "This recording was cut short." };
        await this.d.repo.save(next);
        fixed.push(next);
      } else fixed.push(r);
    }
    return fixed;
  }
  async require(recordId) {
    const record = await this.d.repo.get(recordId);
    if (!record) throw new AppError("not-found", "That recording is not in the list any more.");
    return record;
  }
  async inspect(tabId) {
    const { url, title } = await this.d.tabs.describe(tabId);
    return { site: this.d.sites.describe(url, title), adapter: this.d.sites.resolve(url).adapter };
  }
  /** Tells the call page that a recording started or stopped, so it can offer or drop its shares. Best effort. */
  async tellPage(tabId, recording) {
    await this.d.tabs.send(tabId, { type: RECORDING_STATE_MESSAGE, recording }).catch(() => {});
  }
  async captureStreamId(tabId) {
    try {
      return await this.d.tabs.captureStreamId(tabId);
    } catch (e) {
      throw new AppError("capture-failed", `This tab cannot be recorded: ${messageOf(e)}`);
    }
  }
}

/**
 * @typedef {object} ControllerDeps
 * @property {TabGateway} tabs
 * @property {RecorderGateway} recorder
 * @property {RecordingRepository} repo
 * @property {SiteRegistry} sites
 * @property {ExportService} exporter
 * @property {SavedFileGateway} files
 * @property {SettingsStore} settings
 * @property {Clock} clock
 * @property {IdSource} ids
 */
