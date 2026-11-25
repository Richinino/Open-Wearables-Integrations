package sk.zdravie.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import sk.zdravie.app.logic.Format
import sk.zdravie.app.ui.theme.LocalZTokens

/** One track of the ring: share of the full circle (0..1) and its colour. */
class RingTrack(val fraction: Float, val color: Color)

private val RADII = floatArrayOf(132f, 108f, 84f)
private const val STROKE = 16f
private const val BOX = 300f

/**
 * The day score as three tracks around one number: Pripravenosť outside, the night score in the
 * middle, Aktivita inside. With [play] the tracks draw in one after another (110 ms apart), the
 * number counts up and a glow blooms behind it once; without it everything simply stands there.
 */
@Composable
fun TripleRing(
    tracks: List<RingTrack>,
    size: Dp,
    play: Boolean,
    contentDescription: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val t = LocalZTokens.current
    val progress = remember(tracks.size) { List(tracks.size) { Animatable(if (play) 0f else 1f) } }
    val glow = remember { Animatable(0f) }
    LaunchedEffect(play) {
        if (!play) return@LaunchedEffect
        progress.forEachIndexed { index, anim ->
            launch {
                delay(index * 110L)
                anim.animateTo(1f, tween(ZMotion.MOMENT_MS, easing = ZMotion.Focal))
            }
        }
        launch {
            delay(300)
            glow.animateTo(
                0.35f,
                keyframes {
                    durationMillis = 1400
                    0f at 0 using LinearEasing
                    0.9f at 630 using ZMotion.EaseOut
                    0.35f at 1400
                },
            )
        }
    }
    Box(modifier.size(size).semantics { this.contentDescription = contentDescription }, contentAlignment = Alignment.Center) {
        if (play) {
            Canvas(Modifier.size(size).alpha(glow.value)) {
                drawCircle(
                    Brush.radialGradient(listOf(t.accent.copy(alpha = 0.3f), Color.Transparent), center, this.size.minDimension * 0.62f),
                    radius = this.size.minDimension * 0.62f,
                )
            }
        }
        Canvas(Modifier.size(size)) {
            val unit = this.size.minDimension / BOX
            val stroke = Stroke(width = STROKE * unit, cap = StrokeCap.Round)
            tracks.forEachIndexed { index, track ->
                val r = RADII.getOrElse(index) { RADII.last() - (index - 2) * 24f } * unit
                val topLeft = Offset(center.x - r, center.y - r)
                val arc = Size(r * 2, r * 2)
                drawArc(t.track, 0f, 360f, false, topLeft, arc, style = stroke)
                val sweep = 360f * track.fraction.coerceIn(0f, 1f) * progress.getOrNull(index)?.value.orZero()
                if (sweep > 0.5f) drawArc(track.color, -90f, sweep, false, topLeft, arc, style = stroke)
            }
        }
        content()
    }
}

private fun Float?.orZero(): Float = this ?: 0f

/**
 * A figure that counts up from zero when [play] is set (600-700 ms, strong ease-out), otherwise
 * the finished [text]. Screen readers always get the final text.
 */
@Composable
fun CountUpText(
    value: Double?,
    text: String,
    play: Boolean,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
    delayMs: Int = 0,
) {
    val anim = remember { Animatable(if (play && value != null) 0f else 1f) }
    LaunchedEffect(play, value) {
        if (play && value != null) {
            delay(delayMs.toLong())
            anim.animateTo(1f, tween(700, easing = ZMotion.EaseOut))
        } else {
            anim.snapTo(1f)
        }
    }
    val shown = if (value == null || anim.value >= 1f) text else Format.formatInt(value * anim.value)
    Text(shown, style = style, color = color, modifier = modifier.semantics { this.contentDescription = text })
}
