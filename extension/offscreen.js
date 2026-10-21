/**
 * LiveDub v2 — Offscreen Document (موتور اصلی دوبله)
 *
 * ─────────────────────────────────────────────────────────────
 *  رفع باگ «هر ۱۵ دقیقه قطع می‌شد»:
 *  سرور Gemini Live API سشن WebSocket را به‌صورت خودکار بعد از
 *  حدود ۱۵ دقیقه می‌بندد. راه‌حل: Session Rotation —
 *   ۱) دقیقه ~۱۳.۵ یک سوکتِ جدید به‌موازات سوکت فعال باز می‌شود
 *   ۲) صدا در بافر موقت ذخیره می‌شود تا setup سشن جدید کامل شود
 *   ۳) سوکت قدیمی بسته و سوکت جدید به‌صورت Hot-Swap جایگزین می‌شود
 *   ۴) صدای بافرشده فلاش می‌شود → بدون هیچ وقفه‌ای دوبله ادامه دارد
 *  + Auto-Reconnect با Backoff نمایی برای قطعی‌های غیرمنتظره (اینترنت و ...)
 * ─────────────────────────────────────────────────────────────
 */

// ─────────────── ثابت‌ها ───────────────
const WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const MODEL = "models/gemini-3.5-live-translate-preview";

const SESSION_ROTATE_MS = 13.5 * 60 * 1000; // تمدید سشن قبل از سقف ~۱۵ دقیقه سرور
const RECONNECT_BASE_MS = 1200; // شروع backoff
const RECONNECT_MAX_MS = 10000; // سقف backoff
const CHUNK_SAMPLES = 800; // ~۵۰ms در ۱۶kHz
const MAX_PENDING_CHUNKS = 240; // ~۱۲ ثانیه بافر در زمان تعویض سشن
const CONNECT_TIMEOUT_MS = 12000;

// ─────────────── وضعیت ───────────────
let isDubbing = false;
let mediaStream = null;
let audioContext = null;
let workletNode = null;
let playbackContext = null;
let masterGain = null;
let bgAudio = null;
let nextPlayTime = 0;

let currentApiKey = "";
let currentTargetLang = "fa";

let activeSocket = null; // سوکت فعال (ارسال/دریافت)
let connectingSocket = null; // سوکت در حال اتصال (rotation/reconnect)
let rotationTimer = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let pendingChunks = []; // بافر صدا هنگام تعویض سشن

let sessionStartedAt = 0; // timestamp شروع دوبله (برای uptime)
let stats = { rotations: 0, reconnects: 0, lastError: "" };
let status = { state: "idle", reconnecting: false, message: "" };
let subtitles = []; // [{t, dir: 'in'|'out', text}]

// ─────────────── پیام‌ها ───────────────
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.action) {
    case "START_RECORDING":
      startDubbing(msg);
      break;
    case "STOP_RECORDING":
      stopDubbing();
      break;
    case "SET_VOLUMES":
      applyVolumes(msg.originalVolume, msg.dubbedVolume);
      break;
  }
});

