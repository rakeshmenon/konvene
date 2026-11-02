// Composition root of the service worker. It builds the real objects, wires them together and answers messages.
// Nothing here makes a decision: the decisions are in RecordingController.
import { ExportService } from "../application/exportService.js";
import { KeyValueRecordingRepository, KeyValueSettingsStore } from "../application/keyValueRepositories.js";
import { ConfiguredOutputWriter, FolderOutputWriter } from "../application/outputWriters.js";
import { RecordingController } from "../application/recordingController.js";
import { createSiteRegistry } from "../domain/sites/defaultSites.js";
import { ChromeKeyValueStore } from "../infra/chromeKeyValueStore.js";
import { ChromeTabGateway } from "../infra/chromeTabGateway.js";
import { DownloadsFileGateway } from "../infra/downloadsFileGateway.js";
import { DownloadsOutputWriter } from "../infra/downloadsOutputWriter.js";
import { withKeepAlive } from "../infra/keepAlive.js";
import { OffscreenRecorderGateway } from "../infra/offscreenRecorderGateway.js";
import { CHANNEL } from "../shared/api.js";
import { chromeRuntime } from "../shared/chromeRuntime.js";
import { createCaller, serve } from "../shared/rpc.js";
import { randomIds, systemClock } from "../shared/system.js";
const store = new ChromeKeyValueStore();
const repo = new KeyValueRecordingRepository(store);
const settings = new KeyValueSettingsStore(store);
const recorder = new OffscreenRecorderGateway(createCaller(CHANNEL.offscreen, chromeRuntime));
const output = new ConfiguredOutputWriter(settings, new FolderOutputWriter(recorder), new DownloadsOutputWriter(), (reason) =>
  console.warn("Chosen folder not available, saved to Downloads instead", reason),
);
const controller = new RecordingController({
  tabs: new ChromeTabGateway(),
  recorder,
  repo,
  sites: createSiteRegistry(),
  exporter: new ExportService({ recorder, output, repo }),
  files: new DownloadsFileGateway(),
  settings,
  clock: systemClock,
  ids: randomIds,
});
serve(
  CHANNEL.background,
  {
    "site/describe": ({ tabId }) => controller.describeSite(tabId),
    "recording/start": (req) => controller.start(req),
    // Offers and ends come from the call page, through the share relay. Only the recorded tab is listened to.
    "share/offer": (offer, from) => controller.acceptShare(offer, from),
    "share/ended": async (msg, from) => {
      await controller.endShare(msg, from);
      return {};
    },
    "recording/stop": () => withKeepAlive(() => controller.stop()),
    "recording/status": () => controller.status(),
    "recording/levels": async () => ({ levels: await controller.levels() }),
    "recording/list": () => controller.list(),
    "recording/recover": async ({ recordId }) => {
      await withKeepAlive(() => controller.recover(recordId));
      return {};
    },
    "recording/remove": async ({ recordId, deleteFile }) => {
      await controller.remove(recordId, deleteFile);
      return {};
    },
    "recording/reveal": async ({ recordId }) => {
      await controller.reveal(recordId);
      return {};
    },
    "engine/ended": async ({ capture }) => {
      await withKeepAlive(() => controller.handleEngineEnded(capture));
      return {};
    },
  },
  chromeRuntime,
);
// First run: open the setup page, where the microphone is allowed and a folder can be chosen.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) void chrome.runtime.openOptionsPage();
});
