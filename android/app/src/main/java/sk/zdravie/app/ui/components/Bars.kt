package sk.zdravie.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import sk.zdravie.app.ui.theme.LocalZTokens

/** Mini tile bars: highlighted indices in [color], the rest in `track`. A missing value is a flat stub, never a zero bar. */
@Composable
fun MiniBars(
    values: List<Double?>,
    highlight: Set<Int>,
    color: Color,
    modifier: Modifier = Modifier,
    height: Dp = 56.dp,
    contentDescription: String? = null,
) {
    val track = LocalZTokens.current.track
    val sem = if (contentDescription != null) Modifier.semantics { this.contentDescription = contentDescription } else Modifier
    Canvas(modifier.fillMaxWidth().height(height).then(sem)) {
        if (values.isEmpty()) return@Canvas
        val gap = 4.dp.toPx()
        val w = (size.width - gap * (values.size - 1)) / values.size
        val max = values.filterNotNull().filter { it > 0 }.maxOrNull() ?: 0.0
        val stub = 2.dp.toPx()
        val radius = CornerRadius(3.dp.toPx())
        values.forEachIndexed { i, v ->
            val h = if (v == null || max <= 0.0) stub else maxOf(stub, (size.height * (v / max)).toFloat())
            val c = if (v != null && i in highlight) color else track
            drawRoundRect(c, Offset(i * (w + gap), size.height - h), Size(w, h), radius)
        }
    }
}
