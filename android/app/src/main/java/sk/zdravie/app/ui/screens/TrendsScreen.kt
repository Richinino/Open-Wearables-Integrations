package sk.zdravie.app.ui.screens

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sk.zdravie.app.logic.Format
import sk.zdravie.app.logic.HeatMetric
import sk.zdravie.app.logic.LongTerm
import sk.zdravie.app.logic.Overview
import sk.zdravie.app.logic.RecordItem
import sk.zdravie.app.logic.TrendMetric
import sk.zdravie.app.logic.Trends
import sk.zdravie.app.model.Dataset
import sk.zdravie.app.ui.ScreenHeader
import sk.zdravie.app.ui.components.Eyebrow
import sk.zdravie.app.ui.components.Segmented
import sk.zdravie.app.ui.components.ZMotion
import sk.zdravie.app.ui.components.pressClickable
import sk.zdravie.app.ui.components.rememberReducedMotion
import sk.zdravie.app.ui.screens.today.ZPanel
import sk.zdravie.app.ui.screens.today.mono
import sk.zdravie.app.ui.screens.today.urbanist
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.ZType
import sk.zdravie.app.ui.theme.mixOklab
import sk.zdravie.app.ui.theme.panelColor

private val RANGES = listOf(7, 30, 90, 365)
private val RANGE_LABELS = listOf("7 dní", "30 dní", "90 dní", "Rok")

/**
 * One metric over 7 days to a year with its average and the change against the period before,
 * the week in cards, a 12-week calendar, records of 90 days and the long-term numbers. A day in
 * the cards or the calendar opens Dnes for that date.
 */
@Composable
fun TrendsScreen(dataset: Dataset, today: String, initial: String, onOpenDay: (String) -> Unit, onAccount: () -> Unit) {
    val t = LocalZTokens.current
    var metricIndex by rememberSaveable { mutableIntStateOf(0) }
    var rangeIndex by rememberSaveable { mutableIntStateOf(1) }
    var heatIndex by rememberSaveable { mutableIntStateOf(0) }
    val metric = TrendMetric.entries[metricIndex]
    val range = RANGES[rangeIndex]
    val end = dataset.lastDay?.takeIf { it <= today } ?: today
    val series = remember(dataset, end, metric, range) { Trends.trendValues(dataset.days, end, metric, range) }
    val cards = remember(dataset, end) { Overview.weekCards(dataset.days, end) }
    val heatInfo = Overview.HEAT_METRICS[heatIndex]
    val heat = remember(dataset, end, heatInfo) { Overview.heatmap(dataset.days, end, heatInfo.id) }
    val records = remember(dataset, end) { Overview.records(dataset.days, end) }
    val vo2 = remember(dataset, end) { LongTerm.latestValue(dataset.days, end) { it.scores?.vo2max } }
    val bodyAge = remember(dataset, end) { LongTerm.bodyAge(dataset.days.lastOrNull { it.day <= end && it.scores?.whoopAge?.value != null }?.scores?.whoopAge) }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        LazyColumn(
            modifier = Modifier.widthIn(max = 640.dp).fillMaxSize().testTag("trends-list"),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item(key = "header") { ScreenHeader(null, "Trendy", initial, onAccount) }
            item(key = "chips") { MetricChips(metricIndex) { metricIndex = it } }
            item(key = "range") { Segmented(RANGE_LABELS, rangeIndex, { rangeIndex = it }) }
            item(key = "chart") {
                ZPanel {
                    Eyebrow("${metric.label} · ${RANGE_LABELS[rangeIndex].lowercase()}")
                    Text(Trends.format(metric, series.average), style = ZType.figureLarge, color = t.ink, modifier = Modifier.testTag("trend-average"))
                    Text(changeText(metric, series.average, series.previousAverage, range), style = urbanist(14.sp), color = t.ink2)
                    TrendChart(series.values, series.average, "${metric.label}: priemer ${Trends.format(metric, series.average)}", metricIndex * 10 + rangeIndex)
                    Text(
                        "dáta z ${series.covered} z ${series.total} ${if (range >= 365) "týždňov" else "dní"} · najlepšie ${Trends.format(metric, series.best)} · najslabšie ${Trends.format(metric, series.worst)}",
                        style = urbanist(12.sp),
                        color = t.muted,
                    )
                }
            }
            item(key = "week") {
                ZPanel {
                    Eyebrow("Týždeň v skratke")
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        cards.forEach { card ->
                            Column(
                                Modifier
                                    .width(132.dp)
                                    .clip(RoundedCornerShape(20.dp))
                                    .border(BorderStroke(1.dp, if (card.day == end) t.accent else t.line), RoundedCornerShape(20.dp))
                                    .pressClickable(onClickLabel = "Otvoriť deň") { onOpenDay(card.day) }
                                    .padding(14.dp)
                                    .testTag("week-${card.day}"),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Text(Format.formatDay(card.day), style = urbanist(13.sp), color = t.ink2)
                                Text(Format.formatInt(card.steps), style = urbanist(24.sp, spacing = -0.02f, line = 1.1f), color = t.ink)
                                Text("spánok ${Format.formatDurationCompact(card.sleepMinutes)}", style = urbanist(12.sp), color = t.ink2)
                                Text("skóre ${Format.formatInt(card.dayScore)}", style = urbanist(12.sp), color = t.ink2)
                            }
                        }
                    }
                }
            }
            item(key = "heatmap") {
                ZPanel {
                    Eyebrow("12 týždňov po dňoch")
                    Segmented(Overview.HEAT_METRICS.map { it.label }, heatIndex, { heatIndex = it })
                    HeatGrid(heat, onOpenDay)
                    Text(Overview.heatmapNote(heat), style = urbanist(13.sp), color = t.ink2)
                }
            }
            item(key = "records") {
                ZPanel {
                    Eyebrow("Rekordy · 90 dní")
                    if (records.isEmpty()) Text("Zatiaľ bez rekordov.", style = urbanist(14.sp), color = t.ink2)
                    records.forEach { record ->
                        val (value, note) = recordText(record)
                        Column(Modifier.testTag("record-${record.key}"), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(value, style = urbanist(22.sp, FontWeight.Normal, -0.02f, 1.1f), color = t.ink)
                            Text(note, style = urbanist(12.sp), color = t.ink2)
                        }
                    }
                }
            }
            item(key = "longterm") {
                ZPanel {
                    Eyebrow("Dlhodobé")
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text("VO2max", style = urbanist(12.sp), color = t.ink2)
                            Text(Format.formatDecimal(vo2?.value), style = urbanist(28.sp, spacing = -0.02f, line = 1.1f), color = t.ink)
                            Text(LongTerm.vo2maxLevel(vo2?.value) ?: "ml/kg/min", style = urbanist(12.sp), color = t.muted)
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text("Vek tela", style = urbanist(12.sp), color = t.ink2)
                            Text(bodyAge?.value?.let { Format.formatDecimal(it) } ?: Format.formatInt(null), style = urbanist(28.sp, spacing = -0.02f, line = 1.1f), color = t.ink)
                            Text(
                                bodyAge?.difference?.let { if (it < 0) "o ${Format.formatDecimal(-it)} r. mladší" else "o ${Format.formatDecimal(it)} r. starší" } ?: "podľa WHOOP",
                                style = urbanist(12.sp),
                                color = t.muted,
                            )
                        }
                    }
                }
            }
            item(key = "end") { Spacer(Modifier.height(1.dp).testTag("screen-end")) }
        }
    }
}

