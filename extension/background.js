/**
 * LiveDub v2 — Background Service Worker (MV3)
 * مدیریت چرخه حیات: ساخت سند offscreen، گرفتن streamId تب، ارسال تنظیمات صدا
 */

const OFFSCREEN_URL = "offscreen.html";

// ---------- پیام‌ها ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case "START_DUBBING":
      handleStart(message);
      sendResponse({ status: "starting" });
      break;
    case "STOP_DUBBING":
      handleStop();
      sendResponse({ status: "stopping" });
      break;
    case "GET_OFFSCREEN_STATE":
      chrome.offscreen
        .hasDocument()
        .then((has) => sendResponse({ hasDocument: has }))
        .catch(() => sendResponse({ hasDocument: false }));
      return true; // async response
  }
  return true;
});

// ---------- شروع ----------
async function handleStart(message) {
  try {
    await ensureOffscreenDocument();

    chrome.tabCapture.getMediaStreamId(
      { targetTabId: message.tabId },
      (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          const reason =
            chrome.runtime.lastError?.message || "streamId دریافت نشد";
          console.error("[LiveDub BG] خطا در کپچر صدا:", reason);
          broadcastStatus({
            state: "error",
            lastError: "کپچر صدای تب ممکن نشد: " + reason,
          });
          return;
        }

        chrome.runtime
          .sendMessage({
            action: "START_RECORDING",
            streamId,
            apiKey: message.apiKey,
            targetLang: message.targetLang,
            originalVolume:
              message.originalVolume !== undefined
                ? message.originalVolume
                : 0.15,
            dubbedVolume:
              message.dubbedVolume !== undefined ? message.dubbedVolume : 1.0,
          })
          .catch(() => {});
      }
    );
  } catch (err) {
    console.error("[LiveDub BG] خطا در اجرای آف‌اسکرین:", err);
    broadcastStatus({ state: "error", lastError: String(err?.message || err) });
  }
}

// ---------- توقف ----------
async function handleStop() {
  try {
    chrome.runtime.sendMessage({ action: "STOP_RECORDING" }).catch(() => {});
    broadcastStatus({ state: "idle" });
    // کمی صبر می‌کنیم تا آف‌اسکرین منابع را آزاد کند، بعد سند را می‌بندیم
    setTimeout(async () => {
      try {
        if (await chrome.offscreen.hasDocument()) {
          await chrome.offscreen.closeDocument();
        }
      } catch (e) {
        /* ignore */
      }
    }, 700);
  } catch (e) {
    console.error("[LiveDub BG] خطا در توقف:", e);
  }
}

// ---------- سند Offscreen ----------
let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const has = await chrome.offscreen.hasDocument().catch(() => false);
  if (has) return;

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ["USER_MEDIA"],
        justification: "تبدیل و ضبط صدای تب برای دوبله زنده",
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
  // فرصت به سند برای بارگذاری و ثبت listener
  await new Promise((r) => setTimeout(r, 250));
}

// ---------- وضعیت ----------
function broadcastStatus(patch) {
  try {
    chrome.runtime.sendMessage({ action: "DUB_STATUS", patch }).catch(() => {});
  } catch (e) {
    /* ignore */
  }
}

// ---------- نگه‌داشتن وضعیت در storage (برای popup تازه‌باز‌شده) ----------
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "DUB_STATUS" && msg.patch) {
    chrome.storage.local.get("dubStatus", ({ dubStatus }) => {
      const next = { ...(dubStatus || {}), ...msg.patch };
      chrome.storage.local.set({ dubStatus: next });
    });
  }
});

console.log("[LiveDub BG] v2 service worker loaded");
