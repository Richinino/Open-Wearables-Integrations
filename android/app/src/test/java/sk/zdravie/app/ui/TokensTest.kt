package sk.zdravie.app.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import org.junit.Assert.*
import org.junit.Test
import sk.zdravie.app.ui.theme.DarkTokens
import sk.zdravie.app.ui.theme.LightTokens
import sk.zdravie.app.ui.theme.ZTokens
import sk.zdravie.app.ui.theme.panelColor
import kotlin.math.cbrt
import kotlin.math.pow
import kotlin.math.roundToInt

class TokensTest {
    private fun hex(v: Long) = Color(0xFF000000L or v)
    private fun rgba(r: Int, g: Int, b: Int, a: Float) = Color(r / 255f, g / 255f, b / 255f, a)
    private fun assertColor(name: String, expected: Color, actual: Color) {
        fun ch(c: Float) = (c * 255).roundToInt()
        val e = listOf(ch(expected.red), ch(expected.green), ch(expected.blue), (expected.alpha * 100).roundToInt())
        val a = listOf(ch(actual.red), ch(actual.green), ch(actual.blue), (actual.alpha * 100).roundToInt())
        assertEquals(name, e, a)
    }

    @Test fun darkMatchesSpec() {
        val t = DarkTokens
        assertColor("bg", hex(0x08090C), t.bg)
        assertColor("glass", rgba(22, 24, 30, 0.66f), t.glass)
        assertColor("ink", hex(0xF2F1ED), t.ink)
        assertColor("ink2", hex(0xA9A9A4), t.ink2)
        assertColor("muted", hex(0x8B8B86), t.muted)
        assertColor("line", rgba(255, 255, 255, 0.09f), t.line)
        assertColor("track", rgba(255, 255, 255, 0.08f), t.track)
        assertColor("accent", hex(0xE9B44C), t.accent)
        assertColor("accentText", hex(0xE9B44C), t.accentText)
        assertColor("sleep", hex(0x8F8CF2), t.sleep)
        assertColor("heart", hex(0xF0718F), t.heart)
        assertColor("good", hex(0x5FD08A), t.good)
        assertColor("deep", hex(0x5B57D6), t.deep)
        assertColor("rem", hex(0x4FC7B8), t.rem)
        assertColor("lightSleep", hex(0xA9A6F7), t.lightSleep)
        assertColor("warn", hex(0xF2B35B), t.warn)
        assertEquals(0.22f, t.glow, 0.001f)
    }

    @Test fun lightMatchesSpec() {
        val t = LightTokens
        assertColor("bg", hex(0xEEF0F3), t.bg)
        assertColor("glass", rgba(255, 255, 255, 0.74f), t.glass)
        assertColor("ink", hex(0x14161A), t.ink)
        assertColor("ink2", hex(0x565962), t.ink2)
        // Ruling 2: spec #6b6e77 is 4.46:1 on bg, so it is darkened minimally.
        assertColor("muted", hex(0x6A6D76), t.muted)
        assertColor("line", rgba(18, 24, 38, 0.10f), t.line)
        assertColor("track", rgba(18, 24, 38, 0.09f), t.track)
        assertColor("sleep", hex(0x5B57D6), t.sleep)
        assertColor("heart", hex(0xD6456B), t.heart)
        assertColor("good", hex(0x178F4D), t.good)
        assertColor("deep", hex(0x2F2C9A), t.deep)
        assertColor("rem", hex(0x1F9C8D), t.rem)
        assertColor("lightSleep", hex(0x9A97EE), t.lightSleep)
        assertColor("warn", hex(0xA86A00), t.warn)
        assertEquals(0.30f, t.glow, 0.001f)
    }

    @Test fun lightAccentIsTheOklabMix() {
        assertColor("accent", oklabMix(0xE9B44C, 0x4A3200, 0.7f), LightTokens.accent)
    }

    @Test fun mixOklabHelperMatchesLightAccent() {
        assertColor("mix", LightTokens.accent, sk.zdravie.app.ui.theme.mixOklab(hex(0xE9B44C), hex(0x4A3200), 0.7f))
    }

    @Test fun textContrastAtLeast45() {
        for ((name, t) in listOf("dark" to DarkTokens, "light" to LightTokens)) {
            val surfaces = listOf("bg" to t.bg, "glass" to panelColor(t))
            for ((sn, surface) in surfaces) {
                for ((tn, fg) in listOf("ink" to t.ink, "ink2" to t.ink2, "muted" to t.muted, "accentText" to t.accentText)) {
                    val c = contrast(fg, surface)
                    assertTrue("$name $tn on $sn = $c", c >= 4.5)
                }
            }
        }
    }

    private fun contrast(a: Color, b: Color): Double {
        val la = a.luminance().toDouble(); val lb = b.luminance().toDouble()
        return (maxOf(la, lb) + 0.05) / (minOf(la, lb) + 0.05)
    }

    private fun lin(c: Double) = if (c <= 0.04045) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
    private fun enc(c: Double) = (if (c <= 0.0031308) 12.92 * c else 1.055 * c.pow(1 / 2.4) - 0.055).coerceIn(0.0, 1.0)
    private fun oklab(hex: Long): DoubleArray {
        val r = lin(((hex shr 16) and 255) / 255.0); val g = lin(((hex shr 8) and 255) / 255.0); val b = lin((hex and 255) / 255.0)
        val l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        val m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        val s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        return doubleArrayOf(
            0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
        )
    }
    private fun oklabMix(a: Long, b: Long, wa: Float): Color {
        val x = oklab(a); val y = oklab(b)
        val (L, A, B) = Triple(wa * x[0] + (1 - wa) * y[0], wa * x[1] + (1 - wa) * y[1], wa * x[2] + (1 - wa) * y[2])
        val l = (L + 0.3963377774 * A + 0.2158037573 * B).pow(3)
        val m = (L - 0.1055613458 * A - 0.0638541728 * B).pow(3)
        val s = (L - 0.0894841775 * A - 1.2914855480 * B).pow(3)
        return Color(
            enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s).toFloat(),
            enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s).toFloat(),
            enc(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s).toFloat(),
        )
    }
}
