package com.livedub.app.dubbing

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.Looper
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * ضبط صدای سیستم با AudioPlaybackCapture (API 29+)
 *
 * صدای «سایر اپلیکیشن‌ها» را می‌گیرد: یوتیوب، تلگرام، مرورگر، پادکست و …
 * ورودی: 48kHz مونو PCM16 → خروجی: 16kHz مونو PCM16 (آماده ارسال به Gemini)
 *
 * ⭐ دیاگنوستیک v2.2 (رفع مشکل «وصل است ولی دوبله نمی‌کند»):
 *  - شمارنده چانک‌های خوانده‌شده (chunksRead) → UI تشخیص می‌دهد ضبط زنده است یا نه
 *  - heartbeat: اگر ضبط اصلاً داده تولید نکند (خواندن برای همیشه بلاک شود)
 *    بعد از ~۶ ثانیه خطای واضح گزارش می‌شود — دیگر هیچ حالت مرگ بی‌صدا وجود ندارد
 *  - سطح بلندی صدای ورودی (0..1) برای متر زنده UI
 *  - توقف درست: record.stop() برای از-بلاک-درآمدن خواندن (قبلاً thread برای همیشه
 *    داخل read() گیر می‌کرد و AudioRecord هرگز آزاد نمی‌شد)
 */
