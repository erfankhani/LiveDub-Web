package com.livedub.app.dubbing

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.livedub.app.MainActivity
import com.livedub.app.R
import java.util.ArrayDeque
import java.util.Locale

/**
 * سرویس Foreground دوبله زنده
 *
 * ✔ در پس‌زمینه اجرا می‌شود (حتی با صفحه خاموش — Wake Lock)
 * ✔ صدای «هر اپ در حال پخش» را می‌گیرد: یوتیوب، تلگرام، مرورگر، پادکست و …
 * ✔ با Session Rotation هرگز روی سقف ~۱۵ دقیقه‌ای Gemini متوقف نمی‌شود
 */
class LiveDubService : Service() {

    companion object {
        const val ACTION_START = "com.livedub.app.action.START"
        const val ACTION_STOP = "com.livedub.app.action.STOP"
        const val ACTION_STATUS = "com.livedub.app.action.STATUS"

        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_DATA = "data"
        const val EXTRA_STATE = "state"             // idle | dubbing | reconnecting | error
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_RECONNECTING = "reconnecting"
        const val EXTRA_ROTATIONS = "rotations"
        const val EXTRA_RECONNECTS = "reconnects"
        const val EXTRA_STARTED_AT = "startedAt"
        const val EXTRA_SUBTITLES = "subtitles"     // آخرین خطوط زیرنویس با \n

        private const val CHANNEL_ID = "livedub_service"
        private const val NOTIF_ID = 1001

        private const val MAX_BUFFER_CHUNKS = 400 // ~۱۲ ثانیه بافر حین تعویض سشن
    }

    private var projection: MediaProjection? = null
    private var capture: AudioCaptureEngine? = null
    private var player: AudioPlayerEngine? = null
    private var client: GeminiLiveClient? = null
    private var wakeLock: PowerManager.WakeLock? = null

    private val handler = Handler(Looper.getMainLooper())
    private var isStopping = false
    private var startedAt = 0L

    // بافر صدا در زمان تعویض سشن (Session Rotation)
    private val audioBuffer = ArrayDeque<ShortArray>()
    private val bufferLock = Any()

