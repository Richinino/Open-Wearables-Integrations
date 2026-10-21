package sk.zdravie.app.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkColors = darkColorScheme(
    primary = Color(0xFFE9B44C),
    onPrimary = Color(0xFF2B1C00),
    primaryContainer = Color(0xFF403214),
    onPrimaryContainer = Color(0xFFFFDDA0),
    secondary = Color(0xFF8F8CF2),
    onSecondary = Color(0xFF161342),
    secondaryContainer = Color(0xFF292650),
    onSecondaryContainer = Color(0xFFDEDCFF),
    tertiary = Color(0xFFF0718F),
    background = Color(0xFF08090C),
    onBackground = Color(0xFFF2F1ED),
    surface = Color(0xFF111318),
    onSurface = Color(0xFFF2F1ED),
    surfaceVariant = Color(0xFF202229),
    onSurfaceVariant = Color(0xFFB0B0AB),
    outline = Color(0xFF777A84),
    outlineVariant = Color(0xFF30323B),
    error = Color(0xFFFFB4AB),
    errorContainer = Color(0xFF572422),
    onErrorContainer = Color(0xFFFFDAD6),
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF805B12),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFE3A4),
    onPrimaryContainer = Color(0xFF332300),
    secondary = Color(0xFF5B57D6),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE5E1FF),
    onSecondaryContainer = Color(0xFF282064),
    tertiary = Color(0xFFB72A50),
    background = Color(0xFFEEF0F3),
    onBackground = Color(0xFF14161A),
    surface = Color(0xFFFBFBFC),
    onSurface = Color(0xFF14161A),
    surfaceVariant = Color(0xFFE5E7EC),
    onSurfaceVariant = Color(0xFF565962),
    outline = Color(0xFF777A84),
    outlineVariant = Color(0xFFD1D4DC),
    error = Color(0xFFB42A2A),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410003),
)

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
    MaterialTheme(colorScheme = if (dark) DarkColors else LightColors, content = content)
}

internal fun legacyNavigationBarColor(dark: Boolean): Int =
    (if (dark) DarkColors else LightColors).background.toArgb()

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.takeUnless { it === this }?.findActivity()
    else -> null
}