private fun changeText(metric: TrendMetric, now: Double?, before: Double?, range: Int): String {
    if (now == null || before == null || before == 0.0) return "Na porovnanie s predošlým obdobím zatiaľ chýbajú dáta."
    val diff = now - before
    val period = if (range >= 365) "predošlému roku" else "predošlým $range dňom"
    if (metric == TrendMetric.STEPS || metric == TrendMetric.KCAL) {
        val percent = Math.round(diff / before * 100).toInt()
        if (percent == 0) return "Rovnako ako v $period."
        return "${if (percent > 0) "↑" else "↓"} ${kotlin.math.abs(percent)} % oproti $period"
    }
    val shown = Trends.format(metric, kotlin.math.abs(diff))
    if (shown == Trends.format(metric, 0.0)) return "Rovnako ako v $period."
    return "${if (diff > 0) "↑" else "↓"} $shown oproti $period"
}

private fun recordText(item: RecordItem): Pair<String, String> {
    val day = Format.formatDay(item.day)
    return when (item.key) {
        "steps" -> "${Format.formatInt(item.value)} krokov" to "najviac za deň · $day"
        "sleep" -> Format.formatDuration(item.value) to "najdlhší spánok · $day"
        "resting" -> "${Format.formatInt(item.value)} bpm" to "najnižší pokojový tep · $day"
        "workout" -> Format.formatDuration(item.value / 60) to "najdlhší tréning · ${Format.workoutLabel(item.type ?: "").lowercase()}, $day"
        else -> "${Format.formatInt(item.value)} ${Format.plural(Math.round(item.value).toInt(), "bod", "body", "bodov")}" to "najlepšie skóre dňa · $day"
    }
}

