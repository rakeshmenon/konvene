import { beforeEach, describe, expect, it } from "vitest";
import { RECORDING_STATE_MESSAGE } from "../src/domain/shareProtocol.js";
import { ExportService } from "../src/application/exportService.js";
import { RecordingController } from "../src/application/recordingController.js";
import { createSiteRegistry } from "../src/domain/sites/defaultSites.js";
import { KONVENE_TAB_MESSAGE } from "../src/domain/sites/konveneProtocol.js";
import { CountingIds, FakeClock, FakeFiles, FakeOutput, FakeRecorder, FakeSettings, FakeTabs, MemoryRepository } from "./helpers/fakes.js";
const KONVENE = "https://konvene-calls.netlify.app/abc-def-ghj";
function setup(url) {
  const tabs = new FakeTabs(url);
  const recorder = new FakeRecorder();
  const repo = new MemoryRepository();
  const output = new FakeOutput();
  const files = new FakeFiles();
  const settings = new FakeSettings();
  const exporter = new ExportService({ recorder, output, repo, warn: () => {} });
  const controller = new RecordingController({
    tabs,
    recorder,
    repo,
    sites: createSiteRegistry(),
    exporter,
    files,
    settings,
    clock: new FakeClock(),
    ids: new CountingIds(),
  });
  return { tabs, recorder, repo, output, files, settings, controller };
}
describe("start", () => {
  it("refuses a Meet recording until the recorder confirms they told everyone", async () => {
    const { controller, recorder } = setup();
    await expect(controller.start({ tabId: 1, consentConfirmed: false })).rejects.toMatchObject({
      code: "consent-required",
    });
    expect(recorder.started).toHaveLength(0);
  });
  it("records Meet once confirmed, and names the file from the site and engine format", async () => {
    const { controller, repo, recorder } = setup();
    const { recordId } = await controller.start({ tabId: 1, consentConfirmed: true });
    expect(recorder.started[0]).toMatchObject({ streamId: "stream-1", recordId });
    const rec = await repo.get(recordId);
    expect(rec).toMatchObject({
      status: "recording",
      siteId: "google-meet",
      fileName: "call-2026-11-02-1105-google-meet.mp4",
      tabTitle: "Meet - abc",
    });
  });
  it("on Konvene needs no confirmation and tells the page to show the badge", async () => {
    const { controller, tabs } = setup(KONVENE);
    await controller.start({ tabId: 4, consentConfirmed: false });
    expect(tabs.sent.filter((s) => s.message.type === KONVENE_TAB_MESSAGE)).toEqual([
      { tabId: 4, message: { type: KONVENE_TAB_MESSAGE, recording: true } },
    ]);
  });
  it("does not record on Konvene when the badge cannot be shown", async () => {
    const { controller, tabs, recorder } = setup(KONVENE);
    tabs.failSend = true;
    await expect(controller.start({ tabId: 4, consentConfirmed: false })).rejects.toMatchObject({
      code: "capture-failed",
    });
    expect(recorder.started).toHaveLength(0);
  });
  it("does not record on Konvene when the page does not confirm its badge", async () => {
    const { controller, tabs, recorder } = setup(KONVENE);
    tabs.noAck = true;
    await expect(controller.start({ tabId: 4, consentConfirmed: false })).rejects.toMatchObject({
      code: "capture-failed",
    });
    expect(recorder.started).toHaveLength(0);
  });
  it("marks the record failed and clears the badge when the engine cannot start", async () => {
    const { controller, tabs, recorder, repo } = setup(KONVENE);
    recorder.failStart = true;
    await expect(controller.start({ tabId: 4, consentConfirmed: false })).rejects.toThrow("encoder failed");
    expect((await repo.all())[0]).toMatchObject({ status: "failed", error: "encoder failed" });
    expect(tabs.sent.at(-1)?.message).toEqual({ type: KONVENE_TAB_MESSAGE, recording: false });
  });
  it("explains a tab that cannot be captured", async () => {
    const { controller, tabs } = setup();
    tabs.failCapture = true;
    await expect(controller.start({ tabId: 1, consentConfirmed: true })).rejects.toMatchObject({
      code: "capture-failed",
    });
  });
  it("refuses a second recording while one is running", async () => {
    const { controller } = setup();
    await controller.start({ tabId: 1, consentConfirmed: true });
    await expect(controller.start({ tabId: 2, consentConfirmed: true })).rejects.toMatchObject({ code: "busy" });
  });
});
describe("sound and settings", () => {
  it("passes the noise reduction setting to the recorder", async () => {
    const { controller, recorder, settings } = setup();
    await settings.write({ noiseReduction: false });
    await controller.start({ tabId: 1, consentConfirmed: true });
    expect(recorder.noiseReductionSeen).toBe(false);
  });
  it("uses noise reduction by default", async () => {
    const { controller, recorder } = setup();
    await controller.start({ tabId: 1, consentConfirmed: true });
    expect(recorder.noiseReductionSeen).toBe(true);
  });
  it("saves a silent recording but warns about it", async () => {
    const { controller, recorder, repo } = setup();
    const { recordId } = await controller.start({ tabId: 1, consentConfirmed: true });
    recorder.capture = { ...recorder.capture, soundDetected: false };
    await controller.stop();
    const saved = await repo.get(recordId);
    expect(saved?.status).toBe("saved");
    expect(saved?.warning).toMatch(/No sound was recorded/);
  });
  it("does not warn when sound was heard", async () => {
    const { controller, repo } = setup();
    const { recordId } = await controller.start({ tabId: 1, consentConfirmed: true });
    await controller.stop();
    expect((await repo.get(recordId))?.warning).toBeUndefined();
  });
  it("reports live levels only while recording", async () => {
    const { controller } = setup();
    expect(await controller.levels()).toBeNull();
    await controller.start({ tabId: 1, consentConfirmed: true });
    expect(await controller.levels()).toMatchObject({ mic: 0.1, tab: 0.05 });
  });
});
describe("stop", () => {
  let ctx;
  beforeEach(() => {
    ctx = setup(KONVENE);
  });
  it("saves the file, records where it went and clears the badge", async () => {
    const { controller, repo, output, recorder, tabs } = ctx;
    const { recordId } = await controller.start({ tabId: 4, consentConfirmed: false });
    await controller.stop();
    expect(output.written[0]).toMatchObject({ fileName: "call-2026-11-02-1105-konvene.mp4" });
    expect(await repo.get(recordId)).toMatchObject({
      status: "saved",
      durationMs: 62_000,
      sizeBytes: 5_000_000,
      location: { kind: "downloads", downloadId: 9 },
    });
    expect(recorder.released).toEqual([{ stagingName: "rec-id1", deleteStaging: true }]);
    expect(tabs.sent.filter((s) => s.message.type === KONVENE_TAB_MESSAGE).at(-1)?.message).toEqual({
      type: KONVENE_TAB_MESSAGE,
      recording: false,
    });
    expect(await controller.status()).toEqual({ phase: "idle" });
  });
  it("keeps the staged file and marks the record unfinished when saving fails", async () => {
    const { controller, repo, output, recorder } = ctx;
    const { recordId } = await controller.start({ tabId: 4, consentConfirmed: false });
    output.fail = true;
    await expect(controller.stop()).rejects.toMatchObject({ code: "save-failed" });
    expect(await repo.get(recordId)).toMatchObject({ status: "unfinished", error: "disk full" });
    expect(recorder.released).toEqual([{ stagingName: "rec-id1", deleteStaging: false }]);
  });
  it("treats an empty capture as a failure and cleans up", async () => {
    const { controller, repo, recorder } = ctx;
    const { recordId } = await controller.start({ tabId: 4, consentConfirmed: false });
    recorder.capture = { ...recorder.capture, sizeBytes: 0 };
    await expect(controller.stop()).rejects.toMatchObject({ code: "capture-failed" });
    expect(await repo.get(recordId)).toMatchObject({ status: "failed", error: "Nothing was recorded." });
  });
  it("says so when nothing is recording", async () => {
    await expect(ctx.controller.stop()).rejects.toMatchObject({ code: "not-found" });
  });
});
describe("recorder ended by itself", () => {
  it("saves the recording when the call tab is closed", async () => {
    const { controller, repo, output, recorder } = setup();
    const { recordId } = await controller.start({ tabId: 1, consentConfirmed: true });
    recorder.recording = false;
    await controller.handleEngineEnded({ ...recorder.capture, stagingName: "rec-id1" });
    expect(output.written).toHaveLength(1);
    expect((await repo.get(recordId))?.status).toBe("saved");
  });
  it("ignores an ending that matches no running recording", async () => {
    const { controller, output, recorder } = setup();
    await controller.handleEngineEnded({ ...recorder.capture, stagingName: "rec-unknown" });
    expect(output.written).toHaveLength(0);
  });
});
describe("status, recovery and removal", () => {
  it("marks a recording unfinished when the engine is gone after a restart", async () => {
    const { controller, recorder, repo } = setup();
    const { recordId } = await controller.start({ tabId: 1, consentConfirmed: true });
    recorder.recording = false; // the browser was closed mid call
    expect(await controller.status()).toEqual({ phase: "idle" });
    expect(await repo.get(recordId)).toMatchObject({ status: "unfinished" });
  });
  it("reports a live recording with its site and title", async () => {
    const { controller } = setup();
    const { recordId } = await controller.start({ tabId: 1, consentConfirmed: true });
    expect(await controller.status()).toMatchObject({ phase: "recording", recordId, siteName: "Google Meet", tabTitle: "Meet - abc" });
  });
  it("recovers an unfinished recording through the same export path", async () => {
    const { controller, recorder, repo, output } = setup();
    const { recordId } = await controller.start({ tabId: 1, consentConfirmed: true });
    recorder.recording = false;
    await controller.list();
    await controller.recover(recordId);
    expect(output.written).toHaveLength(1);
    expect((await repo.get(recordId))?.status).toBe("saved");
  });
  it("refuses to recover a recording that is already saved", async () => {
    const { controller } = setup();
    const { recordId } = await controller.start({ tabId: 1, consentConfirmed: true });
    await controller.stop();
    await expect(controller.recover(recordId)).rejects.toMatchObject({ code: "busy" });
  });
  it("lists newest first", async () => {
    const { controller, repo } = setup();
    const base = {
      endedAt: 0,
      siteId: "web",
      siteName: "x",
      host: "x",
      tabTitle: "",
      tabId: 1,
      stagingName: "s",
      fileName: "f",
      mimeType: "m",
      status: "saved",
    };
    await repo.save({ ...base, id: "a", startedAt: 1 });
    await repo.save({ ...base, id: "b", startedAt: 3 });
    await repo.save({ ...base, id: "c", startedAt: 2 });
    expect((await controller.list()).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
  it("removes a record and, when asked, the saved file", async () => {
    const { controller, repo, files } = setup();
    const { recordId } = await controller.start({ tabId: 1, consentConfirmed: true });
    await controller.stop();
    await controller.remove(recordId, true);
    expect(files.removed).toHaveLength(1);
    expect(await repo.get(recordId)).toBeUndefined();
  });
  it("will not remove a recording that is still running", async () => {
    const { controller } = setup();
    const { recordId } = await controller.start({ tabId: 1, consentConfirmed: true });
    await expect(controller.remove(recordId, false)).rejects.toMatchObject({ code: "busy" });
  });
  it("reveals a saved file and refuses when there is none", async () => {
    const { controller, files } = setup();
    const { recordId } = await controller.start({ tabId: 1, consentConfirmed: true });
    await expect(controller.reveal(recordId)).rejects.toMatchObject({ code: "not-found" });
    await controller.stop();
    await controller.reveal(recordId);
    expect(files.revealed).toHaveLength(1);
  });
});
describe("shares offered by the call page", () => {
  const OFFER = { shareId: "share-1", kind: "screen", offer: "sdp-offer" };

  it("takes the sound of a share from the tab being recorded", async () => {
    const { controller, recorder } = setup();
    await controller.start({ tabId: 1, consentConfirmed: true });
    expect(await controller.acceptShare(OFFER, { tabId: 1 })).toEqual({ answer: "answer-for-share-1" });
    expect(recorder.offers).toEqual([OFFER]);
  });

  it("ignores a share when nothing is being recorded", async () => {
    const { controller, recorder } = setup();
    expect(await controller.acceptShare(OFFER, { tabId: 1 })).toEqual({ answer: null });
    expect(recorder.offers).toHaveLength(0);
  });

  it("ignores a share from any tab other than the one being recorded", async () => {
    const { controller, recorder } = setup();
    await controller.start({ tabId: 1, consentConfirmed: true });
    expect(await controller.acceptShare(OFFER, { tabId: 2 })).toEqual({ answer: null });
    expect(await controller.acceptShare(OFFER, {})).toEqual({ answer: null });
    expect(recorder.offers).toHaveLength(0);
  });

  it("answers 'not recorded' when the recorder cannot take the sound, so the page lets go", async () => {
    const { controller, recorder } = setup();
    await controller.start({ tabId: 1, consentConfirmed: true });
    recorder.failShare = true;
    expect(await controller.acceptShare(OFFER, { tabId: 1 })).toEqual({ answer: null });
  });

  it("passes on the end of a share, but only from the recorded tab", async () => {
    const { controller, recorder } = setup();
    await controller.start({ tabId: 1, consentConfirmed: true });
    await controller.endShare({ shareId: "share-1" }, { tabId: 2 });
    expect(recorder.endedShares).toEqual([]);
    await controller.endShare({ shareId: "share-1" }, { tabId: 1 });
    expect(recorder.endedShares).toEqual(["share-1"]);
  });

  it("tells the call page when the recording starts and stops, so it can offer or drop its shares", async () => {
    const { controller, tabs } = setup();
    await controller.start({ tabId: 1, consentConfirmed: true });
    await controller.stop();
    const states = tabs.sent.filter((s) => s.message.type === RECORDING_STATE_MESSAGE).map((s) => s.message.recording);
    expect(states).toEqual([true, false]);
  });
});
