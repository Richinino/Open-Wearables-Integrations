package sk.zdravie.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import sk.zdravie.app.ui.theme.LocalZTokens

/** 270 degree gauge opening downwards (starts at 225 deg on a clock face = Compose angle 135), flat caps, stroke 11/220 of [size]. */
@Composable
fun ScoreRing(
    fraction: Float,
    color: Color,
    size: Dp,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
    content: @Composable () -> Unit = {},
) {
    val track = LocalZTokens.current.track
    val f = if (fraction.isNaN()) 0f else fraction.coerceIn(0f, 1f)
    val sem = if (contentDescription != null) Modifier.semantics { this.contentDescription = contentDescription } else Modifier
    Box(modifier.size(size).then(sem), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(size)) {
            val stroke = this.size.minDimension * 11f / 220f
            val inset = stroke / 2f
            val arcSize = Size(this.size.width - stroke, this.size.height - stroke)
            val style = Stroke(width = stroke, cap = StrokeCap.Butt)
            drawArc(track, 135f, 270f, false, Offset(inset, inset), arcSize, style = style)
            if (f > 0f) drawArc(color, 135f, 270f * f, false, Offset(inset, inset), arcSize, style = style)
        }
        content()
    }
}
