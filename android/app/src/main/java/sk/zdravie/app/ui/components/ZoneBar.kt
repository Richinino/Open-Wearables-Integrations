package sk.zdravie.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import sk.zdravie.app.ui.theme.LocalZTokens

/** Light / moderate / vigorous minutes as proportional segments; missing counts as no minutes. */
@Composable
fun ZoneBar(
    light: Double?,
    moderate: Double?,
    vigorous: Double?,
    modifier: Modifier = Modifier,
    height: Dp = 10.dp,
    contentDescription: String? = null,
) {
    val t = LocalZTokens.current
    val sem = if (contentDescription != null) Modifier.semantics { this.contentDescription = contentDescription } else Modifier
    Canvas(modifier.fillMaxWidth().height(height).then(sem)) {
        val parts = listOf(light, moderate, vigorous).map { (it ?: 0.0).coerceAtLeast(0.0) }
        val total = parts.sum()
        val r = CornerRadius(size.height / 2f)
        drawRoundRect(t.track, Offset.Zero, size, r)
        if (total <= 0.0) return@Canvas
        val colors = listOf(t.good, t.accent, t.heart)
        val gap = 2.dp.toPx()
        val usable = size.width - gap * (parts.count { it > 0 } - 1)
        var x = 0f
        parts.forEachIndexed { i, p ->
            if (p <= 0.0) return@forEachIndexed
            val w = (p / total * usable).toFloat()
            drawRoundRect(colors[i], Offset(x, 0f), Size(w, size.height), r)
            x += w + gap
        }
    }
}
