package sk.zdravie.app.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sk.zdravie.app.logic.Dates
import sk.zdravie.app.logic.Format
import sk.zdravie.app.logic.Samsung
import sk.zdravie.app.logic.Sleep
import sk.zdravie.app.logic.SleepKind
import sk.zdravie.app.model.Dataset
import sk.zdravie.app.model.SleepStage
import sk.zdravie.app.ui.components.Eyebrow
import sk.zdravie.app.ui.components.Hypnogram
import sk.zdravie.app.ui.components.StageStrip
import sk.zdravie.app.ui.components.ZMotion
import sk.zdravie.app.ui.components.stageColor
import sk.zdravie.app.ui.screens.today.Dot
import sk.zdravie.app.ui.screens.today.InnerTile
import sk.zdravie.app.ui.screens.today.ZPanel
import sk.zdravie.app.ui.screens.today.mono
import sk.zdravie.app.ui.screens.today.urbanist
import sk.zdravie.app.logic.StageSegment
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.ZType

private val STAGE_NAMES = mapOf(
    SleepStage.DEEP to "Hlboký",
    SleepStage.REM to "REM",
    SleepStage.LIGHT to "Ľahký",
    SleepStage.AWAKE to "Bdenie",
)

/**
 * The night ending on [date]: hypnogram, totals, stages, the three night scores (preferred one
 * large), 14 nights against the need and how regular the sleep is. Days are those of the dataset
 * time zone; a night without a timeline says so instead of drawing an empty chart.
 */
@Composable
fun SleepScreen(
    dataset: Dataset,
    date: String,
    today: String,
    kind: SleepKind,
    initial: String,
    onDate: (String) -> Unit,
    onAccount: () -> Unit,
) {
    val t = LocalZTokens.current
    val tz = dataset.timezone
    val night = remember(dataset, date) { Sleep.lastNight(dataset.days, date) }
    val timeline = remember(night) { Sleep.splitTimeline(night) }
    val main = timeline.main
    val ticks = remember(main, tz) { if (main == null) emptyList() else Sleep.hourTicks(main.start, main.end, tz) }
    val stages = remember(night) { Sleep.stageTotals(night) }
    val history = remember(dataset, date, kind) { Sleep.sleepHistory(dataset.days, date, 14, kind) }
    val coverage = remember(history) { Sleep.needCoverage(history) }
    val clock = remember(dataset, date) { Sleep.clockSummary(dataset.days, tz, date, 14) }
    val sri = night?.scores?.sleepRegularity?.takeIf { it.isFinite() }
    val regularity = Sleep.regularityBand(sri)

    DayScaffold("Spánok", date, dataset.firstDay, today, initial, onDate, onAccount, "sleep-list") {
        item(key = "night") {
            ZPanel {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Eyebrow(if (night == null || night.day == date) "Noc" else "Noc · ${Format.formatDay(night.day)}")
                    if (night?.sleepStart != null && night.sleepEnd != null) {
                        Text("${Format.formatClock(night.sleepStart, tz)} → ${Format.formatClock(night.sleepEnd, tz)}", style = mono(12.sp), color = t.ink2)
                    }
                }
                Text(Format.formatDuration(night?.sleepMinutes), style = ZType.figureLarge, color = t.ink, modifier = Modifier.testTag("sleep-total"))
                if (main != null) {
                    Hypnogram(main, ticks, "Fázy spánku v čase od ${Format.formatClock(night?.sleepStart, tz)} do ${Format.formatClock(night?.sleepEnd, tz)}")
                } else {
                    Text(
                        if (night == null) "Pre túto noc nie sú dáta." else "Hodinky k tejto noci neposlali priebeh fáz.",
                        style = urbanist(14.sp),
                        color = t.ink2,
                        modifier = Modifier.testTag("no-timeline"),
                    )
                }
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    val inBed = main?.let { (it.end - it.start) / 60000.0 }
                    val awake = stages.firstOrNull { it.stage == SleepStage.AWAKE }?.minutes
                    Fact("V posteli", Format.formatDurationCompact(inBed), Modifier.weight(1f).fillMaxHeight())
                    Fact("Bdenie", Format.formatDurationCompact(awake), Modifier.weight(1f).fillMaxHeight())
                    Fact("Zdriemnutie", Format.formatDurationCompact(night?.napMinutes), Modifier.weight(1f).fillMaxHeight(), tag = "nap-value")
                }
                if (timeline.naps.isNotEmpty()) {
                    Text(
                        "Zdriemnutia: " + timeline.naps.joinToString(", ") {
                            "${Format.formatClock(java.time.Instant.ofEpochMilli(it.start), tz)} · ${Format.formatDurationCompact(it.asleepMinutes)}"
                        },
                        style = urbanist(13.sp),
                        color = t.ink2,
                        modifier = Modifier.testTag("naps"),
                    )
                }
            }
        }
        item(key = "stages") {
            ZPanel {
                Eyebrow("Fázy")
                val strip = stages.filter { (it.minutes ?: 0.0) > 0 }.map { StageSegment(it.stage, it.minutes ?: 0.0) }
                if (strip.isNotEmpty()) StageStrip(strip, contentDescription = "Podiel fáz spánku")
                stages.forEach { stage ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Dot(stageColor(t, stage.stage), 8.dp)
                        Text(STAGE_NAMES[stage.stage] ?: "", style = urbanist(15.sp), color = t.ink2, modifier = Modifier.weight(1f))
                        Text(Format.formatDurationCompact(stage.minutes), style = urbanist(15.sp, FontWeight.SemiBold), color = t.ink)
                        Text(stage.share?.let { "${Format.formatInt(it * 100)} %" } ?: "", style = mono(12.sp), color = t.muted)
                    }
                }
            }
        }
        item(key = "scores") { ScoresPanel(night, kind) }
        item(key = "need") {
            ZPanel {
                Eyebrow("14 nocí oproti potrebe")
                NeedChart(history.map { it.minutes to it.need }, Modifier.testTag("need-chart"))
                val text = when {
                    coverage.nights == 0 -> "Na porovnanie s potrebou zatiaľ chýbajú dáta."
                    coverage.shortfall == null -> "Potrebu si pokryl ${coverage.covered} z ${coverage.nights} nocí."
                    else -> "Potrebu si pokryl ${coverage.covered} z ${coverage.nights} nocí; keď nie, chýbalo priemerne ${Format.formatDuration(coverage.shortfall)}."
                }
                Text(text, style = urbanist(14.sp), color = t.ink2)
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Dot(t.sleep, 8.dp)
                    Text("spánok", style = urbanist(12.sp), color = t.ink2)
                    Text("— potreba", style = urbanist(12.sp), color = t.ink2)
                }
            }
        }
        item(key = "regularity") {
            ZPanel {
                Eyebrow("Pravidelnosť")
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(sri?.let { Format.formatInt(it) } ?: Format.formatInt(null), style = ZType.figure, color = t.ink)
                    Text(regularity?.label ?: "SRI za 14 dní", style = urbanist(14.sp), color = t.ink2)
                }
                if (regularity != null) Text(regularity.text, style = urbanist(14.sp), color = t.ink2)
                if (clock != null) {
                    Text(
                        "Zaspávaš okolo ${Format.formatTimeOfDay(clock.bedMean)}, vstávaš ${Format.formatTimeOfDay(clock.wakeMean)} · ± ${Format.formatInt(clock.bedSpread)} min",
                        style = urbanist(14.sp),
                        color = t.ink,
                    )
                }
            }
        }
    }
}

