package sk.zdravie.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
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

/**
 * Line over the index axis; a missing value breaks the line instead of drawing a zero. The first
 * time it appears it draws itself left to right (700 ms); scrolling back or a refresh does not
 * replay it.
 */
@Composable
fun Sparkline(
    values: List<Double?>,
    color: Color,
    modifier: Modifier = Modifier,
    height: Dp = 40.dp,
    contentDescription: String,
) {
    val sem = Modifier.semantics { this.contentDescription = contentDescription }
    val reduced = rememberReducedMotion()
    var played by rememberSaveable { mutableStateOf(false) }
    val reveal = remember { Animatable(if (played || reduced) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (reveal.value < 1f) reveal.animateTo(1f, tween(700, easing = ZMotion.Focal))
        played = true
    }
    Canvas(modifier.fillMaxWidth().height(height).then(sem)) {
        clipRect(right = size.width * reveal.value + 4.dp.toPx()) { drawLine(values, color) }
    }
}

private fun DrawScope.drawLine(values: List<Double?>, color: Color) {
    run {
        val known = values.filterNotNull()
        if (known.isEmpty()) return@run
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
