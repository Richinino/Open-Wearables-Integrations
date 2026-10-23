package sk.zdravie.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import sk.zdravie.app.ui.theme.mixOklab
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import sk.zdravie.app.ui.theme.LocalZTokens

/** Light / moderate / vigorous minutes (accent 38 % / 68 % / 100 %); [height] 8 dp on day tiles, 6 dp for workout rows. */
@Composable
fun ZoneBar(
    light: Double?,
    moderate: Double?,
    vigorous: Double?,
    modifier: Modifier = Modifier,
    height: Dp = 8.dp,
    contentDescription: String,
) {
    val t = LocalZTokens.current
    val sem = Modifier.semantics { this.contentDescription = contentDescription }
    Canvas(modifier.fillMaxWidth().height(height).then(sem)) {
        val parts = listOf(light, moderate, vigorous).map { (it ?: 0.0).coerceAtLeast(0.0) }
        val total = parts.sum()
        val outline = Path().apply { addRoundRect(RoundRect(0f, 0f, size.width, size.height, CornerRadius(if (height <= 6.dp) 3.dp.toPx() else 4.dp.toPx()))) }
        drawPath(outline, t.track)
        if (total <= 0.0) return@Canvas
        val colors = listOf(mixOklab(t.accent, t.bg, 0.38f), mixOklab(t.accent, t.bg, 0.68f), t.accent)
        val gap = 2.dp.toPx()
        val usable = size.width - gap * (parts.count { it > 0 } - 1)
        clipPath(outline) {
            var x = 0f
            parts.forEachIndexed { i, p ->
                if (p <= 0.0) return@forEachIndexed
                val w = (p / total * usable).toFloat()
                drawRect(colors[i], Offset(x, 0f), Size(w, size.height))
                x += w + gap
            }
        }
    }
}
