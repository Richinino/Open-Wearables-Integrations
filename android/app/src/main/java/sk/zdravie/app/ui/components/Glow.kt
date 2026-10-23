package sk.zdravie.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import sk.zdravie.app.ui.theme.LocalZTokens

/** Two large soft radial glows (accent top-left, sleep right) at `glow` opacity; draw first, behind content. */
@Composable
fun BackgroundGlow(modifier: Modifier = Modifier) {
    val t = LocalZTokens.current
    Canvas(modifier.fillMaxSize()) {
        val a = (0.6f * t.glow).coerceIn(0f, 1f)
        val r1 = size.width * 0.95f
        val c1 = Offset(size.width * 0.12f, size.height * 0.04f)
        drawCircle(Brush.radialGradient(listOf(t.accent.copy(alpha = a), Color.Transparent), center = c1, radius = r1), r1, c1)
        val r2 = size.width * 0.9f
        val c2 = Offset(size.width, size.height * 0.30f)
        drawCircle(Brush.radialGradient(listOf(t.sleep.copy(alpha = a), Color.Transparent), center = c2, radius = r2), r2, c2)
    }
}
