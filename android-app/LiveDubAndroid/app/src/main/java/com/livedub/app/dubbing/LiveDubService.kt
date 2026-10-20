package com.livedub.app.dubbing

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioManager
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
        // ⭐ v2.4: کنترل زنده ولوم‌ها از UI — بدون نیاز به ری‌استارت دوبله
        const val ACTION_SET_DUB_VOLUME = "com.livedub.app.action.SET_DUB_VOLUME"
        const val ACTION_SET_MEDIA_VOLUME = "com.livedub.app.action.SET_MEDIA_VOLUME"
        const val EXTRA_DUB_VOL = "dubVol"       // Float 0..1 → گین صدای دوبله
        const val EXTRA_MEDIA_VOL = "mediaVol"   // Int 0..max → ولوم رسانه (صدای اپ مبدأ)

        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_DATA = "data"
        const val EXTRA_STATE = "state"             // idle | dubbing | reconnecting | error
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_RECONNECTING = "reconnecting"
        const val EXTRA_ROTATIONS = "rotations"
        const val EXTRA_RECONNECTS = "reconnects"
        const val EXTRA_STARTED_AT = "startedAt"
        const val EXTRA_SUBTITLES = "subtitles"     // آخرین خطوط زیرنویس با \n
        const val EXTRA_SENT_KB = "sentKb"          // ⭐ دیاگنوستیک: KB صدای ارسالی
        const val EXTRA_RECV_KB = "recvKb"          // ⭐ دیاگنوستیک: KB صدای دوبله دریافتی
        const val EXTRA_INPUT_LEVEL = "inputLevel"  // ⭐ دیاگنوستیک: سطح صدا ورودی 0..1
        const val EXTRA_WARN = "warn"               // none | warn | error
        const val EXTRA_CAPTURE_CHUNKS = "captureChunks" // ⭐ دیاگنوستیک: چانک‌های خوانده‌شده ضبط
        const val EXTRA_SETUP_OK = "setupOk"        // ⭐ دیاگنوستیک: setupComplete دریافت شد؟
        const val EXTRA_SOCKET_OPEN = "socketOpen"  // ⭐ دیاگنوستیک: سوکت باز است؟
        const val EXTRA_MSG_IN = "msgIn"            // ⭐ دیاگنوستیک: تعداد پیام‌های دریافتی از سرور

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

    // ⭐ دیاگنوستیک: سکوت ورودی + آمار زنده برای UI
    @Volatile private var lastInputLevel = 0f
    @Volatile private var lastRotations = 0
    @Volatile private var lastReconnects = 0
    @Volatile private var lastReconnecting = false
    private var maxAmpEver = 0f
    private var inputChunks = 0
    private var silenceWarned = false
    private val statsTicker: Runnable = object : Runnable {
        override fun run() {
            if (isStopping || startedAt == 0L) return
            broadcastStatsLive()
            handler.postDelayed(this, 2000)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopEverything()
                return START_NOT_STICKY
            }
            ACTION_START -> startDubbing(intent)
            // ⭐ v2.4: تغییر زنده ولوم دوبله حین دوبله (بدون ری‌استارت)
            ACTION_SET_DUB_VOLUME -> {
                val v = intent.getFloatExtra(EXTRA_DUB_VOL, 1f).coerceIn(0f, 1f)
                player?.setVolume(v)
                getSharedPreferences("livedub", Context.MODE_PRIVATE)
                    .edit().putFloat("dubVolume", v).apply()
                return START_NOT_STICKY
            }
            // ⭐ v2.4: کنترل زنده «صدای اصلی» = ولوم استریم رسانه (همان ولومی که اپ مبدأ مثل یوتیوب پخش می‌کند)
            ACTION_SET_MEDIA_VOLUME -> {
                val v = intent.getIntExtra(EXTRA_MEDIA_VOL, -1)
                if (v >= 0) setMediaVolume(v)
                return START_NOT_STICKY
            }
            else -> return START_NOT_STICKY
        }
        return START_NOT_STICKY
    }

    private fun setMediaVolume(v: Int) {
        try {
            val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            am.setStreamVolume(AudioManager.STREAM_MUSIC, v.coerceIn(0, max), 0)
        } catch (_: Exception) {}
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
            it.onError = { msg ->
                handler.post {
                    if (!isStopping) broadcastStatus("dubbing", lastReconnecting, msg, "error")
                }
            }
            it.start()
        }

        // کلاینت Gemini با Session Rotation
        client = GeminiLiveClient(apiKey, clientListener).also { it.start(targetLang) }

        // ضبط صدای سیستم (همه اپ‌ها)
        val proj = projection ?: return
        capture = AudioCaptureEngine(
            projection = proj,
            onPcm16k = { pcm -> handleCapturedPcm(pcm) },
            onInputLevel = { lvl ->
                lastInputLevel = lvl
                handleSilenceWatchdog(lvl)
            },
            onCaptureError = { msg ->
                handler.post {
                    if (!isStopping) {
                        broadcastStatus("error", false, msg, "error")
                        stopEverything()
                    }
                }
            },
            onProjectionRevoked = {
                handler.post {
                    if (!isStopping) {
                        broadcastStatus("error", false, "دسترسی ضبط توسط سیستم لغو شد", "error")
                        stopEverything()
                    }
                }
            }
        ).also { it.start() }

        handler.post(statsTicker) // شروع ارسال آمار زنده به UI
        updateNotification("دوبله فعال (${langLabel(targetLang)})")
        broadcastStatus("dubbing", false, "دوبله فعال — هر اپی را پخش کنید ✅")
    }

    /** ⭐ اگر ۳ ثانیه اول صدا کاملاً ساکت بود، احتمالاً تاگل «اشتراک صدا» خاموش است */
    private fun handleSilenceWatchdog(level: Float) {
        inputChunks++
        if (level > maxAmpEver) maxAmpEver = level
        if (!silenceWarned && inputChunks >= 30 && maxAmpEver < 0.008f) {
            silenceWarned = true
            handler.post {
                broadcastStatus(
                    "dubbing", lastReconnecting,
                    "صدایی از دستگاه دریافت نمی‌شود! در پنجره اجازه ضبط، گزینه «اشتراک صدا» را روشن کنید و ولوم اپ مقصد را بالا ببرید.",
                    "warn"
                )
            }
        } else if (silenceWarned && maxAmpEver >= 0.008f) {
            silenceWarned = false // صدا برگشت → هشدار در broadcast بعدی پاک می‌شود
        }
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
            lastReconnecting = reconnecting
            updateNotification(message)
            broadcastStatus(
                if (reconnecting) "reconnecting" else "dubbing",
                reconnecting,
                message,
                "none"
            )
        }

        override fun onError(message: String) {
            handler.post {
                if (!isStopping) broadcastStatus("dubbing", lastReconnecting, message, "error")
            }
        }

        override fun onConnected() {
            val c = client ?: return
            synchronized(bufferLock) { flushBufferLocked(c) }
        }

        override fun onStats(rotations: Int, reconnects: Int, sentKb: Int, recvKb: Int) {
            lastRotations = rotations
            lastReconnects = reconnects
            broadcastStatsLive()
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
        handler.removeCallbacks(statsTicker)
        synchronized(bufferLock) { audioBuffer.clear() }
        synchronized(subtitles) { subtitles.clear() }
        startedAt = 0L
        lastInputLevel = 0f
        maxAmpEver = 0f
        inputChunks = 0
        silenceWarned = false
        lastReconnecting = false

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

    private fun broadcastStatus(state: String, reconnecting: Boolean, message: String?, level: String = "none") {
        sendBroadcast(statusIntent(state, reconnecting, message ?: "", level))
    }

    /** آمار زنده (هر ۲ ثانیه + بعد از هر onStats) برای متر و شمارنده‌ها */
    private fun broadcastStatsLive() {
        val c = client
        val i = statusIntent(
            if (lastReconnecting) "reconnecting" else "dubbing",
            lastReconnecting,
            "",
            if (silenceWarned) "warn" else "none"
        )
        i.putExtra(EXTRA_SENT_KB, ((c?.sentBytes ?: 0L) / 1024L).toInt())
        i.putExtra(EXTRA_RECV_KB, ((c?.recvAudioBytes ?: 0L) / 1024L).toInt())
        i.putExtra(EXTRA_INPUT_LEVEL, lastInputLevel)
        i.putExtra(EXTRA_CAPTURE_CHUNKS, (capture?.chunksRead ?: 0L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
        i.putExtra(EXTRA_SETUP_OK, c?.isSetupComplete ?: false)
        i.putExtra(EXTRA_SOCKET_OPEN, c?.isOpen ?: false)
        i.putExtra(EXTRA_MSG_IN, (c?.msgInCount ?: 0L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
        sendBroadcast(i)
    }

    private fun statusIntent(state: String, reconnecting: Boolean, message: String, warn: String): Intent {
        val i = Intent(ACTION_STATUS).setPackage(packageName)
            .putExtra(EXTRA_STATE, state)
            .putExtra(EXTRA_RECONNECTING, reconnecting)
            .putExtra(EXTRA_MESSAGE, message)
            .putExtra(EXTRA_WARN, warn)
            .putExtra(EXTRA_ROTATIONS, lastRotations)
            .putExtra(EXTRA_RECONNECTS, lastReconnects)
            .putExtra(EXTRA_STARTED_AT, startedAt)
        i.putExtra(EXTRA_SUBTITLES, synchronized(subtitles) { subtitles.joinToString("\n") })
        return i
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
