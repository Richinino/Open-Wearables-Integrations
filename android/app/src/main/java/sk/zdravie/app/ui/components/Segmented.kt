package sk.zdravie.app.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.ZType
import sk.zdravie.app.ui.theme.panelColor

private val PAD = 3.dp
private val GAP = 2.dp

/**
 * Joined segmented control (e.g. Ráno / Večer). Visual pill 40 dp, hit area 48 dp, ink fill with bg
 * text when selected; [filled] false = transparent container. The ink pill slides to the picked
 * option instead of the colour jumping, and one light tick confirms the step.
 */
@Composable
fun Segmented(
    options: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    filled: Boolean = true,
) {
    val t = LocalZTokens.current
    val haptics = LocalHapticFeedback.current
    val shape = RoundedCornerShape(24.dp)
    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (filled) panelColor(t) else Color.Transparent, shape)
            .border(BorderStroke(1.dp, t.line), shape),
    ) {
        val count = options.size.coerceAtLeast(1)
        val cell = (maxWidth - PAD * 2 - GAP * (count - 1)) / count
        val x by animateDpAsState(
            targetValue = PAD + (cell + GAP) * selected.coerceIn(0, count - 1),
            animationSpec = tween(ZMotion.CHANGE_MS, easing = ZMotion.EaseOut),
            label = "segmented-pill",
        )
        if (selected in options.indices) {
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .offset(x = x)
                    .width(cell)
                    .height(40.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(t.ink),
            )
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = PAD), horizontalArrangement = Arrangement.spacedBy(GAP)) {
            options.forEachIndexed { i, label ->
                val on = i == selected
                val ink by animateColorAsState(if (on) t.bg else t.ink2, tween(ZMotion.CHANGE_MS), label = "segmented-text")
                val interaction = remember { MutableInteractionSource() }
                Box(
                    Modifier
                        .weight(1f)
                        .height(48.dp)
                        .pressScale(interaction)
                        .clickable(interactionSource = interaction, indication = null, role = Role.Tab) {
                            if (!on) {
                                haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                                onSelect(i)
                            }
                        }
                        .semantics { this.selected = on },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(label, style = ZType.label, color = ink)
                }
            }
        }
    }
}
