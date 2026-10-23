package sk.zdravie.app.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import sk.zdravie.app.ui.theme.DarkTokens
import sk.zdravie.app.ui.theme.LightTokens
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.ZTokens
import sk.zdravie.app.ui.theme.panelColor
import sk.zdravie.app.ui.theme.zMaterialTypography
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private fun schemeFor(t: ZTokens, dark: Boolean): ColorScheme {
    val panel = panelColor(t)
    val container = t.accent.copy(alpha = 0.22f).compositeOver(t.bg)
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = if (dark) t.accent else t.accentText,
        onPrimary = if (dark) Color(0xFF2B1C00) else Color.White,
        primaryContainer = container,
        onPrimaryContainer = t.accentText,
        secondary = t.sleep,
        onSecondary = if (dark) Color(0xFF161342) else Color.White,
        secondaryContainer = t.sleep.copy(alpha = 0.22f).compositeOver(t.bg),
        onSecondaryContainer = t.ink,
        tertiary = t.heart,
        onTertiary = if (dark) Color(0xFF3B0A1B) else Color.White,
        background = t.bg,
        onBackground = t.ink,
        surface = panel,
        onSurface = t.ink,
        surfaceVariant = t.track.compositeOver(panel),
        onSurfaceVariant = t.ink2,
        surfaceTint = t.accent,
        surfaceContainerLowest = t.bg,
        surfaceContainerLow = panel,
        surfaceContainer = panel,
        surfaceContainerHigh = t.track.compositeOver(panel),
        surfaceContainerHighest = t.track.compositeOver(panel),
        outline = t.muted,
        outlineVariant = t.line.compositeOver(t.bg),
        error = if (dark) Color(0xFFFFB4AB) else Color(0xFFB42A2A),
        errorContainer = if (dark) Color(0xFF572422) else Color(0xFFFFDAD6),
        onErrorContainer = if (dark) Color(0xFFFFDAD6) else Color(0xFF410003),
    )
}

private val DarkColors = schemeFor(DarkTokens, dark = true)
private val LightColors = schemeFor(LightTokens, dark = false)

/** The account preference wins; an absent or unknown preference follows Android. */
@Composable
@Suppress("DEPRECATION") // System-bar colors remain effective on the supported API 26–28 devices.
internal fun ZdravieTheme(theme: String?, content: @Composable () -> Unit) {
    val dark = when (theme) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }
    val view = LocalView.current
    if (!view.isInEditMode) {
        val window = view.context.findActivity()?.window
        SideEffect {
            window?.let {
                if (Build.VERSION.SDK_INT < 29) {
                    // enableEdgeToEdge's legacy scrim follows the OS theme; replace it when the app differs.
                    it.navigationBarColor = legacyNavigationBarColor(dark)
                }
                WindowCompat.getInsetsController(it, view).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
            }
        }
    }
    CompositionLocalProvider(LocalZTokens provides (if (dark) DarkTokens else LightTokens)) {
        MaterialTheme(colorScheme = if (dark) DarkColors else LightColors, typography = zMaterialTypography(), content = content)
    }
}

internal fun legacyNavigationBarColor(dark: Boolean): Int =
    (if (dark) DarkColors else LightColors).background.toArgb()

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.takeUnless { it === this }?.findActivity()
    else -> null
}
