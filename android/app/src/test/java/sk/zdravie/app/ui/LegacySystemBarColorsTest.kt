package sk.zdravie.app.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import org.junit.Assert.*
import org.junit.Test

class LegacySystemBarColorsTest {
    @Test fun legacyNavigationBarColorsAreOpaqueAndContrastWithTheResolvedThemeIcons() {
        val dark = legacyNavigationBarColor(dark = true)
        val light = legacyNavigationBarColor(dark = false)
        assertNotEquals(dark, light)
        assertEquals(255, dark ushr 24)
        assertEquals(255, light ushr 24)
        // Dark app bars use white icons, light app bars use black icons.
        assertTrue("White icons must remain legible on a dark legacy navigation bar", 1.05f / (Color(dark).luminance() + 0.05f) >= 7f)
        assertTrue("Black icons must remain legible on a light legacy navigation bar", (Color(light).luminance() + 0.05f) / 0.05f >= 7f)
    }
}
