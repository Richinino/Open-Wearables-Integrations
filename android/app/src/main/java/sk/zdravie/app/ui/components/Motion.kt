package sk.zdravie.app.ui.components

import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.clickable
import androidx.compose.ui.composed
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role

/**
 * The motion rules of the web, for Compose. Three curves and short lengths: feedback 100-160 ms,
 * routine change 150-260 ms, movement in place 300-420 ms, one authored moment 600-900 ms.
 * Never ease-in on UI. A finger that drags or flings gets a spring instead (see InsightDeck).
 */
object ZMotion {
    val EaseOut = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)
    val EaseInOut = CubicBezierEasing(0.77f, 0f, 0.175f, 1f)
    val Focal = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)

    const val PRESS_MS = 120
    const val CHANGE_MS = 260
    const val MOVE_MS = 320
    const val MOMENT_MS = 900
}

/**
 * True when the system asks for less motion ("Remove animations" sets the animator scale to 0).
 * Then moments and count-ups are skipped; fades that explain a change stay.
 */
@Composable
fun rememberReducedMotion(): Boolean {
    val context = LocalContext.current
    return remember(context) {
        runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) }
            .getOrDefault(1f) == 0f
    }
}

/**
 * "Play once" marks that live only as long as the app process: health data stays off the disk, and
 * so do these. Used for the morning score moment and the first count of a figure.
 */
object SeenOnce {
    private val seen = HashSet<String>()

    /** True the first time [key] asks in this process. */
    @Synchronized
    fun first(key: String): Boolean = seen.add(key)
}

/**
 * Press feedback: the element gives way to 0.97 while the finger is down (feedback on press-in,
 * commit on release). Pair it with the element's own click via the shared [interaction].
 */
fun Modifier.pressScale(interaction: MutableInteractionSource): Modifier = this.composed {
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.97f else 1f,
        animationSpec = tween(ZMotion.PRESS_MS, easing = ZMotion.EaseOut),
        label = "press",
    )
    Modifier.graphicsLayer {
        scaleX = scale
        scaleY = scale
    }
}

/** A clickable that also scales on press. */
fun Modifier.pressClickable(
    enabled: Boolean = true,
    role: Role? = Role.Button,
    onClickLabel: String? = null,
    onClick: () -> Unit,
): Modifier = this.composed {
    val interaction = remember { MutableInteractionSource() }
    Modifier
        .pressScale(interaction)
        .clickable(
            interactionSource = interaction,
            indication = LocalIndication.current,
            enabled = enabled,
            role = role,
            onClickLabel = onClickLabel,
            onClick = onClick,
        )
}