@Composable
private fun MetricChips(selected: Int, onSelect: (Int) -> Unit) {
    val t = LocalZTokens.current
    val haptics = LocalHapticFeedback.current
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TrendMetric.entries.forEachIndexed { index, metric ->
            val on = index == selected
            val fill by animateColorAsState(if (on) t.ink else panelColor(t), tween(ZMotion.CHANGE_MS), label = "chip")
            val ink by animateColorAsState(if (on) t.bg else t.ink2, tween(ZMotion.CHANGE_MS), label = "chip-text")
            Box(
                Modifier
                    .heightIn(min = 48.dp)
                    .padding(vertical = 4.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(fill)
                    .border(BorderStroke(1.dp, if (on) t.ink else t.line), RoundedCornerShape(20.dp))
                    .pressClickable(role = Role.Tab) {
                        if (!on) {
                            haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                            onSelect(index)
                        }
                    }
                    .semantics { this.selected = on }
                    .padding(horizontal = 16.dp, vertical = 10.dp)
                    .testTag("chip-${metric.name.lowercase()}"),
                contentAlignment = Alignment.Center,
            ) {
                Text(metric.label, style = urbanist(14.sp, FontWeight.SemiBold), color = ink)
            }
        }
    }
}

/** Daily or weekly values as a line with gaps, and the average as a dashed line. Draws in once per metric and range. */
@Composable
private fun TrendChart(values: List<Double?>, average: Double?, description: String, key: Int) {
    val t = LocalZTokens.current
    val reduced = rememberReducedMotion()
    val reveal = remember(key) { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(key) { reveal.animateTo(1f, tween(600, easing = ZMotion.Focal)) }
    Canvas(Modifier.fillMaxWidth().height(140.dp).semantics { contentDescription = description }.testTag("trend-chart")) {
        val known = values.filterNotNull()
        if (known.isEmpty()) return@Canvas
        val lo = known.min()
        val hi = known.max()
        val span = (hi - lo).takeIf { it > 0 } ?: 1.0
        val pad = 6.dp.toPx()
        val step = if (values.size > 1) size.width / (values.size - 1) else 0f
        fun y(v: Double) = pad + ((hi - v) / span).toFloat() * (size.height - 2 * pad)
        if (average != null) {
            drawLine(t.ink2.copy(alpha = 0.6f), Offset(0f, y(average)), Offset(size.width, y(average)), 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())))
        }
        clipRect(right = size.width * reveal.value + 4.dp.toPx()) {
            var path: Path? = null
            values.forEachIndexed { index, value ->
                if (value == null) {
                    path?.let { drawPath(it, t.accent, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)) }
                    path = null
                } else {
                    val point = Offset(index * step, y(value))
                    val current = path
                    if (current == null) {
                        path = Path().apply { moveTo(point.x, point.y) }
                        drawCircle(t.accent, 1.5.dp.toPx(), point)
                    } else {
                        current.lineTo(point.x, point.y)
                    }
                }
            }
            path?.let { drawPath(it, t.accent, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)) }
        }
    }
}

/** Twelve weeks, Monday to Sunday down each column; tap a day to open it. */
@Composable
private fun HeatGrid(map: sk.zdravie.app.logic.Heatmap, onOpenDay: (String) -> Unit) {
    val t = LocalZTokens.current
    val color = when (map.metric) {
        HeatMetric.SLEEP -> t.sleep
        HeatMetric.RESTING -> t.heart
        else -> t.accent
    }
    val levels = listOf(0f, 0.3f, 0.55f, 0.8f, 1f)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.testTag("heatmap")) {
        for (weekday in 0 until 7) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(listOf("po", "ut", "st", "št", "pi", "so", "ne")[weekday], style = mono(10.sp), color = t.muted, modifier = Modifier.width(20.dp))
                for (week in 0 until map.weeks) {
                    val cell = map.cells.getOrNull(week * 7 + weekday)
                    val fill = when {
                        cell == null || cell.future -> t.bg.copy(alpha = 0f)
                        cell.level == 0 -> t.track
                        else -> mixOklab(color, t.bg, levels[cell.level])
                    }
                    Box(
                        Modifier
                            .weight(1f)
                            .aspectRatio(1f)
                            .clip(RoundedCornerShape(4.dp))
                            .background(fill)
                            .then(
                                if (cell != null && !cell.future) {
                                    Modifier.pressClickable(onClickLabel = "Otvoriť ${Format.formatDay(cell.day)}") { onOpenDay(cell.day) }
                                } else Modifier,
                            ),
                    )
                }
            }
        }
    }
}
