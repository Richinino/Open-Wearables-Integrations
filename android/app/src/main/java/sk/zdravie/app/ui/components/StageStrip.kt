package sk.zdravie.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import sk.zdravie.app.logic.StageSegment
import sk.zdravie.app.model.SleepStage
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.ZTokens

internal fun stageColor(t: ZTokens, stage: SleepStage): Color = when (stage) {
    SleepStage.DEEP -> t.deep
    SleepStage.REM -> t.rem
    SleepStage.LIGHT -> t.lightSleep
    SleepStage.AWAKE -> t.warn
    SleepStage.ASLEEP -> t.sleep
}

/** Night stages as proportional segments of one rounded strip. */
@Composable
fun StageStrip(
    segments: List<StageSegment>,
    modifier: Modifier = Modifier,
    height: Dp = 22.dp,
    contentDescription: String? = null,
) {
    val t = LocalZTokens.current
    val sem = if (contentDescription != null) Modifier.semantics { this.contentDescription = contentDescription } else Modifier
    Canvas(modifier.fillMaxWidth().height(height).then(sem)) {
        val outline = Path().apply {
            addRoundRect(RoundRect(0f, 0f, size.width, size.height, CornerRadius(6.dp.toPx())))
        }
        val total = segments.sumOf { it.minutes.coerceAtLeast(0.0) }
        if (total <= 0.0) {
            drawPath(outline, t.track)
            return@Canvas
        }
        clipPath(outline) {
            var x = 0f
            segments.forEach { s ->
                val w = (s.minutes.coerceAtLeast(0.0) / total * size.width).toFloat()
                if (w > 0f) drawRect(stageColor(t, s.stage), topLeft = androidx.compose.ui.geometry.Offset(x, 0f), size = androidx.compose.ui.geometry.Size(w, size.height))
                x += w
            }
        }
    }
}