class AudioCaptureEngine(
    private val projection: MediaProjection,
    private val onPcm16k: (ShortArray) -> Unit,
    private val onInputLevel: (Float) -> Unit,
    private val onCaptureError: (String) -> Unit,
    private val onProjectionRevoked: () -> Unit
) {
    companion object {
        const val CAPTURE_RATE = 48000
        const val TARGET_RATE = 16000
        private const val MAX_CONSECUTIVE_ERRORS = 5
        private const val HEARTBEAT_TIMEOUT_MS = 6000L
        private const val HEARTBEAT_TICK_MS = 1500L
    }

    private var record: AudioRecord? = null
    private var worker: Thread? = null
    private val running = AtomicBoolean(false)
    private val resampler = PcmResampler(CAPTURE_RATE, TARGET_RATE)
    private val mainHandler = Handler(Looper.getMainLooper())
    private var heartbeat: Runnable? = null
    private var startedAtMs = 0L

    /** ⭐ تعداد چانک‌های ۱۰۰ms خوانده‌شده از AudioRecord (دیاگنوستیک UI) */
    @Volatile var chunksRead = 0L
        private set

    /** آخرین زمانی که AudioRecord داده واقعی داد (دیاگنوستیک heartbeat) */
    @Volatile private var lastReadAt = 0L

    fun start() {
        if (running.get()) return

        val captureConfig = AudioPlaybackCaptureConfiguration.Builder(projection)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build()

        val format = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(CAPTURE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
            .build()

        val minBuf = AudioRecord.getMinBufferSize(
            CAPTURE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
        )

        val rec = try {
            AudioRecord.Builder()
                .setAudioFormat(format)
                .setBufferSizeInBytes(maxOf(minBuf, 4096) * 4)
                .setAudioPlaybackCaptureConfig(captureConfig)
                .build()
        } catch (e: Exception) {
            onCaptureError("راه‌اندازی ضبط صدا ناموفق بود: ${e.message}")
            return
        }

        // ⭐ بررسی وضعیت مقداردهی اولیه — شکست اینجا بی‌صدا نمی‌ماند
        if (rec.state != AudioRecord.STATE_INITIALIZED) {
            val st = rec.state
            try { rec.release() } catch (_: Exception) {}
            onCaptureError("ضبط صدا مقداردهی نشد (state=$st) — دسترسی ضبط را بررسی کنید")
            return
        }

        record = rec
        chunksRead = 0L
        lastReadAt = 0L
        startedAtMs = System.currentTimeMillis()

        // اگر کاربر/سیستم اشتراک پروجکشن را لغو کند
        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                if (running.get()) mainHandler.post { onProjectionRevoked() }
            }
        }, Handler(Looper.getMainLooper()))

        running.set(true)
        startHeartbeat()

        worker = thread(name = "livedub-capture") {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
            val buf = ShortArray(4800) // 100ms در 48kHz
            var consecutiveErrors = 0
            try {
                rec.startRecording()
                if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                    mainHandler.post {
                        onCaptureError("شروع ضبط ناموفق بود — گزینه اشتراک صدا در پنجره دسترسی روشن است؟")
                    }
                    return@thread
                }
                while (running.get()) {
                    val n = try { rec.read(buf, 0, buf.size) } catch (e: Exception) {
                        mainHandler.post { onCaptureError("خطا در خواندن صدا: ${e.message}") }
                        break
                    }
                    if (n > 0) {
                        consecutiveErrors = 0
                        chunksRead += 1
                        lastReadAt = System.currentTimeMillis()
                        // ⭐ محاسبه سطح صدا برای متر زنده
                        var maxAmp = 0
                        for (i in 0 until n) {
                            val a = if (buf[i] == Short.MIN_VALUE) Short.MAX_VALUE.toInt()
                            else kotlin.math.abs(buf[i].toInt())
                            if (a > maxAmp) maxAmp = a
                        }
                        onInputLevel((maxAmp / 32768f).coerceIn(0f, 1f))
                        val down = resampler.resample(buf.copyOf(n))
                        if (down.isNotEmpty()) onPcm16k(down)
                    } else {
                        consecutiveErrors++
                        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                            mainHandler.post {
                                onCaptureError("خواندن صدا متوقف شد (کد $n)")
                            }
                            break
                        }
                    }
                }
            } catch (e: Exception) {
                mainHandler.post { onCaptureError("خطای ضبط: ${e.message ?: "نامشخص"}") }
            } finally {
                try { rec.stop() } catch (_: Exception) {}
                try { rec.release() } catch (_: Exception) {}
            }
        }
    }

    /**
     * ⭐ heartbeat ضبط: اگر ضبط «اصلاً» داده تولید نکند (خواندن بلاک شده یا
     * سیستم هیچ استریمی نمی‌دهد)، بعد از ~۶ ثانیه خطای واضح می‌دهیم.
     * توجه: سکوت دیجیتال (همه صفرها) اینجا خطا محسوب نمی‌شود چون داده
     * جریان دارد — آن حالت با متر صفر و هشدار زرد «اشتراک صدا» پوشش داده می‌شود.
     */
    private fun startHeartbeat() {
        stopHeartbeat()
        val r = object : Runnable {
            override fun run() {
                if (!running.get()) return
                val last = lastReadAt
                val idle = if (last == 0L) {
                    // هنوز اولین خواندن هم نیامده — از زمان شروع بشمار
                    System.currentTimeMillis() - startedAtMs
                } else {
                    System.currentTimeMillis() - last
                }
                if (idle > HEARTBEAT_TIMEOUT_MS) {
                    mainHandler.post {
                        onCaptureError(
                            "ضبط صدا هیچ داده‌ای تولید نمی‌کند (۶ ثانیه بدون داده) — " +
                                "دوباره شروع کنید و در پنجره اجازه، «اشتراک صدا» را روشن کنید"
                        )
                    }
                    return
                }
                mainHandler.postDelayed(this, HEARTBEAT_TICK_MS)
            }
        }
        heartbeat = r
        mainHandler.postDelayed(r, HEARTBEAT_TICK_MS)
    }

    private fun stopHeartbeat() {
        heartbeat?.let { mainHandler.removeCallbacks(it) }
        heartbeat = null
    }

    fun stop() {
        running.set(false)
        stopHeartbeat()
        // ⭐ برای از-بلاک-درآمدن read()، خود ضبط را متوقف می‌کنیم
        try { record?.stop() } catch (_: Exception) {}
        try { worker?.interrupt() } catch (_: Exception) {}
        try { worker?.join(600) } catch (_: Exception) {}
        worker = null
        record = null
    }
}
