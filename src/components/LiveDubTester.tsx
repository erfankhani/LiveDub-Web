"use client";

/**
 * LiveDubTester — پیش‌نمایش اجرایی موتور دوبله (همان پروتکل اپ اندروید)
 *
 * این کامپوننت دقیقاً همان کاری را می‌کند که GeminiLiveClient.kt + سرویس اندروید انجام می‌دهند:
 *  ضبط صدا → PCM 16kHz → WebSocket به Gemini Live Translate → پخش صدای دوبله 24kHz
 *  + Session Rotation هر ~۱۳.۵ دقیقه + Reconnect با Backoff + زیرنویس زنده + عیب‌یابی کامل
 *
 * برای تست: کلید Gemini API (aistudio.google.com) را وارد کنید، «شروع دوبله» را بزنید و
 * یک تب (مثلاً یوتیوب) را همراه با گزینه «اشتراک صدا» انتخاب کنید.
 * کلید API فقط در مرورگر شما ذخیره می‌شود.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BadgeCheck,
  CircleStop,
  Copy,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Mic,
  RefreshCw,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ─────────────── ثابت‌های پروتکل (یکسان با اپ اندروید) ───────────────
const WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const MODEL = "models/gemini-3.5-live-translate-preview";
const SESSION_ROTATE_MS = 13.5 * 60 * 1000; // تمدید قبل از سقف ~۱۵ دقیقه سرور
const RECONNECT_BASE_MS = 1200;
const RECONNECT_MAX_MS = 10000;
const MAX_PENDING_CHUNKS = 240; // ~۱۲ ثانیه بافر حین تعویض سشن
const CONNECT_TIMEOUT_MS = 12000;

type Phase = "idle" | "starting" | "connecting" | "live" | "rotating" | "reconnecting" | "error";

type Stats = {
  phase: Phase;
  message: string;
  rotations: number;
  reconnects: number;
  sentKb: number;
  recvKb: number;
  inputLevel: number;
  outputLevel: number;
  serverError: string;
};

type LogLine = { time: string; kind: "info" | "ok" | "warn" | "error"; msg: string };
type SubLine = { dir: "in" | "out"; text: string };

const INITIAL_STATS: Stats = {
  phase: "idle",
  message: "",
  rotations: 0,
  reconnects: 0,
  sentKb: 0,
  recvKb: 0,
  inputLevel: 0,
  outputLevel: 0,
  serverError: "",
};

const LANGS: Array<[string, string]> = [
  ["fa", "فارسی"],
  ["en", "انگلیسی"],
  ["ar", "عربی"],
  ["tr", "ترکی"],
  ["es", "اسپانیایی"],
  ["fr", "فرانسوی"],
  ["de", "آلمانی"],
  ["ru", "روسی"],
  ["hi", "هندی"],
  ["ur", "اردو"],
  ["zh-Hans", "چینی"],
  ["ja", "ژاپنی"],
  ["ko", "کره‌ای"],
];

function faNum(n: number | string): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

// ─────────────── موتور دوبله (پورت offscreen.js / GeminiLiveClient.kt) ───────────────

type EngineCallbacks = {
  onStats: (patch: Partial<Stats>) => void;
  onLog: (kind: LogLine["kind"], msg: string) => void;
  onTranscript: (dir: "in" | "out", text: string) => void;
  onStopped: (reason: string) => void;
};

class DubEngine {
  private apiKey: string;
  private targetLang: string;
  private source: "tab" | "mic";
  private cbs: EngineCallbacks;

  private running = false;
  private stream: MediaStream | null = null;
  private captureCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private playbackCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserTimer: ReturnType<typeof setInterval> | null = null;
  private nextPlayTime = 0;

  private activeSocket: WebSocket | null = null;
  private connectingSocket: WebSocket | null = null;
  private rotationTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private pendingChunks: Float32Array[] = [];

  private rotations = 0;
  private reconnects = 0;
  private sentBytes = 0;
  private recvAudioBytes = 0;
  private serverError = "";
  private lastLevelPush = 0;

  constructor(apiKey: string, targetLang: string, source: "tab" | "mic", cbs: EngineCallbacks) {
    this.apiKey = apiKey;
    this.targetLang = targetLang;
    this.source = source;
    this.cbs = cbs;
  }

  // ── شروع ──
  async start() {
    if (this.running) return;
    this.running = true;
    this.cbs.onStats({ phase: "starting", message: "در حال گرفتن صدای ورودی…" });

    try {
      // ۱) گرفتن صدا
      if (this.source === "tab") {
        this.stream = await navigator.mediaDevices.getDisplayMedia({
          video: true, // برای اشتراک تب لازم است؛ فقط از ویدیو استفاده نمی‌کنیم
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        const hasAudio = this.stream.getAudioTracks().length > 0;
        if (!hasAudio) {
          throw new Error(
            "هیچ صدایی در اشتراک نبود! هنگام انتخاب تب، حتماً گزینه «اشتراک صدا / Share tab audio» را فعال کنید."
          );
        }
        // اگر کاربر از نوار کروم «توقف اشتراک» را بزند
        this.stream.getVideoTracks().forEach((vt) =>
          vt.addEventListener("ended", () => {
            this.stop();
            this.cbs.onStopped("اشتراک صدا از سمت مرورگر متوقف شد");
          })
        );
        this.cbs.onLog("ok", "صدای تب گرفته شد ✓");
      } else {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        this.cbs.onLog("ok", "میکروفون فعال شد ✓");
      }

      // ۲) کانتکست پخش 24kHz برای صدای دوبله
      this.playbackCtx = new AudioContext({ sampleRate: 24000, latencyHint: "interactive" });
      if (this.playbackCtx.state === "suspended") await this.playbackCtx.resume();
      this.masterGain = this.playbackCtx.createGain();
      this.masterGain.connect(this.playbackCtx.destination);
      this.analyser = this.playbackCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.masterGain.connect(this.analyser);
      this.nextPlayTime = this.playbackCtx.currentTime;
      this.startOutputMeter();

      // ۳) کانتکست ضبط 16kHz + Worklet
      this.captureCtx = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
      if (this.captureCtx.state === "suspended") await this.captureCtx.resume();
      await this.captureCtx.audioWorklet.addModule("/livedub-pcm-processor.js");

      const srcNode = this.captureCtx.createMediaStreamSource(this.stream);
      this.workletNode = new AudioWorkletNode(this.captureCtx, "livedub-pcm");
      this.workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (!this.running) return;
        this.handleAudioChunk(e.data);
      };
      srcNode.connect(this.workletNode);
      const silent = this.captureCtx.createGain();
      silent.gain.value = 0;
      this.workletNode.connect(silent);
      silent.connect(this.captureCtx.destination);

      // ۴) اتصال اول
      this.cbs.onStats({ phase: "connecting", message: "اتصال به Gemini…" });
      await this.openSocket("initial");

      this.cbs.onStats({ phase: "live", message: "دوبله فعال ✅" });
      this.cbs.onLog("ok", "موتور دوبله شروع شد — محتوا را در همان تب پخش کنید");
      this.scheduleRotation();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.cbs.onLog("error", msg);
      this.cbs.onStats({ phase: "error", message: msg, serverError: msg });
      this.stop();
    }
  }

  // ── توقف ──
  stop() {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this.rotationTimer);
    clearTimeout(this.reconnectTimer);
    if (this.analyserTimer) clearInterval(this.analyserTimer);
    this.analyserTimer = null;

    if (this.activeSocket) {
      try {
        this.activeSocket.onmessage = null;
        this.activeSocket.onclose = null;
        this.activeSocket.onerror = null;
        this.activeSocket.close();
      } catch {
        /* ignore */
      }
      this.activeSocket = null;
    }
    if (this.connectingSocket) {
      try {
        this.connectingSocket.onclose = null;
        this.connectingSocket.close();
      } catch {
        /* ignore */
      }
      this.connectingSocket = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.workletNode = null;
    try {
      this.captureCtx?.close();
    } catch {
      /* ignore */
    }
    this.captureCtx = null;
    try {
      this.playbackCtx?.close();
    } catch {
      /* ignore */
    }
    this.playbackCtx = null;
    this.masterGain = null;
    this.analyser = null;
    this.pendingChunks = [];
    this.cbs.onStats({
      phase: "idle",
      message: "",
      inputLevel: 0,
      outputLevel: 0,
    });
    this.cbs.onLog("info", "دوبله متوقف شد");
  }

  /** تمدید دستی سشن (برای تست Rotation بدون انتظار ۱۳.۵ دقیقه) */
  rotateNow() {
    if (!this.running) return;
    if (this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN && !this.connectingSocket) {
      this.cbs.onLog("info", "تمدید دستی سشن (Session Rotation)…");
      this.cbs.onStats({ phase: "rotating", message: "تمدید سشن…" });
      this.openSocket("rotate").catch(() => {
        this.cbs.onLog("warn", "تمدید ناموفق بود — سشن فعلی همچنان فعال است");
        this.scheduleRotationRetry();
      });
    } else {
      this.cbs.onLog("warn", "الان امکان تمدید نیست (سوکت در حال تعویض است)");
    }
  }

  // ── جریان صدا ──
  private handleAudioChunk(chunk: Float32Array) {
    // سطح صدای ورودی (تا ۱۰ بار در ثانیه push شود)
    let max = 0;
    for (let i = 0; i < chunk.length; i++) {
      const a = Math.abs(chunk[i]);
      if (a > max) max = a;
    }
    const now = Date.now();
    if (now - this.lastLevelPush > 100) {
      this.lastLevelPush = now;
      this.cbs.onStats({ inputLevel: Math.min(1, max * 2.2) });
    }

    const sock = this.activeSocket;
    if (sock && sock.readyState === WebSocket.OPEN) {
      this.sendPcmChunk(sock, chunk);
    } else {
      if (this.pendingChunks.length >= MAX_PENDING_CHUNKS) this.pendingChunks.shift();
      this.pendingChunks.push(chunk);
    }
  }

  private flushPendingChunks() {
    const sock = this.activeSocket;
    if (!sock || sock.readyState !== WebSocket.OPEN) return;
    while (this.pendingChunks.length) {
      const c = this.pendingChunks.shift();
      if (c) this.sendPcmChunk(sock, c);
    }
  }

  private sendPcmChunk(sock: WebSocket, f32: Float32Array) {
    if (sock.readyState !== WebSocket.OPEN) return;
    const int16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const b64 = bytesToBase64(new Uint8Array(int16.buffer));
    sock.send(
      JSON.stringify({
        realtimeInput: {
          audio: { data: b64, mimeType: "audio/pcm;rate=16000" },
        },
      })
    );
    this.sentBytes += int16.length * 2;
  }

  // ── اتصال WebSocket + Session Rotation ──
  private openSocket(mode: "initial" | "rotate" | "reconnect"): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.running) return reject(new Error("stopped"));

      const ws = new WebSocket(`${WS_BASE}?key=${encodeURIComponent(this.apiKey)}`);
      let settled = false;
      this.connectingSocket = ws;

      const connectTimeout = setTimeout(() => {
        if (!settled) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
      }, CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        this.cbs.onLog("info", `WebSocket وصل شد (${mode})`);
        ws.send(
          JSON.stringify({
            setup: {
              model: MODEL,
              generationConfig: {
                responseModalities: ["AUDIO"],
                translationConfig: {
                  targetLanguageCode: this.targetLang,
                  echoTargetLanguage: true,
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          })
        );
      };

      ws.onmessage = (event) => {
        this.handleServerMessage(ws, event.data, mode).then((ready) => {
          if (ready && !settled) {
            settled = true;
            clearTimeout(connectTimeout);
            this.activateSocket(ws, mode);
            resolve();
          }
        });
      };

      ws.onerror = () => {
        /* جزئیات در onclose می‌آید */
      };

      ws.onclose = (e) => {
        clearTimeout(connectTimeout);
        this.cbs.onLog(
          e.code === 1000 ? "info" : "warn",
          `WebSocket بسته شد (کد ${e.code})${e.reason ? ` — ${e.reason}` : ""}`
        );
        if (this.connectingSocket === ws) this.connectingSocket = null;
        if (!settled) {
          settled = true;
          reject(new Error(`اتصال برقرار نشد (کد ${e.code})`));
          return;
        }
        if (ws === this.activeSocket && this.running) {
          this.activeSocket = null;
          this.scheduleReconnect();
        }
      };
    });
  }

  private activateSocket(ws: WebSocket, mode: "initial" | "rotate" | "reconnect") {
    const old = this.activeSocket;
    this.activeSocket = ws;
    this.connectingSocket = null;

    if (old && old !== ws) {
      try {
        old.onmessage = null;
        old.onclose = null;
        old.onerror = null;
        old.close();
      } catch {
        /* ignore */
      }
    }

    this.reconnectAttempts = 0;
    this.flushPendingChunks();

    if (mode === "rotate") {
      this.rotations++;
      this.cbs.onLog("ok", `سشن تمدید شد (#${this.rotations}) — بدون هیچ وقفه‌ای`);
      this.cbs.onStats({ phase: "live", message: `سشن تمدید شد (#${this.rotations}) ✅`, rotations: this.rotations });
    } else if (mode === "reconnect") {
      this.cbs.onLog("ok", "اتصال برقرار شد ✓");
      this.cbs.onStats({ phase: "live", message: "اتصال برقرار شد ✅" });
    }
    this.pushKb();
    this.scheduleRotation();
  }

  private scheduleRotation() {
    clearTimeout(this.rotationTimer);
    if (!this.running) return;
    this.rotationTimer = setTimeout(() => {
      if (!this.running) return;
      if (this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN && !this.connectingSocket) {
        this.cbs.onLog("info", "Session Rotation خودکار — باز کردن سشن جدید…");
        this.cbs.onStats({ phase: "rotating", message: "تمدید خودکار سشن…" });
        this.openSocket("rotate").catch(() => this.scheduleRotationRetry());
      } else {
        this.scheduleRotation();
      }
    }, SESSION_ROTATE_MS);
  }

  private scheduleRotationRetry() {
    clearTimeout(this.rotationTimer);
    if (!this.running) return;
    this.rotationTimer = setTimeout(() => {
      if (this.running) this.scheduleRotation();
    }, 5000);
  }

  private scheduleReconnect() {
    if (!this.running) return;
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts), RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    this.reconnects++;
    this.cbs.onLog("warn", `قطع شد؛ تلاش مجدد در ${(delay / 1000).toFixed(1)}s (تلاش ${this.reconnectAttempts})`);
    this.cbs.onStats({
      phase: "reconnecting",
      message: `قطع شد؛ اتصال مجدد در ${(delay / 1000).toFixed(1)} ثانیه…`,
      reconnects: this.reconnects,
    });
    this.pushKb();
    this.reconnectTimer = setTimeout(() => {
      if (!this.running) return;
      this.openSocket("reconnect").catch(() => this.scheduleReconnect());
    }, delay);
  }

  // ── پیام‌های سرور ──
  private async handleServerMessage(
    ws: WebSocket,
    data: unknown,
    mode: "initial" | "rotate" | "reconnect"
  ): Promise<boolean> {
    let text: string;
    if (data instanceof Blob) {
      text = await data.text();
    } else if (typeof data === "string") {
      text = data;
    } else {
      return false;
    }

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return false;
    }

    if (msg.setupComplete) {
      this.cbs.onLog("ok", `Setup complete (${mode}) ✓`);
      return true;
    }

    // ⭐ خطاهای سرور — مثل کلید نامعتبر / دسترسی به مدل / کوتا
    if (msg.error) {
      const err = msg.error as { message?: string; code?: number; status?: string };
      const m = `[${err.code ?? "?"} ${err.status ?? ""}] ${err.message ?? "خطای ناشناخته سرور"}`;
      this.serverError = m;
      this.cbs.onLog("error", `خطای سرور: ${m}`);
      this.cbs.onStats({ serverError: m, message: "خطای سرور Gemini — جزئیات در لاگ" });
      return false;
    }

    if (msg.goAway) {
      this.cbs.onLog("info", "سرور goAway فرستاد → تمدید فوری سشن");
      if (this.running && this.activeSocket === ws && !this.connectingSocket) {
        this.openSocket("rotate").catch(() => this.scheduleRotationRetry());
      }
      return false;
    }

    const content = msg.serverContent as
      | {
          interrupted?: boolean;
          inputTranscription?: { text?: string };
          outputTranscription?: { text?: string };
          modelTurn?: { parts?: Array<{ inlineData?: { data?: string } }> };
        }
      | undefined;
    if (!content) return false;

    if (content.interrupted && this.playbackCtx) {
      this.nextPlayTime = this.playbackCtx.currentTime + 0.005;
    }

    if (content.inputTranscription?.text) {
      this.cbs.onTranscript("in", content.inputTranscription.text);
    }
    if (content.outputTranscription?.text) {
      this.cbs.onTranscript("out", content.outputTranscription.text);
    }

    if (content.modelTurn?.parts) {
      for (const part of content.modelTurn.parts) {
        if (part.inlineData?.data) {
          this.recvAudioBytes += (part.inlineData.data.length * 3) / 4;
          this.playTranslatedAudio(part.inlineData.data);
        }
      }
      this.pushKb();
    }
    return false;
  }

  // ── پخش صدای دوبله ──
  private playTranslatedAudio(b64: string) {
    if (!this.playbackCtx || !this.masterGain) return;
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const int16 = new Int16Array(bytes.buffer);
      const f32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;

      const buffer = this.playbackCtx.createBuffer(1, f32.length, 24000);
      buffer.getChannelData(0).set(f32);
      const src = this.playbackCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.masterGain);

      const now = this.playbackCtx.currentTime;
      if (this.nextPlayTime < now || this.nextPlayTime - now > 0.08) {
        this.nextPlayTime = now + 0.005;
      }
      src.start(this.nextPlayTime);
      this.nextPlayTime += buffer.duration;
    } catch (e) {
      this.cbs.onLog("error", `خطای پخش: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private startOutputMeter() {
    const analyser = this.analyser;
    if (!analyser) return;
    const buf = new Float32Array(analyser.fftSize);
    this.analyserTimer = setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const a = Math.abs(buf[i]);
        if (a > peak) peak = a;
      }
      this.cbs.onStats({ outputLevel: Math.min(1, peak * 2.2) });
    }, 120);
  }

  private pushKb() {
    this.cbs.onStats({
      sentKb: Math.round(this.sentBytes / 1024),
      recvKb: Math.round(this.recvAudioBytes / 1024),
    });
  }

  get errorText(): string {
    return this.serverError;
  }
}

// ─────────────── UI ───────────────

export default function LiveDubTester() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [lang, setLang] = useState("fa");
  const [source, setSource] = useState<"tab" | "mic">("tab");

  const [stats, setStats] = useState<Stats>(INITIAL_STATS);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [subs, setSubs] = useState<SubLine[]>([]);
  const [uptime, setUptime] = useState(0);

  const engineRef = useRef<DubEngine | null>(null);
  const startedAtRef = useRef(0);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const running = stats.phase !== "idle" && stats.phase !== "error";

  // بارگذاری/ذخیره کلید و زبان در localStorage (فقط سمت مرورگر)
  useEffect(() => {
    const t = setTimeout(() => {
      setApiKey(window.localStorage.getItem("livedub_web_api_key") ?? "");
      setLang(window.localStorage.getItem("livedub_web_lang") ?? "fa");
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (apiKey) window.localStorage.setItem("livedub_web_api_key", apiKey);
  }, [apiKey]);
  useEffect(() => {
    window.localStorage.setItem("livedub_web_lang", lang);
  }, [lang]);

  // uptime تایمر (ریست در cleanup هنگام توقف)
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      if (startedAtRef.current) {
        setUptime(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    return () => {
      clearInterval(t);
      setUptime(0);
    };
  }, [running]);

  // اسکرول خودکار لاگ
  useEffect(() => {
    const el = logBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const pushLog = useCallback((kind: LogLine["kind"], msg: string) => {
    const time = new Date().toLocaleTimeString("fa-IR", { hour12: false });
    setLogs((prev) => {
      const next = [...prev, { time, kind, msg }];
      return next.length > 130 ? next.slice(next.length - 130) : next;
    });
  }, []);

  const pushTranscript = useCallback((dir: "in" | "out", text: string) => {
    const t = (text || "").trim();
    if (!t) return;
    setSubs((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.dir === dir && (last.text + " " + t).length < 90) {
        const copy = prev.slice(0, -1);
        copy.push({ dir, text: last.text + " " + t });
        return copy;
      }
      const next = [...prev, { dir, text: t }];
      return next.length > 40 ? next.slice(next.length - 40) : next;
    });
  }, []);

  const handleStart = useCallback(() => {
    const key = apiKey.trim();
    if (!key) {
      pushLog("error", "اول کلید Gemini API را وارد کنید (از aistudio.google.com)");
      setStats((s) => ({ ...s, message: "کلید API را وارد کنید" }));
      return;
    }
    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current = null;
    }
    setSubs([]);
    setStats({ ...INITIAL_STATS });
    startedAtRef.current = Date.now();

    const engine = new DubEngine(key, lang, source, {
      onStats: (patch) => setStats((s) => ({ ...s, ...patch })),
      onLog: pushLog,
      onTranscript: pushTranscript,
      onStopped: (reason) => {
        pushLog("warn", reason);
        setStats((s) => ({ ...s, message: reason }));
      },
    });
    engineRef.current = engine;
    void engine.start();
  }, [apiKey, lang, source, pushLog, pushTranscript]);

  const handleStop = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    startedAtRef.current = 0;
  }, []);

  const handleRotateNow = useCallback(() => {
    engineRef.current?.rotateNow();
  }, []);

  const copyLogs = useCallback(() => {
    const text = logs.map((l) => `[${l.time}] ${l.kind.toUpperCase()} — ${l.msg}`).join("\n");
    void navigator.clipboard.writeText(text).then(() => pushLog("ok", "لاگ کپی شد"));
  }, [logs, pushLog]);

  // پاکسازی هنگام خروج از صفحه
  useEffect(() => {
    return () => {
      engineRef.current?.stop();
      engineRef.current = null;
    };
  }, []);

  const phaseLabel: Record<Phase, string> = {
    idle: "غیرفعال",
    starting: "آماده‌سازی…",
    connecting: "اتصال…",
    live: "در حال دوبله",
    rotating: "تمدید سشن…",
    reconnecting: "اتصال مجدد…",
    error: "خطا",
  };
  const phaseColor =
    stats.phase === "live"
      ? "bg-emerald-500"
      : stats.phase === "error"
        ? "bg-red-500"
        : stats.phase === "reconnecting" || stats.phase === "rotating"
          ? "bg-amber-400"
          : "bg-slate-500";

  return (
    <div className="rounded-2xl border border-emerald-500/25 bg-[#0d1312] p-4 sm:p-6 shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
      {/* ── تنظیمات ── */}
      <div className="grid gap-3 sm:grid-cols-12">
        <div className="sm:col-span-5">
          <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-emerald-200/70">
            <KeyRound className="h-3.5 w-3.5" /> کلید Gemini API
          </label>
          <div className="relative" dir="ltr">
            <Input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy…"
              disabled={running}
              className="h-11 border-white/10 bg-black/40 pe-10 text-left font-mono text-[13px] text-emerald-100 placeholder:text-white/25 focus-visible:ring-emerald-500/40"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute end-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-emerald-300"
              aria-label="نمایش/مخفی کردن کلید"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="sm:col-span-3">
          <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-emerald-200/70">
            <Sparkles className="h-3.5 w-3.5" /> زبان خروجی
          </label>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            disabled={running}
            className="h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-[13px] text-emerald-100 outline-none focus:border-emerald-500/50 disabled:opacity-50"
          >
            {LANGS.map(([code, label]) => (
              <option key={code} value={code} className="bg-[#0d1312]">
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-4">
          <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-emerald-200/70">
            <Mic className="h-3.5 w-3.5" /> منبع صدا
          </label>
          <div className="grid h-11 grid-cols-2 overflow-hidden rounded-md border border-white/10 bg-black/40 p-1">
            {(
              [
                ["tab", "صدای تب/سیستم"],
                ["mic", "میکروفون"],
              ] as Array<["tab" | "mic", string]>
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                disabled={running}
                onClick={() => setSource(val)}
                className={`rounded-[5px] text-[12px] font-bold transition-colors disabled:opacity-60 ${
                  source === val
                    ? "bg-emerald-500 text-[#04110c]"
                    : "text-emerald-100/60 hover:text-emerald-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── دکمه‌ها ── */}
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        {!running ? (
          <Button
            onClick={handleStart}
            className="h-11 rounded-xl bg-emerald-500 px-6 font-extrabold text-[#04110c] shadow-[0_6px_24px_rgba(16,185,129,0.35)] hover:bg-emerald-400"
          >
            <Mic className="me-2 h-4.5 w-4.5" />
            شروع دوبله زنده
          </Button>
        ) : (
          <Button
            onClick={handleStop}
            variant="outline"
            className="h-11 rounded-xl border-red-500/40 bg-red-500/10 px-6 font-extrabold text-red-300 hover:bg-red-500/20 hover:text-red-200"
          >
            <CircleStop className="me-2 h-4.5 w-4.5" />
            توقف
          </Button>
        )}

        {running && (
          <>
            <Button
              onClick={handleRotateNow}
              variant="outline"
              size="sm"
              className="h-10 rounded-xl border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/10 hover:text-emerald-100"
            >
              <RefreshCw className="me-2 h-4 w-4" />
              تست چرخش سشن
            </Button>
            <Badge className="border-white/10 bg-white/5 text-emerald-200/80 hover:bg-white/10">
              {faNum(Math.floor(uptime / 60))}:{faNum(String(uptime % 60).padStart(2, "0"))} از شروع
            </Badge>
          </>
        )}

        <span className="ms-auto inline-flex items-center gap-2 text-[11.5px] text-emerald-100/60">
          <span className={`h-2 w-2 animate-pulse rounded-full ${phaseColor}`} />
          {phaseLabel[stats.phase]}
          {stats.message && <span className="text-emerald-100/45">— {stats.message}</span>}
        </span>
      </div>

      {/* ── هشدار خطای سرور ── */}
      {stats.serverError && (
        <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-[12.5px] leading-6 text-red-300">
          ⚠ خطای سرور: <span dir="ltr">{stats.serverError}</span>
        </div>
      )}

      {/* ── راهنمای تست ── */}
      {!running && stats.phase !== "error" && (
        <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
          <p className="flex items-start gap-2 text-[12px] leading-6 text-emerald-100/65">
            <Info className="mt-1 h-4 w-4 shrink-0 text-emerald-400" />
            <span>
              <b className="text-emerald-200">راهنمای تست:</b> کلید رایگان را از{" "}
              <span dir="ltr" className="text-emerald-300">aistudio.google.com</span> بگیرید → «شروع دوبله» را بزنید → در
              پنجره اشتراک، تب <b>یک تب کروم</b> را انتخاب کرده و <b className="text-emerald-300">گزینه اشتراک صدا را فعال</b> کنید →
              در همان تب یوتیوب پخش کنید؛ صدای دوبله از همین صفحه پخش می‌شود. اگر مرورگر اجازه نداد، صفحه را با دکمه
              «Open in New Tab» بالای پنل باز کنید. 🔒 کلید فقط در مرورگر شما ذخیره می‌شود.
            </span>
          </p>
        </div>
      )}

      {/* ── پنل زنده ── */}
      {running && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {/* مترها و آمار */}
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center gap-2 text-[12px] font-bold text-emerald-200">
              <Activity className="h-4 w-4 text-emerald-400" /> پایش زنده
            </div>

            <div className="space-y-2.5">
              <MeterBar label="صدای ورودی از تب/میکروفون" value={stats.inputLevel} color="bg-emerald-400" />
              <MeterBar label="صدای دوبله (خروجی)" value={stats.outputLevel} color="bg-amber-300" />
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2 text-center">
              <StatChip icon={ArrowUpFromLine} label="ارسالی" value={`${faNum(stats.sentKb)} KB`} />
              <StatChip icon={ArrowDownToLine} label="دوبله" value={`${faNum(stats.recvKb)} KB`} />
              <StatChip icon={RefreshCw} label="تمدید" value={faNum(stats.rotations)} />
              <StatChip icon={BadgeCheck} label="Reconnect" value={faNum(stats.reconnects)} />
            </div>

            {stats.recvKb === 0 && stats.sentKb > 30 && (
              <p className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11.5px] leading-5 text-amber-300">
                صدا در حال ارسال است ولی هنوز دوبله‌ای برنگشته — چند ثانیه صبر کنید؛ اگر ادامه پیدا کرد،
                مطمئن شوید در تب مقصد واقعاً صدا پخش می‌شود.
              </p>
            )}
          </div>

          {/* زیرنویس زنده */}
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center gap-2 text-[12px] font-bold text-emerald-200">
              <ScrollText className="h-4 w-4 text-emerald-400" /> زیرنویس زنده
            </div>
            <div className="h-44 space-y-1.5 overflow-y-auto pe-1" dir="rtl">
              {subs.length === 0 && (
                <p className="text-[12px] text-emerald-100/40">
                  هنوز گفتاری تشخیص داده نشده — صدا را پخش کنید…
                </p>
              )}
              {subs.map((s, i) => (
                <p
                  key={i}
                  className={`rounded-lg px-2.5 py-1.5 text-[12.5px] leading-6 ${
                    s.dir === "out"
                      ? "bg-emerald-500/10 text-emerald-200"
                      : "bg-white/[0.04] text-emerald-100/60"
                  }`}
                >
                  {s.dir === "out" ? "★ " : "⇢ "}
                  {s.text}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── کنسول لاگ ── */}
      <div className="mt-3 rounded-xl border border-white/8 bg-black/40">
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
          <span className="flex items-center gap-2 text-[11.5px] font-bold text-emerald-200/70">
            <ScrollText className="h-3.5 w-3.5" /> لاگ عیب‌یابی
          </span>
          <button
            type="button"
            onClick={copyLogs}
            className="flex items-center gap-1 text-[11px] text-emerald-300/80 hover:text-emerald-200"
          >
            <Copy className="h-3.5 w-3.5" /> کپی لاگ
          </button>
        </div>
        <div
          ref={logBoxRef}
          dir="ltr"
          className="live-dub-logs h-40 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-5"
        >
          {logs.length === 0 && <p className="text-white/25">Waiting for events…</p>}
          {logs.map((l, i) => (
            <p
              key={i}
              className={
                l.kind === "error"
                  ? "text-red-400"
                  : l.kind === "warn"
                    ? "text-amber-300"
                    : l.kind === "ok"
                      ? "text-emerald-300"
                      : "text-white/55"
              }
            >
              <span className="text-white/30">{l.time}</span> {l.msg}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────── زیرکامپوننت‌ها ───────────────

function MeterBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-emerald-100/55">
        <span>{label}</span>
        <span>{faNum(Math.round(pct))}٪</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/8">
        <div
          className={`h-full rounded-full transition-[width] duration-100 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatChip({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-black/30 px-1.5 py-2">
      <Icon className="mx-auto mb-1 h-3.5 w-3.5 text-emerald-400" />
      <p className="text-[13px] font-extrabold text-emerald-200">{value}</p>
      <p className="text-[9.5px] text-emerald-100/45">{label}</p>
    </div>
  );
}