// ─────────────── آغاز دوبله ───────────────
async function startDubbing(msg) {
  if (isDubbing) {
    console.warn("[LiveDub] قبلاً فعال است؛ ابتدا توقف…");
    stopDubbing();
    await new Promise((r) => setTimeout(r, 400));
  }

  currentApiKey = msg.apiKey;
  currentTargetLang = msg.targetLang || "fa";
  isDubbing = true;
  pcmReset();
  subtitles = [];
  stats = { rotations: 0, reconnects: 0, lastError: "" };
  reconnectAttempts = 0;
  sessionStartedAt = Date.now();

  setStatus({ state: "starting", reconnecting: false, message: "در حال آماده‌سازی…" });

  try {
    // کانتکست پخش ۲۴kHz برای صدای دوبله
    playbackContext = new AudioContext({ sampleRate: 24000, latencyHint: "interactive" });
    if (playbackContext.state === "suspended") await playbackContext.resume();
    nextPlayTime = playbackContext.currentTime;
    masterGain = playbackContext.createGain();
    masterGain.gain.value = msg.dubbedVolume !== undefined ? msg.dubbedVolume : 1.0;
    masterGain.connect(playbackContext.destination);

    // گرفتن صدای تب
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: msg.streamId,
        },
      },
      video: false,
    });

    // پخش صدای اصلی با حجم کم (ducking)
    const originalVol = msg.originalVolume !== undefined ? msg.originalVolume : 0.15;
    bgAudio = new Audio();
    bgAudio.srcObject = mediaStream;
    bgAudio.volume = originalVol;
    await bgAudio.play().catch(() => {});

    // کانتکست ضبط ۱۶kHz
    audioContext = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
    await audioContext.audioWorklet.addModule("pcm-processor.js");

    const source = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioContext, "pcm-processor");
    workletNode.port.onmessage = (e) => {
      if (!isDubbing) return;
      handleAudioChunk(e.data);
    };

    source.connect(workletNode);
    const silent = audioContext.createGain();
    silent.gain.value = 0;
    workletNode.connect(silent);
    silent.connect(audioContext.destination);

    // اتصال اول
    await openSocket("initial");

    setStatus({ state: "dubbing", reconnecting: false, message: "دوبله فعال ✅" });
    pushStatus(); // ارسال آمار اولیه
    console.log("[LiveDub] Live Translate pipeline started");
  } catch (err) {
    console.error("[LiveDub] Start error:", err);
    stats.lastError = String(err?.message || err);
    setStatus({ state: "error", reconnecting: false, message: stats.lastError });
  }
}

// ─────────────── مدیریت صدا: بافر هوشمند + ارسال ───────────────
function handleAudioChunk(float32Chunk) {
  const sock = activeSocket;
  if (sock && sock.readyState === WebSocket.OPEN) {
    sendPCMChunk(sock, float32Chunk);
  } else {
    // سوکت در حال تعویض/اتصال مجدد است → صدا را نگه می‌داریم
    if (pendingChunks.length < MAX_PENDING_CHUNKS) {
      pendingChunks.push(float32Chunk);
    } else {
      pendingChunks.shift(); // قدیمی‌ترین را دور می‌ریزیم (تنظیم جریان)
      pendingChunks.push(float32Chunk);
    }
  }
}

function flushPendingChunks() {
  const sock = activeSocket;
  if (!sock || sock.readyState !== WebSocket.OPEN) return;
  while (pendingChunks.length) {
    sendPCMChunk(sock, pendingChunks.shift());
  }
}

function pcmReset() {
  pendingChunks = [];
}

// ─────────────── اتصال WebSocket (هسته رفع باگ ۱۵ دقیقه) ───────────────

/**
 * باز کردن سوکت جدید.
 * mode = "initial"    → اتصال اول
 * mode = "rotate"     → تمدید سشن برنامه‌ریزی‌شده (قبل از سقف سرور)
 * mode = "reconnect"  → بازیابی پس از قطعی غیرمنتظره
 */
