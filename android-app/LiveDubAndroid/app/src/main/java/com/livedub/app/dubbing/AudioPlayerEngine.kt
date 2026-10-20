package com.livedub.app.dubbing

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.util.Base64
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * پخش صدای دوبله (PCM16 مونو 24kHz) با AudioTrack و بافر جیتر
 *
 * کانال پخش قابل انتخاب است:
 *  - MEDIA: ولوم موزیک (پیش‌فرض)
 *  - VOICE_COMMUNICATION: ولوم مکالمه — ترفند مفید برای دوبله:
 *    ولوم رسانه را کم کنید تا «صدای اصلی» کم شود، دوبله روی ولوم مکالمه بلند می‌ماند
 */
class AudioPlayerEngine(private val useVoiceCallChannel: Boolean) {

    companion object {
        const val SAMPLE_RATE = 24000
        private const val START_THRESHOLD_BYTES = 2400 // ~50ms قبل از شروع پخش
    }

    private var track: AudioTrack? = null
    private var worker: Thread? = null
    private val queue = ConcurrentLinkedQueue<ByteArray>()
    private val running = AtomicBoolean(false)

    @Volatile var volume: Float = 1.0f

    fun start() {
        if (running.getAndSet(true)) return

        val usage =
            if (useVoiceCallChannel) AudioAttributes.USAGE_VOICE_COMMUNICATION
            else AudioAttributes.USAGE_MEDIA

        val attrs = AudioAttributes.Builder()
            .setUsage(usage)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()

        val format = AudioFormat.Builder()
            .setSampleRate(SAMPLE_RATE)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build()

        val minBuf = AudioTrack.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT
        )

        val t = AudioTrack(
            attrs, format,
            maxOf(minBuf, 9600) * 4,
            AudioTrack.MODE_STREAM,
            AudioManager.AUDIO_SESSION_ID_GENERATE
        )
        track = t

        worker = thread(name = "livedub-player") {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
            try {
                t.play()
                val primedFlag = java.util.concurrent.atomic.AtomicBoolean(false)
                while (running.get()) {
                    var chunk = queue.poll()
                    if (chunk == null) {
                        if (primedFlag.get()) Thread.sleep(6) else Thread.sleep(4)
                        continue
                    }
                    if (!primedFlag.get()) {
                        // منتظر می‌مانیم کمی صدا بافر شود تا پخش بدون لرزش شروع شود
                        while (running.get() && queue.size < 2) Thread.sleep(4)
                        primedFlag.set(true)
                    }
                    while (running.get() && chunk.isNotEmpty()) {
                        t.setVolume(volume)
                        val written = t.write(chunk, 0, chunk.size) // blocking
                        if (written <= 0) break
                        if (written < chunk.size) {
                            chunk = chunk.copyOfRange(written, chunk.size)
                        } else break
                    }
                }
            } catch (_: Exception) {
            }
        }
    }

    /** افزودن قطعه صدای دوبله (base64 PCM24k از سرور) */
    fun enqueueBase64(base64Pcm24k: String) {
        if (!running.get()) return
        val bytes = try {
            Base64.decode(base64Pcm24k, Base64.NO_WRAP)
        } catch (_: IllegalArgumentException) {
            return
        }
        if (bytes.isEmpty()) return
        queue.add(bytes)
        // محافظت از رشد بی‌رویه (در صورت کندی پخش)
        while (queue.size > 200) queue.poll()
    }

    fun setVolume(v: Float) {
        volume = v.coerceIn(0f, 1f)
        track?.setVolume(volume)
    }

    fun stop() {
        running.set(false)
        try { worker?.interrupt() } catch (_: Exception) {}
        try { worker?.join(600) } catch (_: Exception) {}
        worker = null
        queue.clear()
        try { track?.stop() } catch (_: Exception) {}
        try { track?.release() } catch (_: Exception) {}
        track = null
    }
}
