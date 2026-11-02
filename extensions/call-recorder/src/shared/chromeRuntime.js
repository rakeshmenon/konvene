/** chrome.runtime seen through the small interface the messaging layer needs. */
export const chromeRuntime = {
  sendMessage: (message) => chrome.runtime.sendMessage(message),
  onMessage: {
    addListener: (listener) => chrome.runtime.onMessage.addListener(listener),
  },
};
