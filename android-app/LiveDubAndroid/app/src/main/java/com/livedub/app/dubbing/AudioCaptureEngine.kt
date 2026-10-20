package com.livedub.app.dubbing

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * ضبط صدای سیستم با AudioPlaybackCapture (API 29+)
 *
 * صدای «سایر اپلیکیشن‌ها» را می‌گیرد: یوتیوب، تلگرام، مرورگر، آفیس و …
 * ورودی: 48kHz مونو PCM16 → خروجی: 16kHz مونو PCM16 (آماده ارسال به Gemini)
 */
class AudioCaptureEngine(
    private val projection: MediaProjection,
    private val onPcm16k: (ShortArray) -> Unit,
    private val onProjectionRevoked: () -> Unit
) {
    companion object {
        const val CAPTURE_RATE = 48000
        const val TARGET_RATE = 16000
    }

    private var record: AudioRecord? = null
    private var worker: Thread? = null
    private val running = AtomicBoolean(false)
    private val resampler = PcmResampler(CAPTURE_RATE, TARGET_RATE)

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

        val rec = AudioRecord.Builder()
            .setAudioFormat(format)
            .setBufferSizeInBytes(maxOf(minBuf, 4096) * 4)
            .setAudioPlaybackCaptureConfig(captureConfig)
            .build()

        record = rec

        // اگر کاربر/سیستم اشتراک پروجکشن را لغو کند
        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                if (running.get()) onProjectionRevoked()
            }
        }, null)

        running.set(true)
        worker = thread(name = "livedub-capture") {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
            val buf = ShortArray(4800) // 100ms در 48kHz
            try {
                rec.startRecording()
                while (running.get()) {
                    val n = rec.read(buf, 0, buf.size)
                    if (n > 0) {
                        val down = resampler.resample(buf.copyOf(n))
                        if (down.isNotEmpty()) onPcm16k(down)
                    } else if (n < 0) {
                        break
                    }
                }
            } catch (_: Exception) {
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
