package com.livedub.app.ui

import android.content.Context
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.livedub.app.MainActivity
import com.livedub.app.ui.theme.Amber
import com.livedub.app.ui.theme.Danger
import com.livedub.app.ui.theme.Emerald
import com.livedub.app.ui.theme.EmeraldLight
import com.livedub.app.ui.theme.TextMuted
import kotlinx.coroutines.delay

private val LANGS = listOf(
    "fa" to "فارسی", "en" to "انگلیسی", "tr" to "ترکی", "ar" to "عربی",
    "es" to "اسپانیایی", "fr" to "فرانسوی", "de" to "آلمانی", "ru" to "روسی",
    "zh-Hans" to "چینی", "ja" to "ژاپنی", "ko" to "کره‌ای"
)

private fun faNum(n: Int): String =
    n.toString().map { "۰۱۲۳۴۵۶۷۸۹"[Character.getNumericValue(it)] }.joinToString("")

@Composable
fun AppScreen(
    activity: MainActivity,
    getStatus: () -> MainActivity.StatusSnapshot,
    registerStatusListener: ((MainActivity.StatusSnapshot) -> Unit) -> Unit,
    onToggle: () -> Unit
) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE) }

    var apiKey by remember { mutableStateOf(prefs.getString("apiKey", "") ?: "") }
    var showKey by remember { mutableStateOf(false) }
    var lang by remember { mutableStateOf(prefs.getString("targetLang", "fa") ?: "fa") }
    var dubVol by remember { mutableStateOf((prefs.getFloat("dubVolume", 1.0f) * 100).toInt()) }
    var voiceChannel by remember { mutableStateOf(prefs.getBoolean("voiceChannel", false)) }
    var langMenuOpen by remember { mutableStateOf(false) }

    var status by remember { mutableStateOf(getStatus()) }
    LaunchedEffect(Unit) { registerStatusListener { status = it } }

    // آخرین پیام غیرخالی (چون broadcast آمار پیام را خالی می‌کند)
    var lastMessage by remember { mutableStateOf("") }
    LaunchedEffect(status.message) {
        if (status.message.isNotBlank()) lastMessage = status.message
    }

    // تایمر uptime
    var uptimeSec by remember { mutableStateOf(0) }
    val running = status.state == "dubbing" || status.state == "reconnecting"
    LaunchedEffect(status.startedAt, running) {
        while (running && status.startedAt > 0) {
            uptimeSec = ((System.currentTimeMillis() - status.startedAt) / 1000).toInt()
            delay(1000)
        }
        if (!running) uptimeSec = 0
    }

    fun persist() {
        prefs.edit()
            .putString("apiKey", apiKey.trim())
            .putString("targetLang", lang)
            .putFloat("dubVolume", dubVol / 100f)
            .putBoolean("voiceChannel", voiceChannel)
            .apply()
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF0B0F0E), Color(0xFF0D1512), Color(0xFF0B0F0E))
                )
            )
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            Header(running, status.state)

            if (status.reconnecting) {
                Spacer(Modifier.height(10.dp))
                ReconnectBanner(status.message)
            }
            if ((status.state == "error" || status.warn == "error") && lastMessage.isNotBlank()) {
                Spacer(Modifier.height(10.dp))
                ErrorBanner(lastMessage)
            } else if (status.warn == "warn" && running) {
                Spacer(Modifier.height(10.dp))
                WarnBanner()
            }

            Spacer(Modifier.height(14.dp))

            // ── تنظیمات ──
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF121716)),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(Modifier.padding(14.dp)) {
                    Text("کلید Gemini API", fontSize = 12.sp, color = TextMuted, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(7.dp))
                    OutlinedTextField(
                        value = apiKey,
                        onValueChange = { apiKey = it; persist() },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("AIzaSy…", color = TextMuted, fontSize = 13.sp) },
                        visualTransformation = if (showKey) androidx.compose.ui.text.input.VisualTransformation.None
                        else androidx.compose.ui.text.input.PasswordVisualTransformation(),
                        trailingIcon = {
                            IconButton(onClick = { showKey = !showKey }) {
                                Icon(
                                    if (showKey) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription = null,
                                    tint = TextMuted
                                )
                            }
                        },
                        singleLine = true,
                        shape = RoundedCornerShape(11.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Emerald,
                            unfocusedBorderColor = Color(0xFF24302D),
                            cursorColor = Emerald,
                            focusedTextColor = Color(0xFFE8EFEC),
                            unfocusedTextColor = Color(0xFFE8EFEC)
                        )
                    )
                    Spacer(Modifier.height(6.dp))
                    Text("کلید فقط روی دستگاه شما ذخیره می‌شود.", fontSize = 10.5.sp, color = TextMuted)

                    Spacer(Modifier.height(13.dp))

                    Text("زبان خروجی دوبله", fontSize = 12.sp, color = TextMuted, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(7.dp))
                    Box {
                        Surface(
                            shape = RoundedCornerShape(11.dp),
                            color = Color(0xFF182020),
                            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF24302D)),
                            onClick = { langMenuOpen = true },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                Modifier.padding(horizontal = 13.dp, vertical = 12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(LANGS.first { it.first == lang }.second, fontSize = 13.5.sp, color = Color(0xFFE8EFEC))
                                Icon(Icons.Default.KeyboardArrowDown, null, tint = TextMuted)
                            }
                        }
                        DropdownMenu(
                            expanded = langMenuOpen,
                            onDismissRequest = { langMenuOpen = false },
                            modifier = Modifier.background(Color(0xFF182020))
                        ) {
                            LANGS.forEach { (code, label) ->
                                DropdownMenuItem(
                                    text = {
                                        Text(
                                            label,
                                            color = if (code == lang) Emerald else Color(0xFFE8EFEC),
                                            fontSize = 13.5.sp
                                        )
                                    },
                                    onClick = { lang = code; persist(); langMenuOpen = false }
                                )
                            }
                        }
                    }

                    Spacer(Modifier.height(13.dp))

                    Text("صدای دوبله: ${faNum(dubVol)}٪", fontSize = 12.sp, color = TextMuted, fontWeight = FontWeight.SemiBold)
                    Slider(
                        value = dubVol.toFloat(),
                        onValueChange = { dubVol = it.toInt(); persist() },
                        colors = SliderDefaults.colors(
                            thumbColor = Color.White,
                            activeTrackColor = Emerald,
                            inactiveTrackColor = Color(0xFF24302D)
                        )
                    )

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("پخش دوبله روی کانال مکالمه", fontSize = 12.5.sp, color = Color(0xFFE8EFEC))
                            Text(
                                "ولوم رسانه را کم کنید تا صدای اصلی کم شود",
                                fontSize = 10.5.sp, color = TextMuted
                            )
                        }
                        Switch(
                            checked = voiceChannel,
                            onCheckedChange = { voiceChannel = it; persist() },
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = Color.White,
                                checkedTrackColor = Emerald
                            )
                        )
                    }
                }
            }

            Spacer(Modifier.height(13.dp))

            // ── دکمه ──
            Button(
                onClick = { persist(); onToggle() },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (running) Danger else Emerald,
                    contentColor = if (running) Color.White else Color(0xFF04110C)
                )
            ) {
                Icon(if (running) Icons.Default.Pause else Icons.Default.Mic, null, Modifier.size(19.dp))
                Spacer(Modifier.width(8.dp))
                Text(
                    if (running) "توقف دوبله" else "شروع دوبله (دسترسی ضبط صدا)",
                    fontSize = 14.5.sp, fontWeight = FontWeight.Bold
                )
            }

            Spacer(Modifier.height(13.dp))

            // ── وضعیت ──
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF121716)),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(Modifier.padding(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("وضعیت", fontSize = 12.5.sp, color = TextMuted, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.weight(1f))
                        if (running) {
                            PulsingDot()
                            Spacer(Modifier.width(6.dp))
                        }
                        Text(
                            when {
                                status.reconnecting -> "اتصال مجدد…"
                                status.state == "dubbing" -> "در حال دوبله"
                                status.state == "starting" -> "آماده‌سازی…"
                                status.state == "error" -> "خطا"
                                else -> "غیرفعال"
                            },
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = when {
                                status.reconnecting -> Amber
                                running -> Emerald
                                status.state == "error" -> Danger
                                else -> TextMuted
                            }
                        )
                    }
                    if (status.message.isNotBlank()) {
                        Spacer(Modifier.height(6.dp))
                        Text(status.message, fontSize = 11.sp, color = TextMuted, lineHeight = 17.sp)
                    }

                    if (running) {
                        Spacer(Modifier.height(11.dp))
                        Row(Modifier.fillMaxWidth()) {
                            StatCell(faNum(uptimeSec / 60) + ":" + faNum(uptimeSec % 60).padStart(2, '۰'), "زمان دوبله", Modifier.weight(1f))
                            StatCell(faNum(status.rotations), "تمدید سشن", Modifier.weight(1f))
                            StatCell(faNum(status.reconnects), "اتصال مجدد", Modifier.weight(1f))
                        }
                        Spacer(Modifier.height(8.dp))
                        Row(Modifier.fillMaxWidth()) {
                            StatCell(faNum(status.sentKb) + " KB", "صدا ارسالی ↑", Modifier.weight(1f))
                            StatCell(faNum(status.recvKb) + " KB", "دوبله دریافتی ↓", Modifier.weight(1f))
                            StatCell(faNum(status.captureChunks), "چانک ضبط", Modifier.weight(1f))
                        }

                        // ⭐⭐ نوار تشخیص زنده — هر مرحله خط لوله را جدا نشان می‌دهد
                        Spacer(Modifier.height(10.dp))
                        DiagStrip(
                            socketOpen = status.socketOpen,
                            setupOk = status.setupOk,
                            capturing = status.captureChunks > 0
                        )

                        // ⭐ متر زنده صدا ورودی — اگر صفر بماند یعنی کپچر صدا کار نمی‌کند
                        Spacer(Modifier.height(10.dp))
                        Text("سطح صدای ورودی از دستگاه", fontSize = 10.5.sp, color = TextMuted)
                        Spacer(Modifier.height(4.dp))
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(7.dp)
                                .background(Color(0xFF1C2624), RoundedCornerShape(99.dp))
                        ) {
                            Box(
                                Modifier
                                    .fillMaxWidth(status.inputLevel.coerceIn(0f, 1f))
                                    .height(7.dp)
                                    .background(
                                        if (status.inputLevel > 0.004f) Emerald else Color(0xFF3B4A46),
                                        RoundedCornerShape(99.dp)
                                    )
                            )
                        }
                        if (status.captureChunks <= 0) {
                            Spacer(Modifier.height(3.dp))
                            Text(
                                "✕ ضبط صدا هیچ داده‌ای نخوانده — دوباره شروع کنید و «اشتراک صدا» را روشن کنید",
                                fontSize = 10.sp, color = Danger
                            )
                        } else if (status.inputLevel <= 0.004f) {
                            Spacer(Modifier.height(3.dp))
                            Text(
                                "⚠ ساکت — گزینه «اشتراک صدا» را در پنجره دسترسی روشن کنید",
                                fontSize = 10.sp, color = Amber
                            )
                        }
                    }

                    if (running && status.subtitles.isNotBlank()) {
                        Spacer(Modifier.height(11.dp))
                        Text("زیرنویس زنده", fontSize = 11.sp, color = TextMuted)
                        Spacer(Modifier.height(6.dp))
                        Surface(
                            color = Color(0xFF0E1413),
                            shape = RoundedCornerShape(11.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                status.subtitles,
                                fontSize = 11.sp,
                                color = Color(0xFFD1FAE5),
                                lineHeight = 18.sp,
                                modifier = Modifier
                                    .padding(10.dp)
                                    .height(120.dp)
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(13.dp))

            // ── راهنما ──
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF121716)),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(Modifier.padding(14.dp)) {
                    Text("چطور کار می‌کند؟", fontSize = 12.5.sp, fontWeight = FontWeight.Bold, color = Color(0xFFE8EFEC))
                    Spacer(Modifier.height(8.dp))
                    GuideLine("۱. روی «شروع دوبله» بزنید و در پنجره دسترسی، حتماً گزینه «اشتراک صدا / Share device audio» را روشن کنید")
                    GuideLine("۲. به هر اپی بروید (یوتیوب، تلگرام، مرورگر و…) و ویدیو پخش کنید")
                    GuideLine("۳. دوبله فارسی از روی صدای همان اپ پخش می‌شود — حتی در پس‌زمینه با صفحه خاموش")
                    GuideLine("۴. سشن هر ~۱۳ دقیقه به‌صورت خودکار تمدید می‌شود؛ دیگر هیچ‌وقت قطع نمی‌شود")
                    GuideLine("۵. برای شنیدن صدای اصلی کمتر: ولوم رسانه را کم کنید (با کانال مکالمه فعال)")
                }
            }

            Spacer(Modifier.height(20.dp))
            Text(
                "LiveDub v2.2 · دوبله زنده با Gemini Live Translate",
                fontSize = 10.sp, color = TextMuted,
                modifier = Modifier.align(Alignment.CenterHorizontally)
            )
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun Header(running: Boolean, state: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Surface(
            shape = RoundedCornerShape(13.dp),
            color = Color.Transparent
        ) {
            Box(
                Modifier
                    .size(44.dp)
                    .background(
                        Brush.linearGradient(listOf(Emerald, EmeraldLight)),
                        RoundedCornerShape(13.dp)
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.Mic, null, tint = Color(0xFF04110C), modifier = Modifier.size(24.dp))
            }
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text("LiveDub", fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, color = Color(0xFFE8EFEC))
            Text("دوبله زنده با Gemini · v2.2", fontSize = 11.sp, color = TextMuted)
        }
        Surface(
            shape = RoundedCornerShape(99.dp),
            color = Color(0xFF182020),
            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF24302D))
        ) {
            Row(
                Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .size(7.dp)
                        .background(
                            when {
                                running -> Emerald
                                state == "error" -> Danger
                                else -> Color(0xFF64748B)
                            }, CircleShape
                        )
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    when {
                        running -> "فعال"
                        state == "error" -> "خطا"
                        else -> "غیرفعال"
                    },
                    fontSize = 11.sp, color = TextMuted
                )
            }
        }
    }
}

