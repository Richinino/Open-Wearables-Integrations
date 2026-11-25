package sk.zdravie.app.ui.screens.today

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import kotlin.math.sign
import kotlinx.coroutines.launch
import sk.zdravie.app.ui.components.MiniBars
import sk.zdravie.app.ui.components.ZMotion
import sk.zdravie.app.ui.components.pressClickable
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.panelColor

/** Past this distance or speed a released card leaves the deck (a short flick is enough). */
private val DISMISS_DISTANCE = 100.dp
private const val DISMISS_SPEED_DP_PER_S = 110f // 0.11 px/ms, as on the web, in dp per second

/**
 * The observations as a deck: one card at a time, the next ones peeking out below. The top card
 * follows the finger 1:1; let go past 100 dp or with a flick and it flies off and goes to the back,
 * otherwise a spring brings it home carrying the finger's speed. "Ďalší" does the same by tap.
 */
@Composable
internal fun InsightDeck(cards: List<InsightCard>) {
    val t = LocalZTokens.current
    val density = LocalDensity.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var order by remember(cards.map { it.key }) { mutableStateOf(cards.indices.toList()) }
    val offset = remember { Animatable(0f) }
    var width by remember { mutableStateOf(1f) }
    var busy by remember { mutableStateOf(false) }

    fun dismiss(direction: Float, velocity: Float = 0f) {
        if (busy || order.size < 2) return
        busy = true
        scope.launch {
            haptics.performHapticFeedback(HapticFeedbackType.GestureEnd)
            offset.animateTo(direction * width * 1.15f, tween(220, easing = ZMotion.EaseOut), initialVelocity = velocity)
            order = order.drop(1) + order.first()
            offset.snapTo(0f)
            busy = false
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.fillMaxWidth().padding(bottom = (12 * (order.size - 1).coerceAtMost(2)).dp)) {
            // Back to front, so the top card is drawn last.
            order.withIndex().reversed().forEach { (depth, index) ->
                val card = cards[index]
                val top = depth == 0
                if (depth > 2) return@forEach
                val cardModifier = if (top) {
                    Modifier
                        .onSizeChanged { width = it.width.toFloat().coerceAtLeast(1f) }
                        .graphicsLayer {
                            translationX = offset.value
                            rotationZ = offset.value / width * 8f
                        }
                        .pointerInput(order) {
                            if (order.size < 2) return@pointerInput
                            val tracker = VelocityTracker()
                            detectHorizontalDragGestures(
                                onDragStart = { tracker.resetTracking() },
                                onHorizontalDrag = { change, dx ->
                                    tracker.addPosition(change.uptimeMillis, change.position)
                                    change.consume()
                                    scope.launch { offset.snapTo(offset.value + dx) }
                                },
                                onDragEnd = {
                                    val velocity = tracker.calculateVelocity().x
                                    val distance = with(density) { DISMISS_DISTANCE.toPx() }
                                    val fast = abs(velocity) > with(density) { DISMISS_SPEED_DP_PER_S.dp.toPx() } * 10f
                                    if (abs(offset.value) > distance || (fast && abs(offset.value) > 12f)) {
                                        dismiss(sign(offset.value).takeIf { it != 0f } ?: -1f, velocity)
                                    } else {
                                        scope.launch {
                                            offset.animateTo(0f, spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessMediumLow), initialVelocity = velocity)
                                        }
                                    }
                                },
                                onDragCancel = { scope.launch { offset.animateTo(0f, spring(dampingRatio = 0.8f)) } },
                            )
                        }
                        .semantics {
                            if (order.size > 1) {
                                customActions = listOf(CustomAccessibilityAction("Ďalší postreh") { dismiss(-1f); true })
                            }
                        }
                        .testTag("insight-top")
                } else {
                    Modifier
                        .matchParentSize()
                        .graphicsLayer {
                            translationY = with(density) { (12 * depth).dp.toPx() }
                            val scale = 1f - depth * 0.045f
                            scaleX = scale
                            scaleY = scale
                            alpha = 1f - depth * 0.2f
                        }
                }
                InsightCardView(card, cardModifier)
            }
        }
        if (order.size > 1) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("${order.first() + 1} / ${cards.size}", style = mono(11.sp), color = t.muted)
                Box(
                    Modifier
                        .heightIn(min = 48.dp)
                        .clip(RoundedCornerShape(24.dp))
                        .pressClickable(onClickLabel = "Ďalší postreh") { dismiss(-1f) }
                        .padding(horizontal = 16.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("Ďalší postreh", style = urbanist(14.sp, FontWeight.SemiBold), color = t.ink)
                }
            }
        }
    }
}

@Composable
private fun InsightCardView(card: InsightCard, modifier: Modifier) {
    val t = LocalZTokens.current
    val shape = RoundedCornerShape(20.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(panelColor(t), shape)
            .border(BorderStroke(1.dp, t.line), shape)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (card.bars.isNotEmpty()) {
            MiniBars(card.bars, card.highlight, toneColor(t, card.tone), height = 40.dp, contentDescription = "Graf k postrehu")
        }
        if (card.subject != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Dot(toneColor(t, card.tone), 6.dp)
                sk.zdravie.app.ui.components.Eyebrow(card.subject)
            }
        }
        Text(card.text, style = urbanist(17.sp, FontWeight.Medium, -0.01f), color = t.ink)
        if (card.detail != null) Text(card.detail, style = urbanist(13.sp), color = t.muted)
    }
}
