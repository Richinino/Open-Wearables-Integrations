package sk.zdravie.app.ui.screens.today

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sk.zdravie.app.logic.Dates
import sk.zdravie.app.logic.Format
import sk.zdravie.app.model.Dataset
import sk.zdravie.app.model.Day
import sk.zdravie.app.ui.components.Eyebrow
import sk.zdravie.app.ui.components.Segmented
import sk.zdravie.app.ui.components.ZMotion
import sk.zdravie.app.ui.theme.LocalZTokens

private enum class Measure(val label: String) { STEPS("Kroky"), SLEEP("Spánok"), ACTIVE("Aktívny čas") }

private val WEEKDAYS = listOf("po", "ut", "st", "št", "pi", "so", "ne")
private val WEEKDAY_NAMES = listOf("pondelok", "utorok", "streda", "štvrtok", "piatok", "sobota", "nedeľa")

private class WeekBar(val day: String, val now: Double?, val then: Double?, val running: Boolean)

private fun read(day: Day?, measure: Measure): Double? = when (measure) {
    Measure.STEPS -> day?.steps
    Measure.SLEEP -> day?.sleepMinutes
    Measure.ACTIVE -> day?.activeMinutesEst
}?.takeIf { it.isFinite() }

private fun show(value: Double, measure: Measure): String = when (measure) {
    Measure.STEPS -> "${Format.formatInt(value)} krokov"
    Measure.SLEEP, Measure.ACTIVE -> Format.formatDuration(value)
}

/**
 * This week next to the last one, day by day, as on the web: solid bars are this week, dashed
 * outlines the same weekday a week earlier, a day still running is lighter. Switching the measure
 * rescales the same bars (320 ms, ease-in-out) instead of drawing new ones.
 */
@Composable
internal fun WeekComparePanel(dataset: Dataset, date: String) {
    val t = LocalZTokens.current
    var picked by rememberSaveable { mutableIntStateOf(0) }
    val measure = Measure.entries[picked]
    val byDay = remember(dataset) { dataset.days.associateBy { it.day } }
    val monday = Dates.addDays(date, -Dates.weekdayIndex(date))
    val bars = (0 until 7).map { index ->
        val current = Dates.addDays(monday, index)
        val day = if (current <= date) byDay[current] else null
        WeekBar(current, read(day, measure), read(byDay[Dates.addDays(current, -7)], measure), day?.complete == false)
    }
    val top = (bars.flatMap { listOfNotNull(it.now, it.then) }.maxOrNull() ?: 0.0).coerceAtLeast(1.0)
    val pairs = bars.filter { it.now != null && it.then != null && !it.running }
    val note = if (pairs.isEmpty()) {
        "Tento týždeň ešte nie je s čím porovnať."
    } else {
        val lead = if (pairs.size == 1) {
            WEEKDAY_NAMES[Dates.weekdayIndex(pairs[0].day)].replaceFirstChar { it.uppercase() }
        } else {
            "Za ${pairs.size} ${if (pairs.size < 5) "ukončené dni" else "ukončených dní"}"
        }
        "$lead: ${show(pairs.sumOf { it.now ?: 0.0 }, measure)}, minulý týždeň ${show(pairs.sumOf { it.then ?: 0.0 }, measure)}."
    }
    val color = if (measure == Measure.SLEEP) t.sleep else t.accent
    val label = bars.mapIndexed { index, bar ->
        "${WEEKDAY_NAMES[index]}: ${bar.now?.let { show(it, measure) } ?: "bez dát"}, týždeň predtým ${bar.then?.let { show(it, measure) } ?: "bez dát"}"
    }.joinToString("; ")

    ZPanel {
        Eyebrow("Tento týždeň oproti minulému")
        Segmented(Measure.entries.map { it.label }, picked, { picked = it })
        Row(
            Modifier.fillMaxWidth().height(140.dp).semantics { contentDescription = label },
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            bars.forEach { bar -> WeekColumn(bar, top, color, Modifier.weight(1f)) }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            WEEKDAYS.forEach { Text(it, style = mono(11.sp), color = t.muted, textAlign = TextAlign.Center, modifier = Modifier.weight(1f)) }
        }
        Text(note, style = urbanist(14.sp), color = t.ink2)
    }
}

@Composable
private fun WeekColumn(bar: WeekBar, top: Double, color: Color, modifier: Modifier) {
    val t = LocalZTokens.current
    val nowShare by animateFloatAsState(
        targetValue = bar.now?.let { (it / top).toFloat().coerceIn(0.02f, 1f) } ?: 0f,
        animationSpec = tween(ZMotion.MOVE_MS, easing = ZMotion.EaseInOut),
        label = "week-now",
    )
    val thenShare by animateFloatAsState(
        targetValue = bar.then?.let { (it / top).toFloat().coerceIn(0.02f, 1f) } ?: 0f,
        animationSpec = tween(ZMotion.MOVE_MS, easing = ZMotion.EaseInOut),
        label = "week-then",
    )
    val fill by animateColorAsState(if (bar.running) color.copy(alpha = 0.45f) else color, tween(200), label = "week-fill")
    Box(modifier.fillMaxHeight()) {
        Canvas(Modifier.fillMaxWidth().fillMaxHeight()) {
            val radius = CornerRadius(5.dp.toPx())
            if (thenShare > 0f) {
                val w = size.width * 0.72f
                val h = size.height * thenShare
                drawRoundRect(
                    t.ink2.copy(alpha = 0.4f),
                    topLeft = Offset((size.width - w) / 2f, size.height - h),
                    size = Size(w, h),
                    cornerRadius = radius,
                    style = Stroke(1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))),
                )
            }
            if (nowShare > 0f) {
                val w = size.width * 0.46f
                val h = size.height * nowShare
                drawRoundRect(fill, topLeft = Offset((size.width - w) / 2f, size.height - h), size = Size(w, h), cornerRadius = radius)
            }
        }
    }
}
