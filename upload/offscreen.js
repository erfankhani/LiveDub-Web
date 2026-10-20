let mediaStream = null;
let audioContext = null;
let scriptNode = null;
let playbackContext = null;
let nextPlayTime = 0;
let websocket = null;
let isDubbing = false;
let currentApiKey = "";
let currentTargetLang = "fa";

// ~100ms chunks at 16kHz
// به‌جای 1600 (۱۰۰ms)
const CHUNK_SAMPLES = 800; // ~۵۰ms

let pcmBuffer = [];

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "START_RECORDING") {
    startDubbing(msg.streamId, msg.apiKey, msg.targetLang);
  } else if (msg.action === "STOP_RECORDING") {
    stopDubbing();
  }
});

async function startDubbing(streamId, apiKey, targetLang) {
  try {
    currentApiKey = apiKey;
    currentTargetLang = targetLang || "fa";
    isDubbing = true;
    pcmBuffer = [];

    // Playback context for 24kHz output
    playbackContext = new AudioContext({
      sampleRate: 24000,
      latencyHint: "interactive", // مهم
    });
    if (playbackContext.state === "suspended") await playbackContext.resume();
    nextPlayTime = playbackContext.currentTime;

    // Capture tab audio
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });

    // Play original audio at low volume (like LivDub ducking)
    const bgAudio = new Audio();
    bgAudio.srcObject = mediaStream;
    bgAudio.volume = 0.15;
    await bgAudio.play().catch(() => {});

    // Capture context at 16kHz
    audioContext = new AudioContext({
      sampleRate: 16000,
      latencyHint: "interactive",
    });
    await audioContext.audioWorklet.addModule("pcm-processor.js");

    const source = audioContext.createMediaStreamSource(mediaStream);
    const workletNode = new AudioWorkletNode(audioContext, "pcm-processor");

    workletNode.port.onmessage = (e) => {
      if (!isDubbing || !websocket || websocket.readyState !== WebSocket.OPEN)
        return;
      const float32Chunk = e.data;
      sendPCMChunk(float32Chunk);
    };

    source.connect(workletNode);
    const silent = audioContext.createGain();
    silent.gain.value = 0;
    workletNode.connect(silent);
    silent.connect(audioContext.destination);

    await connectWebSocket();

    console.log("[LiveDub] Live Translate pipeline started");
  } catch (err) {
    console.error("[LiveDub] Start error:", err);
  }
}

async function connectWebSocket() {
  const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${currentApiKey}`;

  websocket = new WebSocket(WS_URL);

  websocket.onopen = () => {
    console.log("[LiveDub] WebSocket connected");
    const setup = {
      setup: {
        model: "models/gemini-3.5-live-translate-preview",
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
    websocket.send(JSON.stringify(setup));
  };

  websocket.onmessage = async (event) => {
    try {
      const text =
        event.data instanceof Blob ? await event.data.text() : event.data;
      const msg = JSON.parse(text);

      if (msg.setupComplete) {
        console.log("[LiveDub] Setup complete");
        return;
      }
      if (msg.serverContent) {
        const content = msg.serverContent;

        if (content.inputTranscription?.text) {
          console.log("[LiveDub] Input:", content.inputTranscription.text);
        }
        if (content.outputTranscription?.text) {
          console.log("[LiveDub] Output:", content.outputTranscription.text);
        }

        if (content.modelTurn?.parts) {
          for (const part of content.modelTurn.parts) {
            if (part.inlineData?.data) {
              playTranslatedAudio(part.inlineData.data);
            }
          }
        }
      }
    } catch (e) {
      console.error("[LiveDub] Message parse error:", e);
    }
  };

  websocket.onerror = (err) => {
    console.error("[LiveDub] WebSocket error:", err);
  };

  websocket.onclose = (e) => {
    console.log("[LiveDub] WebSocket closed:", e.code, e.reason);
    if (isDubbing) {
      // Optional: simple reconnect could be added here
    }
  };
}

function sendPCMChunk(float32Array) {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) return;

  // Float32 [-1,1] → Int16 little-endian
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  // Base64
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  const message = {
    realtimeInput: {
      audio: {
        data: base64,
        mimeType: "audio/pcm;rate=16000",
      },
    },
  };
  websocket.send(JSON.stringify(message));
}

function playTranslatedAudio(base64Audio) {
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
    source.connect(playbackContext.destination);

    const now = playbackContext.currentTime;
    // اگر بیش از ۸۰ms عقب افتاده، از نو شروع کن
    if (nextPlayTime < now || nextPlayTime - now > 0.08) {
      nextPlayTime = now + 0.005;
    }
    source.start(nextPlayTime);
    nextPlayTime += buffer.duration;
  } catch (e) {
    console.error("[LiveDub] Playback error:", e);
  }
}

function stopDubbing() {
  isDubbing = false;
  if (websocket) {
    websocket.close();
    websocket = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  if (playbackContext) {
    playbackContext.close().catch(() => {});
    playbackContext = null;
  }
  pcmBuffer = [];
  console.log("[LiveDub] Stopped");
}