@Composable
private fun DiagStrip(socketOpen: Boolean, setupOk: Boolean, capturing: Boolean) {
    Surface(
        shape = RoundedCornerShape(11.dp),
        color = Color(0xFF0E1413),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            DiagChip("سوکت", socketOpen, "وصل", "قطع")
            DiagChip("تأیید سرور", setupOk, "دریافت شد", "در انتظار…")
            DiagChip("ضبط صدا", capturing, "فعال", "بدون داده")
        }
    }
}

@Composable
private fun DiagChip(label: String, ok: Boolean, okText: String, badText: String) {
    val color = if (ok) Emerald else if (label == "تأیید سرور") Amber else Danger
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(7.dp)
                .background(color, CircleShape)
        )
        Spacer(Modifier.width(5.dp))
        Column {
            Text(label, fontSize = 9.sp, color = TextMuted)
            Text(
                if (ok) "✓ $okText" else if (label == "تأیید سرور") "⏳ $badText" else "✕ $badText",
                fontSize = 10.sp,
                color = color,
                fontWeight = FontWeight.SemiBold
            )
        }
    }
}

@Composable
private fun PulsingDot() {
    val transition = rememberInfiniteTransition(label = "pulse")
    val alpha by transition.animateFloat(
        initialValue = 1f, targetValue = 0.25f,
        animationSpec = infiniteRepeatable(tween(800), RepeatMode.Reverse),
        label = "alpha"
    )
    Box(
        Modifier
            .size(9.dp)
            .background(Emerald.copy(alpha = alpha), CircleShape)
    )
}