function openSocket(mode) {
  return new Promise((resolve, reject) => {
    if (!isDubbing) return reject(new Error("dubbing stopped"));

    const WS_URL = `${WS_BASE}?key=${encodeURIComponent(currentApiKey)}`;
    let settled = false;
    const ws = new WebSocket(WS_URL);

    // تایم‌اوت اتصال
    const connectTimeout = setTimeout(() => {
      if (settled) return;
      try { ws.close(); } catch {}
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      console.log(`[LiveDub] WebSocket connected (${mode})`);
      const setup = {
        setup: {
          model: MODEL,
          generationConfig: {
            responseModalities: ["AUDIO"],
            translationConfig: {
              targetLanguageCode: currentTargetLang,
              echoTargetLanguage: true,
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      };
      ws.send(JSON.stringify(setup));
    };

    ws.onmessage = (event) => handleSocketMessage(ws, event, mode);

    ws.onerror = (err) => {
      console.error(`[LiveDub] WebSocket error (${mode}):`, err);
    };

    ws.onclose = (e) => {
      clearTimeout(connectTimeout);
      console.warn(`[LiveDub] WebSocket closed (${mode}):`, e.code, e.reason || "");

      // اگر این سوکت، سوکتِ در حال اتصال بود و هنوز جا نیفتاده
      if (connectingSocket === ws) connectingSocket = null;
      if (!settled) {
        settled = true;
        reject(new Error(`ws closed ${e.code}`));
        return;
      }
      // اگر این سوکت، سوکتِ فعال بود → قطعیت شده → بازیابی
      if (ws === activeSocket && isDubbing) {
        activeSocket = null;
        scheduleReconnect();
      }
    };

    connectingSocket = ws;

    // resolve پس از آماده شدن کامل (setupComplete) — در handleSocketMessage
    ws._onReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimeout);
      activateSocket(ws, mode);
      resolve();
    };
    ws._mode = mode;
  });
}

/** سوکت آماده را فعال می‌کند (Hot-Swap) */
function activateSocket(ws, mode) {
  const old = activeSocket;
  activeSocket = ws;
  connectingSocket = null;

  if (old && old !== ws) {
    try { old.onmessage = null; old.onclose = null; old.onerror = null; old.close(); } catch {}
  }

  reconnectAttempts = 0; // اتصال سالم → ریست backoff
  flushPendingChunks();  // فلاش صدای بافرشده

  if (mode === "rotate") {
    stats.rotations++;
    setStatus({ message: `سشن تمدید شد (#${stats.rotations}) — بدون قطعی ✅` });
  } else if (mode === "reconnect") {
    setStatus({ reconnecting: false, message: "اتصال برقرار شد ✅" });
  }

  scheduleRotation(); // برنامه‌ریزی تمدید بعدی
  pushStatus();
}

/** تمدید سشن هر ~۱۳.۵ دقیقه (قبل از بسته‌شدن توسط سرور) */
function scheduleRotation() {
  clearTimeout(rotationTimer);
  if (!isDubbing) return;
  rotationTimer = setTimeout(async () => {
    if (!isDubbing) return;
    if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
      console.log("[LiveDub] شروع Session Rotation (تمدید سشن)…");
      setStatus({ message: "تمدید خودکار سشن…" });
      try {
        await openSocket("rotate");
      } catch {
        // rotation ناموفق → سوکت فعال هنوز کار می‌کند؛ دوباره تلاش می‌کنیم
        scheduleRotation();
      }
    } else {
      scheduleRotation();
    }
  }, SESSION_ROTATE_MS);
}

/** بازیابی پس از قطعی با backoff نمایی */
function scheduleReconnect() {
  if (!isDubbing) return;
  clearTimeout(reconnectTimer);

  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
  reconnectAttempts++;
  stats.reconnects++;

  setStatus({
    state: "dubbing",
    reconnecting: true,
    message: `قطع شد؛ اتصال مجدد در ${(delay / 1000).toFixed(1)}s (تلاش ${reconnectAttempts})`,
  });
  pushStatus();

  reconnectTimer = setTimeout(async () => {
    if (!isDubbing) return;
    try {
      await openSocket("reconnect");
    } catch {
      scheduleReconnect(); // دوباره تلاش کن
    }
  }, delay);
}

// ─────────────── پیام‌های سرور ───────────────
function handleSocketMessage(ws, event, mode) {
  if (event.data instanceof Blob) {
    event.data.text().then((t) => processServerMessage(ws, t)).catch(() => {});
  } else {
    processServerMessage(ws, event.data);
  }
}

function processServerMessage(ws, text) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch (e) {
    return;
  }

  // ⭐ تأیید سشن جدید → فعال‌سازی (نقطه کلیدی Hot-Swap)
  if (msg.setupComplete) {
    console.log("[LiveDub] Setup complete");
    if (ws && ws._onReady) ws._onReady();
    return;
  }

  if (msg.goAway) {
    // سرور اعلام می‌کند سشن رو به پایان است → فوری تمدید کن
    console.warn("[LiveDub] goAway received → rotate now");
    if (isDubbing && activeSocket === ws) {
      openSocket("rotate").catch(() => scheduleRotation());
    }
    return;
  }

  const content = msg.serverContent;
  if (!content) return;

  if (content.interrupted) {
    nextPlayTime = playbackContext ? playbackContext.currentTime + 0.005 : 0;
  }

  if (content.inputTranscription?.text) {
    pushSubtitle("in", content.inputTranscription.text);
  }
  if (content.outputTranscription?.text) {
    pushSubtitle("out", content.outputTranscription.text);
  }

  if (content.modelTurn?.parts) {
    for (const part of content.modelTurn.parts) {
      if (part.inlineData?.data) {
        playTranslatedAudio(part.inlineData.data);
      }
    }
  }
}

