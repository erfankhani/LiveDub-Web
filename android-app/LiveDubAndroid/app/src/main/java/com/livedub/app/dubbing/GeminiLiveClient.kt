package com.livedub.app.dubbing

import android.util.Base64
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.math.pow

/**
 * کلاینت WebSocket برای Gemini Live Translate
 *
 * ─────────────────────────────────────────────────────────────
 *  ⭐⭐ فیکس «وصل است ولی صفر بایت ارسال می‌شود» (v2.2):
 *  اکستنشن کرومِ اصلی (که روی همین پروتکل کار می‌کند) صدا را
 *  بلافاصله بعد از باز شدن سوکت می‌فرستد و منتظر setupComplete
 *  نمی‌ماند. نسخه قبلی اندروید منتظر setupComplete بود؛ اگر سرور
 *  آن را نمی‌داد، هیچ بایتی ارسال نمی‌شد و بدون خطا همه‌چیز صفر
 *  می‌ماند. اکنون:
 *   - اتصال اولیه/اتصال مجدد → سوکت «فوراً» فعال است (مثل اکستنشن)
 *   - تمدید سشن (rotate) → منتظر setupComplete برای Hot-Swap ایمن
 *   - اگر setupComplete ظرف ۱۲ ثانیه نرسید، خطای واضح در UI نمایش
 *     داده می‌شود (ولی ارسال صدا ادامه می‌یابد — مثل اکستنشن)
 *
 *  رفع باگ «هر ۱۵ دقیقه قطع می‌شد» (همان راه‌حل نسخه کروم):
 *  Session Rotation در دقیقه ~۱۳.۵ + Auto-Reconnect با Backoff
 * ─────────────────────────────────────────────────────────────
 */
