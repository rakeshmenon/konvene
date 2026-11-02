/**
 * Chrome stops an idle service worker after about half a minute. Saving a long recording can take longer than that
 * without any event, so while a long job runs we make a harmless extension call now and then to keep it awake.
 */
export async function withKeepAlive(job, everyMs = 20_000) {
  const timer = setInterval(() => {
    void chrome.runtime.getPlatformInfo();
  }, everyMs);
  try {
    return await job();
  } finally {
    clearInterval(timer);
  }
}