// ─────────────── ارسال صدا ───────────────
function sendPCMChunk(sock, float32Array) {
  if (!sock || sock.readyState !== WebSocket.OPEN) return;

  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  const base64 = btoa(binary);

  sock.send(
    JSON.stringify({
      realtimeInput: {
        audio: { data: base64, mimeType: "audio/pcm;rate=16000" },
      },
    })
  );
}

// ─────────────── پخش صدای دوبله ───────────────
function playTranslatedAudio(base64Audio) {
  if (!playbackContext) return;
  try {
    const binary = atob(base64Audio);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);

    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    const buffer = playbackContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(masterGain || playbackContext.destination);

    const now = playbackContext.currentTime;
    // اگر بیش از ۸۰ms عقب افتاد، ری‌سنک
    if (nextPlayTime < now || nextPlayTime - now > 0.08) {
      nextPlayTime = now + 0.005;
    }
    source.start(nextPlayTime);
    nextPlayTime += buffer.duration;
  } catch (e) {
    console.error("[LiveDub] Playback error:", e);
  }
}

// ─────────────── ولوم‌ها ───────────────
function applyVolumes(originalVolume, dubbedVolume) {
  if (bgAudio) bgAudio.volume = originalVolume;
  if (masterGain) masterGain.gain.value = dubbedVolume;
}

// ─────────────── زیرنویس زنده ───────────────
let subtitleDirty = false;
function pushSubtitle(dir, text) {
  const t = (text || "").trim();
  if (!t) return;
  const last = subtitles[subtitles.length - 1];
  if (last && last.dir === dir && (last.text + " " + t).length < 90) {
    last.text = last.text + " " + t; // ادامه جمله قبلی
  } else {
    subtitles.push({ t: Date.now(), dir, text: t });
    if (subtitles.length > 60) subtitles.shift();
  }
  if (!subtitleDirty) {
    subtitleDirty = true;
    setTimeout(() => {
      subtitleDirty = false;
      pushStatus();
    }, 250); // throttle آپدیت popup
  }
}

// ─────────────── وضعیت ───────────────
function setStatus(patch) {
  status = { ...status, ...patch };
  pushStatus();
}

function pushStatus() {
  const payload = {
    state: status.state,
    reconnecting: status.reconnecting,
    message: status.message,
    startedAt: sessionStartedAt,
    rotations: stats.rotations,
    reconnects: stats.reconnects,
    lastError: stats.lastError,
    subtitles: subtitles.slice(-30),
  };
  try {
    chrome.runtime.sendMessage({ action: "DUB_STATUS", patch: payload }).catch(() => {});
  } catch (e) {
    /* ignore */
  }
}

// ─────────────── توقف ───────────────
function stopDubbing() {
  isDubbing = false;
  clearTimeout(rotationTimer);
  clearTimeout(reconnectTimer);

  if (activeSocket) {
    try { activeSocket.onmessage = null; activeSocket.onclose = null; activeSocket.close(); } catch {}
    activeSocket = null;
  }
  if (connectingSocket) {
    try { connectingSocket._onReady = null; connectingSocket.close(); } catch {}
    connectingSocket = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (bgAudio) {
    bgAudio.pause();
    bgAudio.srcObject = null;
    bgAudio = null;
  }
  if (audioContext) {
    try { audioContext.close(); } catch {}
    audioContext = null;
    workletNode = null;
  }
  if (playbackContext) {
    try { playbackContext.close(); } catch {}
    playbackContext = null;
    masterGain = null;
  }
  pcmReset();
  setStatus({ state: "idle", reconnecting: false, message: "" });
  console.log("[LiveDub] Stopped");
}
