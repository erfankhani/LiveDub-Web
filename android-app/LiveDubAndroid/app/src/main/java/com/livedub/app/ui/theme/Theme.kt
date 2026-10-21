package com.livedub.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// پالت حرفه‌ای سبز زمردی روی زمینه تیره
val Emerald = Color(0xFF10B981)
val EmeraldLight = Color(0xFF34D399)
val EmeraldDark = Color(0xFF059669)
val BgDark = Color(0xFF0B0F0E)
val SurfaceDark = Color(0xFF121716)
val SurfaceDark2 = Color(0xFF182020)
val LineDark = Color(0xFF24302D)
val TextPrimary = Color(0xFFE8EFEC)
val TextMuted = Color(0xFF93A49E)
val Danger = Color(0xFFF87171)
val Amber = Color(0xFFFBBF24)

private val DarkScheme = darkColorScheme(
    primary = Emerald,
    onPrimary = Color(0xFF04110C),
    secondary = EmeraldLight,
    onSecondary = Color(0xFF04110C),
    tertiary = EmeraldDark,
    background = BgDark,
    onBackground = TextPrimary,
    surface = SurfaceDark,
    onSurface = TextPrimary,
    surfaceVariant = SurfaceDark2,
    onSurfaceVariant = TextMuted,
    outline = LineDark,
    error = Danger
)

@Composable
fun LiveDubTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    // اپ به‌صورت پیش‌فرض تم تیره حرفه‌ای دارد
    MaterialTheme(
        colorScheme = if (darkTheme) DarkScheme else DarkScheme,
        content = content
    )
}
