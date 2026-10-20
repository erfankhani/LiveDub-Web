const apiKeyInput = document.getElementById("apiKey");
const targetLangSelect = document.getElementById("targetLang");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

chrome.storage.local.get(["apiKey", "targetLang", "isDubbing"], (data) => {
  if (data.apiKey) apiKeyInput.value = data.apiKey;
  if (data.targetLang) targetLangSelect.value = data.targetLang;
  if (data.isDubbing) {
    startBtn.style.display = "none";
    stopBtn.style.display = "block";
  }
});

startBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  const targetLang = targetLangSelect.value;
  if (!apiKey) return alert("لطفاً Gemini API Key را وارد کنید.");

  await chrome.storage.local.set({ apiKey, targetLang, isDubbing: true });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return alert("تب فعالی پیدا نشد.");

  chrome.runtime.sendMessage({
    action: "START_DUBBING",
    tabId: tab.id,
    apiKey,
    targetLang,
  });

  startBtn.style.display = "none";
  stopBtn.style.display = "block";
});

stopBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ isDubbing: false });
  chrome.runtime.sendMessage({ action: "STOP_DUBBING" });
  startBtn.style.display = "block";
  stopBtn.style.display = "none";
});
