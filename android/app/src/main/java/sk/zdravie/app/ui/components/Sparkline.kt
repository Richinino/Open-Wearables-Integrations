package sk.zdravie.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Line over the index axis; a missing value breaks the line instead of drawing a zero. */
@Composable
fun Sparkline(
    values: List<Double?>,
    color: Color,
    modifier: Modifier = Modifier,
    height: Dp = 40.dp,
    contentDescription: String? = null,
) {
    val sem = if (contentDescription != null) Modifier.semantics { this.contentDescription = contentDescription } else Modifier
    Canvas(modifier.fillMaxWidth().height(height).then(sem)) {
        val known = values.filterNotNull()
        if (known.isEmpty()) return@Canvas
        val lo = known.min()
        val hi = known.max()
        val span = (hi - lo).takeIf { it > 0 } ?: 1.0
        val pad = 2.dp.toPx()
        val step = if (values.size > 1) size.width / (values.size - 1) else 0f
        val stroke = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        // Split into runs of consecutive known values.
        val runs = mutableListOf<MutableList<Offset>>()
        var current: MutableList<Offset>? = null
        values.forEachIndexed { i, v ->
            if (v == null) {
                current = null
            } else {
                val p = Offset(i * step, pad + ((hi - v) / span).toFloat() * (size.height - 2 * pad))
                val run = current ?: mutableListOf<Offset>().also { runs += it; current = it }
                run += p
            }
        }
        runs.forEach { run ->
            if (run.size == 1) {
                drawCircle(color, 1.5.dp.toPx(), run[0])
            } else {
                val path = Path().apply {
                    moveTo(run[0].x, run[0].y)
                    run.drop(1).forEach { lineTo(it.x, it.y) }
                }
                drawPath(path, color, style = stroke)
            }
        }
    }
}