    // زیرنویس زنده
    private val subtitles = ArrayDeque<String>()
    private var lastSubtitleBroadcast = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopEverything()
                return START_NOT_STICKY
            }
            ACTION_START -> startDubbing(intent)
            else -> return START_NOT_STICKY
        }
        return START_NOT_STICKY
    }

    // ─────────────── شروع دوبله ───────────────

    private fun startDubbing(intent: Intent) {
        if (startedAt != 0L) return // در حال اجراست

        val prefs = getSharedPreferences("livedub", Context.MODE_PRIVATE)
        val apiKey = prefs.getString("apiKey", "").orEmpty()
        val targetLang = prefs.getString("targetLang", "fa") ?: "fa"
        val dubVol = prefs.getFloat("dubVolume", 1.0f)
        val voiceChannel = prefs.getBoolean("voiceChannel", false)

        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Int.MIN_VALUE)
        val data: Intent? = getProjectionData(intent)

        if (apiKey.isBlank() || data == null || resultCode == Int.MIN_VALUE) {
            broadcastStatus("error", false, "تنظیمات یا دسترسی ضبط ناقص است")
            stopSelf()
            return
        }

        // ⭐ قبل از استفاده از MediaProjection باید Foreground شویم (الزام API 34+)
        createChannel()
        startAsForeground("در حال آماده‌سازی…")

        val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = try {
            mgr.getMediaProjection(resultCode, data)
        } catch (e: Exception) {
            broadcastStatus("error", false, "دسترسی ضبط صدا لغو شد")
            stopEverything()
            return
        }

        startedAt = System.currentTimeMillis()
        isStopping = false
        acquireWakeLock()

        // پخش صدای دوبله
        player = AudioPlayerEngine(voiceChannel).also {
            it.dubVolume = dubVol
            it.start()
        }

        // کلاینت Gemini با Session Rotation
        client = GeminiLiveClient(apiKey, clientListener).also { it.start(targetLang) }

        // ضبط صدای سیستم (همه اپ‌ها)
        val proj = projection ?: return
        capture = AudioCaptureEngine(
            projection = proj,
            onPcm16k = { pcm -> handleCapturedPcm(pcm) },
            onProjectionRevoked = {
                handler.post {
                    if (!isStopping) {
                        broadcastStatus("error", false, "دسترسی ضبط توسط سیستم لغو شد")
                        stopEverything()
                    }
                }
            }
        ).also { it.start() }

        updateNotification("دوبله فعال (${langLabel(targetLang)})")
        broadcastStatus("dubbing", false, "دوبله فعال — هر اپی را پخش کنید ✅")
    }

    private fun getProjectionData(intent: Intent): Intent? {
        return if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(EXTRA_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_DATA)
        }
    }

    // ─────────────── جریان صدا ───────────────

    private fun handleCapturedPcm(pcm: ShortArray) {
        val c = client ?: return
        if (c.isOpen) {
            synchronized(bufferLock) { flushBufferLocked(c) }
            c.sendAudioPcm16k(pcm)
        } else {
            // سوکت در حال تعویض/اتصال مجدد است → بافر
            synchronized(bufferLock) {
                while (audioBuffer.size >= MAX_BUFFER_CHUNKS) audioBuffer.poll()
                audioBuffer.addLast(pcm)
            }
        }
    }

    private fun flushBufferLocked(c: GeminiLiveClient) {
        while (audioBuffer.isNotEmpty()) {
            c.sendAudioPcm16k(audioBuffer.poll())
        }
    }

    // ─────────────── کلاینت ───────────────

    private val clientListener = object : GeminiLiveClient.Listener {
        override fun onAudioOut(base64Pcm24k: String) {
            player?.enqueueBase64(base64Pcm24k)
        }

        override fun onTranscript(isInput: Boolean, text: String) {
            synchronized(subtitles) {
                val prefix = if (isInput) "⇢ " else "★ "
                val last = subtitles.peekLast()
                if (last != null && last.startsWith(prefix) && (last.length + text.length) < 90) {
                    subtitles.removeLast()
                    subtitles.addLast(last + text)
                } else {
                    subtitles.addLast(prefix + text)
                    while (subtitles.size > 12) subtitles.pollFirst()
                }
            }
            throttledSubtitleBroadcast()
        }

        override fun onState(message: String, reconnecting: Boolean) {
            updateNotification(message)
            broadcastStatus(
                if (reconnecting) "reconnecting" else "dubbing",
                reconnecting,
                message
            )
        }

        override fun onConnected() {
            val c = client ?: return
            synchronized(bufferLock) { flushBufferLocked(c) }
        }

        override fun onStats(rotations: Int, reconnects: Int) {
            broadcastStats(rotations, reconnects)
        }
    }

    private fun throttledSubtitleBroadcast() {
        val now = System.currentTimeMillis()
        if (now - lastSubtitleBroadcast < 300) return
        lastSubtitleBroadcast = now
        handler.post { broadcastStatus("dubbing", false, null) }
    }

    // ─────────────── توقف ───────────────

    private fun stopEverything() {
        if (isStopping) return
        isStopping = true

        try { capture?.stop() } catch (_: Exception) {}
        capture = null

        try { client?.stop() } catch (_: Exception) {}
        client = null

        try { player?.stop() } catch (_: Exception) {}
        player = null

        try { projection?.stop() } catch (_: Exception) {}
        projection = null

        releaseWakeLock()
        synchronized(bufferLock) { audioBuffer.clear() }
        synchronized(subtitles) { subtitles.clear() }
        startedAt = 0L

        broadcastStatus("idle", false, "")

        if (Build.VERSION.SDK_INT >= 33) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    // ─────────────── Wake Lock ───────────────

    private fun acquireWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LiveDub::dubbing").also {
            it.acquire(4 * 60 * 60 * 1000L) // سقف ۴ ساعت با تمدید خودکار سشن
        }
    }

    private fun releaseWakeLock() {
        try { wakeLock?.release() } catch (_: Exception) {}
        wakeLock = null
    }

    // ─────────────── اعلان‌ها ───────────────

    private fun createChannel() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            val ch = NotificationChannel(
                CHANNEL_ID, "سرویس دوبله زنده", NotificationManager.IMPORTANCE_LOW
            )
            ch.description = "نمایش وضعیت دوبله زنده"
            nm.createNotificationChannel(ch)
        }
    }

    private fun startAsForeground(text: String) {
        val n = buildNotification(text)
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIF_ID, n)
        }
    }

    private fun buildNotification(text: String): Notification {
        val stopIntent = PendingIntent.getService(
            this, 0,
            Intent(this, LiveDubService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val contentIntent = PendingIntent.getActivity(
            this, 1,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_livedub)
            .setContentTitle("LiveDub")
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(0, "توقف دوبله", stopIntent)
            .build()
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, buildNotification(text))
    }

    // ─────────────── برودکست وضعیت به UI ───────────────

    private fun broadcastStatus(state: String, reconnecting: Boolean, message: String?) {
        val i = Intent(ACTION_STATUS).setPackage(packageName)
            .putExtra(EXTRA_STATE, state)
            .putExtra(EXTRA_RECONNECTING, reconnecting)
            .putExtra(EXTRA_MESSAGE, message ?: "")
            .putExtra(EXTRA_ROTATIONS, 0) // آمار از broadcastStats می‌آید
            .putExtra(EXTRA_STARTED_AT, startedAt)
        i.putExtra(EXTRA_SUBTITLES, synchronized(subtitles) { subtitles.joinToString("\n") })
        sendBroadcast(i)
    }

    private fun broadcastStats(rotations: Int, reconnects: Int) {
        val i = Intent(ACTION_STATUS).setPackage(packageName)
            .putExtra(EXTRA_STATE, "dubbing")
            .putExtra(EXTRA_RECONNECTING, false)
            .putExtra(EXTRA_MESSAGE, "")
            .putExtra(EXTRA_ROTATIONS, rotations)
            .putExtra(EXTRA_RECONNECTS, reconnects)
            .putExtra(EXTRA_STARTED_AT, startedAt)
        i.putExtra(EXTRA_SUBTITLES, synchronized(subtitles) { subtitles.joinToString("\n") })
        sendBroadcast(i)
    }

    private fun langLabel(code: String): String = when (code) {
        "fa" -> "فارسی"
        "en" -> "انگلیسی"
        "tr" -> "ترکی"
        "ar" -> "عربی"
        "es" -> "اسپانیایی"
        "fr" -> "فرانسوی"
        "de" -> "آلمانی"
        "ru" -> "روسی"
        "zh-Hans" -> "چینی"
        "ja" -> "ژاپنی"
        "ko" -> "کره‌ای"
        else -> code.uppercase(Locale.ROOT)
    }
}
