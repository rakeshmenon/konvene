import { describe, expect, it, vi } from "vitest";
import { createSiteRegistry } from "../src/domain/sites/defaultSites.js";
import { KONVENE_TAB_MESSAGE } from "../src/domain/sites/konveneProtocol.js";
const registry = createSiteRegistry();
describe("SiteRegistry", () => {
  it("recognises Konvene by origin and lets it show a badge", () => {
    const info = registry.describe("https://konvene-calls.netlify.app/abc-def-ghj", "Konvene call");
    expect(info).toMatchObject({ siteId: "konvene", siteName: "Konvene", consent: "badge", host: "konvene-calls.netlify.app" });
  });
  it("recognises the local dev origin", () => {
    expect(registry.describe("http://localhost:8790/x", "t").siteId).toBe("konvene");
  });
  it("recognises Google Meet and asks the recorder to confirm", () => {
    const info = registry.describe("https://meet.google.com/abc-defg-hij", "Meet - abc-defg-hij");
    expect(info).toMatchObject({
      siteId: "google-meet",
      siteName: "Google Meet",
      consent: "recorder-confirms",
      tabTitle: "Meet - abc-defg-hij",
    });
  });
  it("uses the generic adapter for any other site, named by host", () => {
    const info = registry.describe("https://whereby.com/room", "Room");
    expect(info).toMatchObject({ siteId: "web", siteName: "whereby.com", consent: "recorder-confirms" });
  });
  it("does not throw on an address it cannot parse", () => {
    expect(registry.describe("not a url", "x").siteId).toBe("web");
  });
});
describe("site announcements", () => {
  it("Konvene sends the recording state to the tab", async () => {
    const send = vi.fn().mockResolvedValue({ shown: true });
    const { adapter } = registry.resolve("https://konvene-calls.netlify.app/x");
    await adapter.announce(7, true, { send });
    expect(send).toHaveBeenCalledWith(7, { type: KONVENE_TAB_MESSAGE, recording: true });
  });
  it("Konvene refuses to start when the page does not confirm the badge", async () => {
    const { adapter } = registry.resolve("https://konvene-calls.netlify.app/x");
    await expect(adapter.announce(7, true, { send: vi.fn().mockResolvedValue({ shown: false }) })).rejects.toThrow("did not confirm");
    await expect(adapter.announce(7, true, { send: vi.fn().mockResolvedValue(undefined) })).rejects.toThrow("did not confirm");
  });
  it("Konvene does not need a confirmation to switch the badge off", async () => {
    const { adapter } = registry.resolve("https://konvene-calls.netlify.app/x");
    await expect(adapter.announce(7, false, { send: vi.fn().mockResolvedValue(undefined) })).resolves.toBeUndefined();
  });
  it("confirm-only sites send nothing", async () => {
    const send = vi.fn();
    const { adapter } = registry.resolve("https://meet.google.com/x");
    await adapter.announce(7, true, { send });
    expect(send).not.toHaveBeenCalled();
  });
});
