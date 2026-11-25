package sk.zdravie.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sk.zdravie.app.logic.HourTick
import sk.zdravie.app.logic.SleepSession
import sk.zdravie.app.model.SleepStage
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.ZType

private val LANES = listOf(SleepStage.AWAKE, SleepStage.REM, SleepStage.LIGHT, SleepStage.DEEP)
private val LANE_LABELS = mapOf(
    SleepStage.AWAKE to "Bdenie",
    SleepStage.REM to "REM",
    SleepStage.LIGHT to "Ľahký",
    SleepStage.DEEP to "Hlboký",
)

/**
 * The night in four lanes (bdenie, REM, ľahký, hlboký) over a clock axis, like the web's
 * hypnogram. "Asleep" without a stage sits in the light lane. The blocks are revealed left to
 * right once when the night is first shown.
 */
@Composable
fun Hypnogram(session: SleepSession, ticks: List<HourTick>, description: String, modifier: Modifier = Modifier) {
    val t = LocalZTokens.current
    val reduced = rememberReducedMotion()
    var played by rememberSaveable(session.start) { mutableStateOf(false) }
    val reveal = remember(session.start) { Animatable(if (played || reduced) 1f else 0f) }
    LaunchedEffect(session.start) {
        if (reveal.value < 1f) reveal.animateTo(1f, tween(700, easing = ZMotion.Focal))
        played = true
    }
    val span = (session.end - session.start).coerceAtLeast(1L).toFloat()
    Column(modifier.fillMaxWidth().semantics { contentDescription = description }.testTag("hypnogram"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Column(Modifier.width(56.dp), verticalArrangement = Arrangement.spacedBy(0.dp)) {
                LANES.forEach { lane ->
                    Box(Modifier.height(30.dp)) {
                        Text(LANE_LABELS.getValue(lane), style = ZType.caption.copy(fontSize = 11.sp), color = t.ink2, modifier = Modifier.padding(top = 7.dp))
                    }
                }
            }
            Canvas(Modifier.weight(1f).height(120.dp).testTag("hypnogram-lanes")) {
                val lane = size.height / LANES.size
                LANES.forEachIndexed { index, _ ->
                    val y = lane * index + lane / 2f
                    drawLine(t.track, Offset(0f, y), Offset(size.width, y), 1.dp.toPx())
                }
                clipRect(right = size.width * reveal.value) {
                    session.blocks.forEach { block ->
                        val stage = if (block.stage == SleepStage.ASLEEP) SleepStage.LIGHT else block.stage
                        val index = LANES.indexOf(stage).coerceAtLeast(0)
                        val x0 = (block.start - session.start) / span * size.width
                        val x1 = (block.end - session.start) / span * size.width
                        val h = lane * 0.62f
                        drawRoundRect(
                            stageColor(t, block.stage),
                            topLeft = Offset(x0, lane * index + (lane - h) / 2f),
                            size = Size((x1 - x0).coerceAtLeast(1.5.dp.toPx()), h),
                            cornerRadius = CornerRadius(3.dp.toPx()),
                        )
                    }
                }
            }
        }
        // Clock labels under the lanes, placed at their time.
        Row(Modifier.fillMaxWidth()) {
            Box(Modifier.width(56.dp))
            TickRow(ticks, session, Modifier.weight(1f))
        }
    }
}

@Composable
private fun TickRow(ticks: List<HourTick>, session: SleepSession, modifier: Modifier) {
    val t = LocalZTokens.current
    val span = (session.end - session.start).coerceAtLeast(1L).toFloat()
    Layout(
        modifier = modifier,
        content = {
            ticks.forEach { tick ->
                Text(tick.label, style = ZType.caption.copy(fontSize = 10.sp, fontWeight = FontWeight.Normal), color = t.muted)
            }
        },
    ) { measurables, constraints ->
        val placeables = measurables.map { it.measure(Constraints()) }
        val height = placeables.maxOfOrNull { it.height } ?: 0
        layout(constraints.maxWidth, height) {
            var lastRight = -1
            placeables.forEachIndexed { index, placeable ->
                val center = ((ticks[index].at - session.start) / span * constraints.maxWidth).toInt()
                val x = (center - placeable.width / 2).coerceIn(0, constraints.maxWidth - placeable.width)
                // Skip a label that would collide with the one before it.
                if (x > lastRight + 4) {
                    placeable.place(x, 0)
                    lastRight = x + placeable.width
                }
            }
        }
    }
}
