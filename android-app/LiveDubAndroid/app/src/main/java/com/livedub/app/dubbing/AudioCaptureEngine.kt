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
 * ⭐ دیاگنوستیک (رفع مشکل «وصل است ولی دوبله نمی‌کند»):
 *  - اگر AudioRecord مقداردهی نشود، دیگر بی‌صدا نمی‌میرد و خطا گزارش می‌شود
 *  - سطح بلندی صدای ورودی (0..1) گزارش می‌شود تا UI متر زنده داشته باشد
 *  - اگر صدا کاملاً ساکت باشد، سرویس هشدار «اشتراک صدا» را نشان می‌دهد
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
    }

    private var record: AudioRecord? = null
    private var worker: Thread? = null
    private val running = AtomicBoolean(false)
    private val resampler = PcmResampler(CAPTURE_RATE, TARGET_RATE)
    private val mainHandler = Handler(Looper.getMainLooper())

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

        // ⭐ بررسی وضعیت مقداردهی اولیه — قبلاً اینجا خطاها بی‌صدا نادیده گرفته می‌شد
        if (rec.state != AudioRecord.STATE_INITIALIZED) {
            val st = rec.state
            try { rec.release() } catch (_: Exception) {}
            onCaptureError("ضبط صدا مقداردهی نشد (state=$st) — دسترسی ضبط را بررسی کنید")
            return
        }

        record = rec

        // اگر کاربر/سیستم اشتراک پروجکشن را لغو کند
        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                if (running.get()) mainHandler.post { onProjectionRevoked() }
            }
        }, Handler(Looper.getMainLooper()))

        running.set(true)
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
                        // ⭐ محاسبه سطح صدا برای متر زنده + تشخیص سکوت
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

    fun stop() {
        running.set(false)
        try { worker?.interrupt() } catch (_: Exception) {}
        try { worker?.join(600) } catch (_: Exception) {}
        worker = null
        record = null
    }
}
