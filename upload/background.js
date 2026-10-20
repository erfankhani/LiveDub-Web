chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "START_DUBBING") {
    handleStart(message);
    sendResponse({ status: "starting" });
  } else if (message.action === "STOP_DUBBING") {
    handleStop();
    sendResponse({ status: "stopping" });
  }
  return true;
});

async function handleStart(message) {
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["USER_MEDIA"],
        justification: "تبدیل و ضبط صدای تب برای دوبله زنده",
      });
      await new Promise((r) => setTimeout(r, 300));
    }

    chrome.tabCapture.getMediaStreamId(
      { targetTabId: message.tabId },
      (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          console.error("خطا در کپچر صدا:", chrome.runtime.lastError?.message);
          return;
        }

        chrome.runtime
          .sendMessage({
            action: "START_RECORDING",
            streamId: streamId,
            apiKey: message.apiKey,
            targetLang: message.targetLang,
          })
          .catch(() => {});
      }
    );
  } catch (err) {
    console.error("خطا در اجرای آف‌اسکرین:", err);
  }
}

async function handleStop() {
  chrome.runtime.sendMessage({ action: "STOP_RECORDING" }).catch(() => {});
  if (await chrome.offscreen.hasDocument()) {
    await chrome.offscreen.closeDocument();
  }
}
