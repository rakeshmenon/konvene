export class ChromeTabGateway {
  async describe(tabId) {
    // The address and title are readable because the user just clicked the extension on this tab (activeTab).
    const tab = await chrome.tabs.get(tabId);
    return { url: tab.url ?? "", title: tab.title ?? "" };
  }
  captureStreamId(tabId) {
    return chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  }
  send(tabId, message) {
    return chrome.tabs.sendMessage(tabId, message);
  }
}