class GeminiLiveClient(
    private val apiKey: String,
    private val listener: Listener
) {
    interface Listener {
        /** صدای دوبله ترجمه‌شده (base64 PCM 24kHz) */
        fun onAudioOut(base64Pcm24k: String)

        /** زیرنویس زنده */
        fun onTranscript(isInput: Boolean, text: String)

        /** تغییر وضعیت اتصال */
        fun onState(message: String, reconnecting: Boolean)

        /** سشن جدید آماده شد → سرویس باید بافر صدا را فلاش کند */
        fun onConnected()

        /** ⭐ خطای قابل‌نمایش (خطای سرور / قطع اتصال) — دیگر هیچ خطایی بی‌صدا نماند */
        fun onError(message: String)

        /** آمار (KB صدا ارسالی/دریافتی برای دیاگنوستیک) */
        fun onStats(rotations: Int, reconnects: Int, sentKb: Int, recvKb: Int)
    }

    companion object {
        const val WS_BASE =
            "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
        const val MODEL = "models/gemini-3.5-live-translate-preview"
        const val ROTATE_MS = 810_000L            // ۱۳.۵ دقیقه — تمدید سشن قبل از سقف ~۱۵ دقیقه سرور
        const val RECONNECT_BASE_MS = 1200L
        const val RECONNECT_MAX_MS = 10_000L
        const val ROTATE_RETRY_MS = 5000L
        const val SETUP_TIMEOUT_MS = 12_000L      // اگر setupComplete نیامد → خطای واضح
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS) // بدون timeout خواندن برای WebSocket
        .build()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile private var activeSocket: WebSocket? = null
    @Volatile private var connectingSocket: WebSocket? = null
    @Volatile private var running = false
    @Volatile private var targetLang = "fa"

    @Volatile private var rotations = 0
    @Volatile private var reconnects = 0
    @Volatile var sentBytes = 0L      // مجموع بایت صدای ارسالی به سرور (دیاگنوستیک)
    @Volatile var recvAudioBytes = 0L // مجموع بایت صدای دوبله دریافتی (دیاگنوستیک)

    /** ⭐ آیا سرور setupComplete داده؟ (برای نمایش مرحله در UI) */
    @Volatile var isSetupComplete = false

    private var reconnectAttempts = 0
    private var reconnectJob: Job? = null
    private var rotationJob: Job? = null

    // جلوگیری از اسپم خطا‌های تکراری در UI
    private var lastErrorText = ""
    private var lastErrorAt = 0L

    /** سوکت آماده برای ارسال دارد؟ */
    val isOpen: Boolean
        get() = activeSocket != null && running

    // ─────────────── چرخه حیات ───────────────

    fun start(targetLang: String) {
        this.targetLang = targetLang
        if (running) return
        running = true
        reconnectAttempts = 0
        listener.onState("در حال اتصال…", false)
        openSocket("initial")
        rotationJob = scope.launch { rotationLoop() }
    }

    fun stop() {
        running = false
        rotationJob?.cancel()
        reconnectJob?.cancel()
        try { activeSocket?.close(1000, "stop") } catch (_: Exception) {}
        try { connectingSocket?.cancel() } catch (_: Exception) {}
        activeSocket = null
        connectingSocket = null
        scope.cancel()
    }

    // ─────────────── ارسال صدا ───────────────

    fun sendAudioPcm16k(pcm: ShortArray) {
        val ws = activeSocket ?: return
        if (!running) return
        ws.send(buildAudioMessage(pcm))
        sentBytes += pcm.size * 2L
    }

    /** گزارش خطا با دی‌دوپ (حداکثر یک پیام تکراری در ۳ ثانیه) */
    private fun emitError(text: String) {
        val now = System.currentTimeMillis()
        synchronized(this) {
            if (text == lastErrorText && now - lastErrorAt < 3000) return
            lastErrorText = text
            lastErrorAt = now
        }
        listener.onError(text)
    }

    // ─────────────── تمدید دوره‌ای سشن ───────────────

    private suspend fun rotationLoop() {
        while (running && scope.isActive) {
            delay(ROTATE_MS)
            if (!running) break
            if (activeSocket != null && connectingSocket == null) {
                listener.onState("تمدید خودکار سشن…", false)
                openSocket("rotate")
            }
        }
    }

    // ─────────────── اتصال ───────────────

    private fun openSocket(mode: String) {
        if (!running) return
        val url = "$WS_BASE?key=${URLEncoder.encode(apiKey, "UTF-8")}"
        val request = Request.Builder().url(url).build()
        val ws = client.newWebSocket(request, SocketListener(mode))
        connectingSocket = ws
    }

    private inner class SocketListener(private val mode: String) : WebSocketListener() {
        private var ready = false

        override fun onOpen(webSocket: WebSocket, response: Response) {
            webSocket.send(buildSetup())

            // ⭐⭐ مثل اکستنشن کروم: برای اتصال اولیه/مجدد سوکت «فوراً» فعال می‌شود
            // تا صدا بلافاصله جریان یابد. فقط تمدید سشن منتظر setupComplete می‌ماند.
            if (mode != "rotate" && running) {
                activate(webSocket, mode)
            }

            // ⭐ سگمنت تایم‌اوت Setup — اگر تأیید سرور نیامد، دیگر بی‌صدا نمی‌مانیم
            scope.launch {
                delay(SETUP_TIMEOUT_MS)
                if (!ready && running && webSocket === activeSocket) {
                    emitError(
                        "سرور تأیید Setup (setupComplete) را نداد — کلید API را بررسی کنید؛ " +
                            "ارسال صدا طبق پروتکل اکستنشن ادامه دارد"
                    )
                }
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val msg = try { JSONObject(text) } catch (_: Exception) { return }

            // ⭐⭐ خطای سرور (کلید نامعتبر / مدل بدون دسترسی / کوتا) — دیگر مخفی نمی‌ماند
            msg.optJSONObject("error")?.let { err ->
                val m = err.optString("message").ifBlank { err.toString() }
                val code = err.optInt("code", 0)
                emitError(if (code > 0) "خطای سرور ($code): $m" else "خطای سرور: $m")
            }

            // ⭐ تأیید سشن جدید → فعال‌سازی (نقطه کلیدی Hot-Swap در تمدید)
            if (msg.has("setupComplete")) {
                ready = true
                isSetupComplete = true
                if (webSocket !== activeSocket && running) {
                    activate(webSocket, mode)
                } else if (webSocket === activeSocket) {
                    listener.onState(
                        if (mode == "rotate") "سشن تمدید شد — بدون قطعی" else "تأیید سرور دریافت شد ✓",
                        false
                    )
                    listener.onStats(rotations, reconnects, kb(sentBytes), kb(recvAudioBytes))
                }
                return
            }

            // سرور اعلام می‌کند سشن رو به پایان است → فوری تمدید کن
            if (msg.has("goAway")) {
                if (running && webSocket === activeSocket && connectingSocket == null) {
                    openSocket("rotate")
                }
                return
            }

            val content = msg.optJSONObject("serverContent") ?: return

            content.optJSONObject("inputTranscription")?.optString("text")
                ?.takeIf { it.isNotBlank() }?.let { listener.onTranscript(true, it) }

            content.optJSONObject("outputTranscription")?.optString("text")
                ?.takeIf { it.isNotBlank() }?.let { listener.onTranscript(false, it) }

            content.optJSONObject("modelTurn")?.optJSONArray("parts")?.let { parts ->
                for (i in 0 until parts.length()) {
                    val inline = parts.optJSONObject(i)?.optJSONObject("inlineData") ?: continue
                    val data = inline.optString("data")
                    if (data.isNotBlank()) {
                        recvAudioBytes += (data.length * 3L) / 4L // تقریب سایز base64
                        listener.onAudioOut(data)
                    }
                }
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            val httpCode = response?.code
            val detail = when {
                httpCode != null && httpCode >= 400 -> "پاسخ سرور: $httpCode (کلید API یا اتصال را بررسی کنید)"
                t.message != null -> t.message!!
                else -> "خطای نامشخص شبکه"
            }
            emitError("قطع اتصال — $detail")
            handleDisconnect(webSocket, ready)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (code != 1000) {
                emitError(
                    if (reason.isNotBlank()) "سشن بسته شد (کد $code): $reason"
                    else "سشن بسته شد (کد $code)"
                )
            }
            handleDisconnect(webSocket, ready)
        }
    }

    @Synchronized
    private fun activate(ws: WebSocket, mode: String) {
        val old = activeSocket
        activeSocket = ws
        connectingSocket = null
        if (old != null && old !== ws) {
            try { old.cancel() } catch (_: Exception) {}
        }
        reconnectAttempts = 0
        if (mode == "rotate") rotations++
        listener.onConnected()
        listener.onStats(rotations, reconnects, kb(sentBytes), kb(recvAudioBytes))
        listener.onState(
            if (mode == "rotate") "سشن تمدید شد — بدون قطعی" else "اتصال برقرار شد",
            false
        )
    }

    private fun kb(bytes: Long): Int = (bytes / 1024L).toInt()

    @Synchronized
    private fun handleDisconnect(ws: WebSocket, wasReady: Boolean) {
        // اگر سوکت فعال بود → آمار Setup ریست شود
        if (ws === activeSocket) {
            activeSocket = null
            isSetupComplete = false
            if (running) scheduleReconnect()
            return
        }
        if (connectingSocket === ws) {
            connectingSocket = null
            if (ws === activeSocket) return
            if (wasReady.not() && running) {
                if (activeSocket != null) {
                    // تلاش «تمدید» ناموفق بود ولی سوکت اصلی سالم است → تمدید را دوباره امتحان کن
                    scope.launch {
                        delay(ROTATE_RETRY_MS)
                        if (running && activeSocket != null && connectingSocket == null) {
                            openSocket("rotate")
                        }
                    }
                } else {
                    scheduleReconnect()
                }
            }
        }
    }

    // ─────────────── اتصال مجدد با Backoff نمایی ───────────────

    private fun scheduleReconnect() {
        if (!running) return
        reconnects++
        reconnectAttempts++
        val delayMs = min(
            (RECONNECT_BASE_MS * 2.0.pow(reconnectAttempts - 1)).toLong(),
            RECONNECT_MAX_MS
        )
        listener.onState(
            "قطع شد؛ اتصال مجدد در ${"%.1f".format(delayMs / 1000.0)} ثانیه (تلاش $reconnectAttempts)",
            true
        )
        listener.onStats(rotations, reconnects, kb(sentBytes), kb(recvAudioBytes))
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(delayMs)
            if (running) openSocket("reconnect")
        }
    }

    // ─────────────── ساخت پیام‌های JSON ───────────────

    private fun buildSetup(): String {
        return JSONObject().put(
            "setup",
            JSONObject()
                .put("model", MODEL)
                .put(
                    "generationConfig",
                    JSONObject()
                        .put("responseModalities", JSONArray(listOf("AUDIO")))
                        .put(
                            "translationConfig",
                            JSONObject()
                                .put("targetLanguageCode", targetLang)
                                .put("echoTargetLanguage", true)
                        )
                )
                .put("inputAudioTranscription", JSONObject())
                .put("outputAudioTranscription", JSONObject())
        ).toString()
    }

    private fun buildAudioMessage(pcm: ShortArray): String {
        val bytes = ByteArray(pcm.size * 2)
        for (i in pcm.indices) {
            val v = pcm[i].toInt()
            bytes[i * 2] = (v and 0xFF).toByte()
            bytes[i * 2 + 1] = ((v shr 8) and 0xFF).toByte()
        }
        val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        return JSONObject().put(
            "realtimeInput",
            JSONObject().put(
                "audio",
                JSONObject().put("data", b64).put("mimeType", "audio/pcm;rate=16000")
            )
        ).toString()
    }
}