@Composable
private fun StatCell(value: String, label: String, modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, color = EmeraldLight)
        Text(label, fontSize = 9.5.sp, color = TextMuted)
    }
}

@Composable
private fun GuideLine(text: String) {
    Row(Modifier.padding(vertical = 3.dp)) {
        Text("•", color = Emerald, fontSize = 11.sp)
        Spacer(Modifier.width(6.dp))
        Text(text, fontSize = 11.sp, color = TextMuted, lineHeight = 17.sp)
    }
}

@Composable
private fun ReconnectBanner(message: String) {
    Surface(
        shape = RoundedCornerShape(11.dp),
        color = Amber.copy(alpha = 0.10f),
        border = androidx.compose.foundation.BorderStroke(1.dp, Amber.copy(alpha = 0.3f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Text("⟳ $message", fontSize = 11.5.sp, color = Amber, modifier = Modifier.padding(9.dp))
    }
}

@Composable
private fun WarnBanner() {
    Surface(
        shape = RoundedCornerShape(11.dp),
        color = Amber.copy(alpha = 0.10f),
        border = androidx.compose.foundation.BorderStroke(1.dp, Amber.copy(alpha = 0.35f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(10.dp)) {
            Text(
                "⚠ صدای ورودی ساکت است!",
                fontSize = 12.sp, color = Amber, fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(3.dp))
            Text(
                "در پنجره اجازه ضبط، گزینه «اشتراک صدا / Share device audio» را روشن کنید و ولوم اپ مقصد (مثلاً یوتیوب) را بالا ببرید.",
                fontSize = 11.sp, color = Amber.copy(alpha = 0.85f), lineHeight = 17.sp
            )
        }
    }
}

@Composable
private fun ErrorBanner(message: String) {
    Surface(
        shape = RoundedCornerShape(11.dp),
        color = Danger.copy(alpha = 0.09f),
        border = androidx.compose.foundation.BorderStroke(1.dp, Danger.copy(alpha = 0.25f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Text("⚠ $message", fontSize = 11.5.sp, color = Danger, modifier = Modifier.padding(9.dp))
    }
}
