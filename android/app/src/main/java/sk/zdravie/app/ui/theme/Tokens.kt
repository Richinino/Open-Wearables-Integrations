package sk.zdravie.app.ui.theme

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver

/** A2 "Nočný panel" colour tokens, as in the web artboard. [glass] is translucent; use [panelColor] to paint it. */
data class ZTokens(
    val bg: Color,
    val glass: Color,
    val ink: Color,
    val ink2: Color,
    val muted: Color,
    val line: Color,
    val track: Color,
    /** Fill colour of the accent (rings, bars, pills). */
    val accent: Color,
    /** Accent used for text: equals [accent] in dark, darker in light so it keeps 4.5:1 on [bg]. */
    val accentText: Color,
    val sleep: Color,
    val heart: Color,
    val deep: Color,
    val rem: Color,
    val lightSleep: Color,
    val good: Color,
    val warn: Color,
    val glow: Float,
)

private fun rgba(r: Int, g: Int, b: Int, a: Float) = Color(r / 255f, g / 255f, b / 255f, a)

val DarkTokens = ZTokens(
    bg = Color(0xFF08090C),
    glass = rgba(22, 24, 30, 0.66f),
    ink = Color(0xFFF2F1ED),
    ink2 = Color(0xFFA9A9A4),
    muted = Color(0xFF8B8B86),
    line = rgba(255, 255, 255, 0.09f),
    track = rgba(255, 255, 255, 0.08f),
    accent = Color(0xFFE9B44C),
    accentText = Color(0xFFE9B44C),
    sleep = Color(0xFF8F8CF2),
    heart = Color(0xFFF0718F),
    deep = Color(0xFF5B57D6),
    rem = Color(0xFF4FC7B8),
    lightSleep = Color(0xFFA9A6F7),
    good = Color(0xFF5FD08A),
    warn = Color(0xFFF2B35B),
    glow = 0.22f,
)

val LightTokens = ZTokens(
    bg = Color(0xFFEEF0F3),
    glass = rgba(255, 255, 255, 0.74f),
    ink = Color(0xFF14161A),
    ink2 = Color(0xFF565962),
    // Spec #6b6e77 is 4.46:1 on bg; darkened by 1 step to reach 4.5:1 (controller ruling 2).
    muted = Color(0xFF6A6D76),
    line = rgba(18, 24, 38, 0.10f),
    track = rgba(18, 24, 38, 0.09f),
    // color-mix(in oklab, #e9b44c 70%, #4a3200)
    accent = Color(0xFFB68A34),
    accentText = Color(0xFF7A5A14),
    sleep = Color(0xFF5B57D6),
    heart = Color(0xFFD6456B),
    deep = Color(0xFF2F2C9A),
    rem = Color(0xFF1F9C8D),
    lightSleep = Color(0xFF9A97EE),
    good = Color(0xFF178F4D),
    warn = Color(0xFFA86A00),
    glow = 0.30f,
)

/** Glass composited over the background: Compose has no backdrop blur on minSdk 26. */
fun panelColor(t: ZTokens): Color = t.glass.compositeOver(t.bg)

val LocalZTokens = staticCompositionLocalOf { DarkTokens }

private fun srgbToLinear(c: Float): Double = c.toDouble().let { if (it <= 0.04045) it / 12.92 else Math.pow((it + 0.055) / 1.055, 2.4) }
private fun linearToSrgb(c: Double): Float =
    (if (c <= 0.0031308) 12.92 * c else 1.055 * Math.pow(c, 1 / 2.4) - 0.055).coerceIn(0.0, 1.0).toFloat()

/** CSS `color-mix(in oklab, a [weightA]%, b)`; opaque result. */
fun mixOklab(a: Color, b: Color, weightA: Float): Color {
    fun lab(c: Color): DoubleArray {
        val r = srgbToLinear(c.red); val g = srgbToLinear(c.green); val bl = srgbToLinear(c.blue)
        val l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl)
        val m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl)
        val s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl)
        return doubleArrayOf(
            0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
        )
    }
    val x = lab(a); val y = lab(b); val w = weightA.toDouble()
    val L = w * x[0] + (1 - w) * y[0]; val A = w * x[1] + (1 - w) * y[1]; val B = w * x[2] + (1 - w) * y[2]
    val l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3.0)
    val m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3.0)
    val s = Math.pow(L - 0.0894841775 * A - 1.2914855480 * B, 3.0)
    return Color(
        linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    )
}