@Composable
private fun Fact(label: String, value: String, modifier: Modifier, tag: String? = null) {
    val t = LocalZTokens.current
    InnerTile(modifier) {
        Text(label, style = urbanist(12.sp), color = t.ink2)
        Text(value, style = urbanist(20.sp, FontWeight.Medium), color = t.ink, modifier = if (tag != null) Modifier.testTag(tag) else Modifier)
    }
}

/** The three night scores: the account's preferred one large, the other two small beside it. */
@Composable
private fun ScoresPanel(night: sk.zdravie.app.model.Day?, preferred: SleepKind) {
    val t = LocalZTokens.current
    val order = listOf(preferred) + SleepKind.entries.filter { it != preferred }
    ZPanel {
        Eyebrow("Skóre noci")
        order.forEachIndexed { index, kind ->
            val info = Sleep.SLEEP_KINDS.getValue(kind)
            val score = Sleep.nightScore(night, kind)
            val learning = if (kind == SleepKind.SAMSUNG && score.value == null) Samsung.learningText(score.score) else null
            val value = score.value?.let { Format.formatInt(it) }?.let { if (score.estimate) Format.approx(it) else it }
            val band = info.band(score.value)?.label
            if (index == 0) {
                Column(Modifier.testTag("score-preferred"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(info.label, style = urbanist(14.sp), color = t.ink2)
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(value ?: Format.formatInt(null), style = ZType.figureLarge, color = t.ink)
                        if (band != null) Text(band, style = urbanist(14.sp), color = t.ink2, modifier = Modifier.padding(bottom = 8.dp))
                    }
                    if (learning != null) Text(learning, style = urbanist(13.sp), color = t.ink2, modifier = Modifier.testTag("learning"))
                    Text(info.about, style = urbanist(13.sp), color = t.muted)
                }
            } else {
                Row(Modifier.fillMaxWidth().testTag("score-${kind.name.lowercase()}"), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text(info.label, style = urbanist(15.sp), color = t.ink2)
                    Text(learning ?: value ?: Format.formatInt(null), style = urbanist(18.sp, FontWeight.Medium), color = t.ink)
                }
            }
        }
    }
}

/** Nights as bars and the need of the evening before as a dashed tick on each bar. */
@Composable
private fun NeedChart(nights: List<Pair<Double?, Double?>>, modifier: Modifier = Modifier) {
    val t = LocalZTokens.current
    val top = (nights.flatMap { listOfNotNull(it.first, it.second) }.maxOrNull() ?: 600.0).coerceAtLeast(60.0)
    val grow by animateFloatAsState(1f, tween(ZMotion.MOVE_MS, easing = ZMotion.EaseInOut), label = "need")
    Canvas(modifier.fillMaxWidth().height(120.dp).semantics { contentDescription = "Spánok za 14 nocí oproti potrebe" }) {
        val slot = size.width / nights.size.coerceAtLeast(1)
        val w = slot * 0.56f
        nights.forEachIndexed { index, (minutes, need) ->
            val x = slot * index + (slot - w) / 2f
            if (minutes != null) {
                val h = (minutes / top).toFloat() * size.height * grow
                val color = if (need != null && minutes < need) t.sleep.copy(alpha = 0.55f) else t.sleep
                drawRoundRect(color, Offset(x, size.height - h), Size(w, h), CornerRadius(3.dp.toPx()))
            }
            if (need != null) {
                val y = size.height - (need / top).toFloat() * size.height
                drawLine(
                    t.ink,
                    Offset(x - 2.dp.toPx(), y),
                    Offset(x + w + 2.dp.toPx(), y),
                    2.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 2.dp.toPx())),
                )
            }
        }
    }
}
