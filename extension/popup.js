/**
 * LiveDub v2 — Popup
 * رابط کاربری حرفه‌ای + آمار زنده + زیرنویس زنده + کنترل ولوم
 */

const $ = (id) => document.getElementById(id);

const apiKeyInput = $("apiKey");
const targetLangSelect = $("targetLang");
const origVolSlider = $("origVol");
const dubVolSlider = $("dubVol");
const startBtn = $("startBtn");
const stopBtn = $("stopBtn");
const eyeBtn = $("eyeBtn");

const statusDot = $("statusDot");
const statusText = $("statusText");
const banner = $("banner");
const bannerText = $("bannerText");
const errLine = $("errLine");
const statsEl = $("stats");
const uptimeEl = $("uptime");
const rotationsEl = $("rotations");
const reconnectsEl = $("reconnects");
const subsEl = $("subs");
const subsBox = $("subsBox");

const faDigits = (s) => String(s).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);

let lastStatus = { state: "idle" };
let uptimeTimer = null;
let renderedSubsKey = "";

// ─────────────── راه‌اندازی ───────────────
chrome.storage.local.get(
  ["apiKey", "targetLang", "origVol", "dubVol", "isDubbing", "dubStatus"],
  (d) => {
    if (d.apiKey) apiKeyInput.value = d.apiKey;
    if (d.targetLang) targetLangSelect.value = d.targetLang;
    if (d.origVol !== undefined) origVolSlider.value = d.origVol;
    if (d.dubVol !== undefined) dubVolSlider.value = d.dubVol;
    updateSliderFill(origVolSlider, $("origVal"), "صدای اصلی");
    updateSliderFill(dubVolSlider, $("dubVal"), "صدای دوبله");

    const st = d.dubStatus || {};
    if (st.state === "dubbing" || st.state === "starting") {
      lastStatus = st;
      applyStatus(st);
    }
  }
);

// ─────────────── رویدادها ───────────────
eyeBtn.addEventListener("click", () => {
  apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
});

function onSlider(id, valId, label, key) {
  const slider = $(id);
  slider.addEventListener("input", () => {
    updateSliderFill(slider, $(valId), label);
    const v = Number(slider.value);
    chrome.storage.local.set({ [key]: v });
    // اعمال زنده بدون نیاز به استارت مجدد
    chrome.runtime.sendMessage({
      action: "SET_VOLUMES",
      originalVolume: Number(origVolSlider.value) / 100,
      dubbedVolume: Number(dubVolSlider.value) / 100,
    }).catch(() => {});
  });
}
onSlider("origVol", "origVal", "صدای اصلی", "origVol");
onSlider("dubVol", "dubVal", "صدای دوبله", "dubVol");

function updateSliderFill(slider, valEl, label) {
  const v = Number(slider.value);
  slider.style.setProperty("--fill", v + "%");
  valEl.textContent = label === "صدای اصلی" ? faDigits(v + "٪") : faDigits(v + "٪");
}

startBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    apiKeyInput.focus();
    apiKeyInput.style.borderColor = "var(--danger)";
    setTimeout(() => (apiKeyInput.style.borderColor = ""), 1500);
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const origVol = Number(origVolSlider.value) / 100;
  const dubVol = Number(dubVolSlider.value) / 100;

  await chrome.storage.local.set({
    apiKey,
    targetLang: targetLangSelect.value,
    origVol: Number(origVolSlider.value),
    dubVol: Number(dubVolSlider.value),
    isDubbing: true,
  });
  // ریست وضعیت برای جلسه جدید
  await chrome.storage.local.set({
    dubStatus: { state: "starting", reconnecting: false, message: "در حال آماده‌سازی…", startedAt: Date.now(), rotations: 0, reconnects: 0, subtitles: [] },
  });

  chrome.runtime.sendMessage({
    action: "START_DUBBING",
    tabId: tab.id,
    apiKey,
    targetLang: targetLangSelect.value,
    originalVolume: origVol,
    dubbedVolume: dubVol,
  });

  applyStatus({ state: "starting", reconnecting: false, message: "در حال آماده‌سازی…" });
});

stopBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ isDubbing: false });
  chrome.runtime.sendMessage({ action: "STOP_DUBBING" });
  applyStatus({ state: "idle" });
});

// ─────────────── دریافت وضعیت زنده ───────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "DUB_STATUS" && msg.patch) {
    lastStatus = { ...lastStatus, ...msg.patch };
    applyStatus(lastStatus);
  }
});

function applyStatus(st) {
  const state = st.state || "idle";
  const dubbing = state === "dubbing" || state === "starting";
  const reconnecting = !!st.reconnecting;

  startBtn.style.display = dubbing ? "none" : "flex";
  stopBtn.style.display = dubbing ? "flex" : "none";
  statsEl.classList.toggle("show", dubbing);
  subsEl.classList.toggle("show", dubbing);
  errLine.style.display = state === "error" && st.lastError ? "block" : "none";
  if (state === "error" && st.lastError) errLine.textContent = "⚠ " + st.lastError;

  // pill
  statusDot.className = "dot";
  if (reconnecting) {
    statusDot.classList.add("warn");
    statusText.textContent = "اتصال مجدد…";
  } else if (state === "dubbing") {
    statusDot.classList.add("live");
    statusText.textContent = "در حال دوبله";
  } else if (state === "starting") {
    statusDot.classList.add("warn");
    statusText.textContent = "آماده‌سازی…";
  } else if (state === "error") {
    statusDot.classList.add("err");
    statusText.textContent = "خطا";
  } else {
    statusText.textContent = "غیرفعال";
  }

  // بنر بازاتصال
  banner.classList.toggle("show", reconnecting);
  if (reconnecting && st.message) bannerText.textContent = st.message;

  // آمار
  if (dubbing) {
    rotationsEl.textContent = faDigits(st.rotations ?? 0);
    reconnectsEl.textContent = faDigits(st.reconnects ?? 0);
    startUptimeTimer(st.startedAt || Date.now());
    renderSubs(st.subtitles || []);
  } else {
    stopUptimeTimer();
  }
}

// ─────────────── تایمر uptime ───────────────
function startUptimeTimer(startedAt) {
  if (uptimeTimer) return;
  const tick = () => {
    const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    uptimeEl.textContent = faDigits(`${m}:${String(sec).padStart(2, "0")}`);
  };
  tick();
  uptimeTimer = setInterval(tick, 1000);
}
function stopUptimeTimer() {
  if (uptimeTimer) clearInterval(uptimeTimer);
  uptimeTimer = null;
}

// ─────────────── زیرنویس زنده ───────────────
function renderSubs(list) {
  const key = list.map((s) => s.t + s.dir + s.text).join("|");
  if (key === renderedSubsKey) return;
  renderedSubsKey = key;

  if (!list.length) {
    subsBox.innerHTML = `<div class="subs-empty">با شروع دوبله، متن گفتار اینجا نمایش داده می‌شود…</div>`;
    return;
  }
  subsBox.innerHTML = "";
  for (const s of list.slice(-20)) {
    const div = document.createElement("div");
    div.className = "sub " + s.dir;
    div.textContent = s.text;
    subsBox.appendChild(div);
  }
  subsBox.scrollTop = subsBox.scrollHeight;
}
