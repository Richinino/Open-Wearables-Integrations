package sk.zdravie.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import sk.zdravie.app.ui.theme.LocalZTokens

/** Mini tile bars: highlighted indices in [color], the rest in `track`. A missing value is left empty, never a zero bar. */
@Composable
fun MiniBars(
    values: List<Double?>,
    highlight: Set<Int>,
    color: Color,
    modifier: Modifier = Modifier,
    height: Dp = 56.dp,
    contentDescription: String,
) {
    val track = LocalZTokens.current.track
    val sem = Modifier.semantics { this.contentDescription = contentDescription }
    Canvas(modifier.fillMaxWidth().height(height).then(sem)) {
        if (values.isEmpty()) return@Canvas
        val gap = 4.dp.toPx()
        val w = (size.width - gap * (values.size - 1)) / values.size
        val max = values.filterNotNull().filter { it > 0 }.maxOrNull() ?: 0.0
        val top = 3.dp.toPx()
        val bottom = 1.dp.toPx()
        values.forEachIndexed { i, v ->
            if (v == null || max <= 0.0) return@forEachIndexed
            val h = maxOf(size.height * 0.08f, (size.height * (v / max)).toFloat())
            val c = if (i in highlight) color else track
            val r = RoundRect(i * (w + gap), size.height - h, i * (w + gap) + w, size.height, CornerRadius(top), CornerRadius(top), CornerRadius(bottom), CornerRadius(bottom))
            drawPath(Path().apply { addRoundRect(r) }, c)
        }
    }
}
