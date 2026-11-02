import { describe, expect, it, vi } from "vitest";
import { KeyValueRecordingRepository, KeyValueSettingsStore } from "../src/application/keyValueRepositories.js";
import { ConfiguredOutputWriter, FallbackOutputWriter } from "../src/application/outputWriters.js";
import { AppError } from "../src/domain/errors.js";
import { createCaller, serve } from "../src/shared/rpc.js";
import { MemoryStore } from "./helpers/fakes.js";
const file = { stagingName: "s", fileName: "f.mp4", mimeType: "video/mp4", sizeBytes: 1, blobUrl: "blob:x" };
const writerReturning = (loc) => ({ write: vi.fn().mockResolvedValue(loc) });
const failingWriter = () => ({ write: vi.fn().mockRejectedValue(new Error("nope")) });
const DOWNLOADS = { kind: "downloads", downloadId: 1, path: "/d/f.mp4" };
const FOLDER = { kind: "folder", folderName: "Calls" };
describe("key value repositories", () => {
  const rec = (id) => ({
    id,
    startedAt: 1,
    status: "saved",
    siteId: "s",
    siteName: "S",
    host: "h",
    tabTitle: "t",
    tabId: 1,
    stagingName: id,
    fileName: "f",
    mimeType: "m",
  });
  it("keeps every record when many saves run at once", async () => {
    const repo = new KeyValueRecordingRepository(new MemoryStore());
    await Promise.all(["a", "b", "c", "d", "e"].map((id) => repo.save(rec(id))));
    expect((await repo.all()).map((r) => r.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("updates in place and removes", async () => {
    const repo = new KeyValueRecordingRepository(new MemoryStore());
    await repo.save(rec("a"));
    await repo.save({ ...rec("a"), status: "failed" });
    expect(await repo.all()).toHaveLength(1);
    expect((await repo.get("a"))?.status).toBe("failed");
    await repo.remove("a");
    expect(await repo.all()).toEqual([]);
  });
  it("reads settings with defaults and merges patches", async () => {
    const settings = new KeyValueSettingsStore(new MemoryStore());
    expect(await settings.read()).toEqual({ noiseReduction: true, folderName: null, setupDone: false });
    expect(await settings.write({ setupDone: true })).toEqual({
      noiseReduction: true,
      folderName: null,
      setupDone: true,
    });
    expect(await settings.write({ folderName: "Calls", noiseReduction: false })).toEqual({
      noiseReduction: false,
      folderName: "Calls",
      setupDone: true,
    });
  });
});
describe("output writers", () => {
  it("falls back when the first writer fails, and says why", async () => {
    const onFallback = vi.fn();
    const writer = new FallbackOutputWriter(failingWriter(), writerReturning(DOWNLOADS), onFallback);
    expect(await writer.write(file)).toEqual(DOWNLOADS);
    expect(onFallback).toHaveBeenCalledOnce();
  });
  it("does not touch the fallback when the first writer works", async () => {
    const fallback = writerReturning(DOWNLOADS);
    await new FallbackOutputWriter(writerReturning(FOLDER), fallback).write(file);
    expect(fallback.write).not.toHaveBeenCalled();
  });
  const settingsWith = (folderName) => ({
    read: async () => ({ noiseReduction: true, folderName, setupDone: true }),
    write: async () => ({ noiseReduction: true, folderName, setupDone: true }),
  });
  it("uses Downloads when no folder is chosen", async () => {
    const folder = writerReturning(FOLDER);
    const out = await new ConfiguredOutputWriter(settingsWith(null), folder, writerReturning(DOWNLOADS)).write(file);
    expect(out).toEqual(DOWNLOADS);
    expect(folder.write).not.toHaveBeenCalled();
  });
  it("uses the chosen folder, and Downloads if the folder cannot be written", async () => {
    expect(
      await new ConfiguredOutputWriter(settingsWith("Calls"), writerReturning(FOLDER), writerReturning(DOWNLOADS)).write(file),
    ).toEqual(FOLDER);
    expect(await new ConfiguredOutputWriter(settingsWith("Calls"), failingWriter(), writerReturning(DOWNLOADS)).write(file)).toEqual(
      DOWNLOADS,
    );
  });
});
describe("rpc", () => {
  /** Two ends of one wire: what one side sends, the other side's listener receives. */
  function wire() {
    const listeners = [];
    return {
      onMessage: {
        addListener: (l) => {
          listeners.push(l);
        },
      },
      sendMessage: (message) =>
        new Promise((resolve) => {
          let answered = false;
          for (const l of listeners) {
            const keep = l(message, {}, (reply) => {
              answered = true;
              resolve(reply);
            });
            if (keep === true) return;
          }
          if (!answered) resolve(undefined);
        }),
    };
  }
  it("delivers a typed request and returns the answer", async () => {
    const runtime = wire();
    serve(
      "background",
      {
        "recording/status": async () => ({ phase: "idle" }),
      },
      runtime,
    );
    const call = createCaller("background", runtime);
    expect(await call("recording/status", {})).toEqual({ phase: "idle" });
  });
  it("carries an error code across, so the caller can branch on it", async () => {
    const runtime = wire();
    serve(
      "background",
      {
        "recording/stop": async () => {
          throw new AppError("not-found", "Nothing is recording.");
        },
      },
      runtime,
    );
    const call = createCaller("background", runtime);
    await expect(call("recording/stop", {})).rejects.toMatchObject({ code: "not-found", message: "Nothing is recording." });
  });
  it("ignores messages for another channel", async () => {
    const runtime = wire();
    serve("background", { "recording/status": async () => ({ phase: "idle" }) }, runtime);
    const call = createCaller("offscreen", runtime);
    await expect(call("recording/status", {})).rejects.toThrow("No answer");
  });
  it("answers an unknown message with an error", async () => {
    const runtime = wire();
    serve("background", {}, runtime);
    const call = createCaller("background", runtime);
    await expect(call("recording/status", {})).rejects.toThrow("Unknown message");
  });
});
