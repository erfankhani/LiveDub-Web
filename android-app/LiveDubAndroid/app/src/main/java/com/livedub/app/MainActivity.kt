package com.livedub.app

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.livedub.app.ui.theme.LiveDubTheme

class MainActivity : ComponentActivity() {

    companion object {
        const val PREFS = "livedub"
    }

    private lateinit var projectionLauncher: ActivityResultLauncher<Intent>
    private lateinit var notifPermissionLauncher: ActivityResultLauncher<String>

    // وضعیت UI
    private var onStatus: ((StatusSnapshot) -> Unit)? = null

    data class StatusSnapshot(
        val state: String = "idle",
        val message: String = "",
        val reconnecting: Boolean = false,
        val rotations: Int = 0,
        val reconnects: Int = 0,
        val startedAt: Long = 0,
        val subtitles: String = ""
    )

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            intent ?: return
            val snap = StatusSnapshot(
                state = intent.getStringExtra(LiveDubService.EXTRA_STATE) ?: "idle",
                message = intent.getStringExtra(LiveDubService.EXTRA_MESSAGE) ?: "",
                reconnecting = intent.getBooleanExtra(LiveDubService.EXTRA_RECONNECTING, false),
                rotations = intent.getIntExtra(LiveDubService.EXTRA_ROTATIONS, 0),
                reconnects = intent.getIntExtra(LiveDubService.EXTRA_RECONNECTS, 0),
                startedAt = intent.getLongExtra(LiveDubService.EXTRA_STARTED_AT, 0),
                subtitles = intent.getStringExtra(LiveDubService.EXTRA_SUBTITLES) ?: ""
            )
            onStatus?.invoke(snap)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        projectionLauncher = registerForActivityResult(
            ActivityResultContracts.StartActivityForResult()
        ) { result ->
            val data = result.data
            if (result.resultCode == Activity.RESULT_OK && data != null) {
                val service = Intent(this, LiveDubService::class.java)
                    .setAction(LiveDubService.ACTION_START)
                    .putExtra(LiveDubService.EXTRA_RESULT_CODE, result.resultCode)
                    .putExtra(LiveDubService.EXTRA_DATA, data)
                ContextCompat.startForegroundService(this, service)
            }
        }

        notifPermissionLauncher = registerForActivityResult(
            ActivityResultContracts.RequestPermission()
        ) { launchProjectionConsent() }

        val filter = IntentFilter(LiveDubService.ACTION_STATUS)
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(statusReceiver, filter)
        }

        setContent {
            LiveDubTheme {
                AppScreen(
                    activity = this,
                    getStatus = { currentStatus },
                    registerStatusListener = { cb -> onStatus = cb },
                    onToggle = { toggleDubbing() }
                )
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        onStatus = null
        try { unregisterReceiver(statusReceiver) } catch (_: Exception) {}
    }

    var currentStatus = StatusSnapshot()
        private set

    private fun toggleDubbing() {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val running = currentStatus.state == "dubbing" ||
                currentStatus.state == "reconnecting"
        if (running) {
            val stop = Intent(this, LiveDubService::class.java)
                .setAction(LiveDubService.ACTION_STOP)
            startService(stop)
            return
        }
        // اجازه نوتیفیکیشن (API 33+) سپس رضایت MediaProjection
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            launchProjectionConsent()
        }
    }

    private fun launchProjectionConsent() {
        val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projectionLauncher.launch(mgr.createScreenCaptureIntent())
    }
}
