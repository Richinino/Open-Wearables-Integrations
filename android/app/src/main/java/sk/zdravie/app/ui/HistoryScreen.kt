package sk.zdravie.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import sk.zdravie.app.model.AppUiState
import sk.zdravie.app.model.DaySummary

@Composable
internal fun HistoryScreen(state: AppUiState, metric: HistoryMetric, onMetric: (HistoryMetric) -> Unit, onRefresh: () -> Unit) {
    var selectedDay by remember { mutableStateOf<String?>(null) }
    var range by remember { mutableStateOf(14) }
    var showValues by remember { mutableStateOf(false) }
    val days = remember(state.days) { state.days.sortedByDescending { it.day } }
    val selected = days.firstOrNull { it.day == selectedDay }
    BackHandler(enabled = selectedDay != null) { selectedDay = null }
    if (selectedDay != null) {
        DayDetail(selected, onBack = { selectedDay = null })
        return
    }
    val points = remember(days, range) { chartDays(days, range) }
    ScreenList {
        item { ScreenHeading("História", "Súvislosti sa ukazujú v čase") }
        item { RefreshStatus(state, onRefresh) }
        if (days.isEmpty()) {
            item { NoData(state, onRefresh) }
        } else {
            item {
                Panel {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        HistoryMetric.entries.forEach { item ->
                            FilterChip(selected = item == metric, onClick = { onMetric(item) }, label = { Text(item.title) })
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(14, 30).forEach { count ->
                            FilterChip(selected = range == count, onClick = { range = count }, label = { Text("$count dní") })
                        }
                    }
                    Text(metric.label(days.firstOrNull()), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    MutedText("Posledný dostupný deň · ${shortDay(days.first().day)}", small = true)
                    HistoryChart(points, metric)
                    MutedText("Medzera v grafe znamená chýbajúci údaj. Pripravenosť ≈ je približné skóre.", small = true)
                    TextButton(onClick = { showValues = !showValues }, modifier = Modifier.fillMaxWidth()) {
                        Text(if (showValues) "Skryť hodnoty grafu" else "Zobraziť hodnoty grafu")
                    }
                    if (showValues) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        SectionTitle("Hodnoty grafu · ${metric.title}")
                        points.asReversed().forEach { point ->
                            ValueRow(shortDay(point.date.toString()), metric.label(point.day))
                        }
                    }
                }
            }
            item { SectionTitle("Všetky dostupné dni · ${days.size}") }
            items(days, key = { it.day }) { day ->
                HistoryDayRow(day, metric) { selectedDay = day.day }
            }
        }
    }
}

@Composable
private fun HistoryDayRow(day: DaySummary, metric: HistoryMetric, onClick: () -> Unit) {
    Panel(Modifier.clickable(onClickLabel = "Zobraziť detail dňa", onClick = onClick).semantics(mergeDescendants = true) {}) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val dateBlock: @Composable () -> Unit = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(dayLabel(day.day), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    MutedText(if (day.complete) "Uzavretý deň" else "Priebežné údaje", small = true)
                }
            }
            if (maxWidth < 340.dp || LocalDensity.current.fontScale > 1.25f) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    dateBlock()
                    Text("${metric.title}: ${metric.label(day)}", fontWeight = FontWeight.Medium)
                    MutedText("Detail dňa →", small = true)
                }
            } else Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Column(Modifier.weight(1f)) { dateBlock() }
                Column(Modifier.weight(0.8f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(metric.label(day), fontWeight = FontWeight.SemiBold)
                    MutedText("Detail dňa →", small = true)
                }
            }
        }
    }
}

private data class ChartDay(val date: LocalDate, val day: DaySummary?)

/** Every calendar date occupies an x position, so neither absent dates nor null metrics become zero. */
private fun chartDays(days: List<DaySummary>, count: Int): List<ChartDay> {
    val indexed = days.mapNotNull { day -> parseDay(day.day)?.let { it to day } }.toMap()
    val end = indexed.keys.maxOrNull() ?: LocalDate.now()
    return List(count) { index ->
        val date = end.minusDays((count - index - 1).toLong())
        ChartDay(date, indexed[date])
    }
}

@Composable
private fun HistoryChart(points: List<ChartDay>, metric: HistoryMetric) {
    val values = points.map { it.day?.let(metric::value) }
    val present = values.filterNotNull()
    val color = when (metric) {
        HistoryMetric.STEPS -> MaterialTheme.colorScheme.primary
        HistoryMetric.SLEEP, HistoryMetric.READINESS -> MaterialTheme.colorScheme.secondary
        HistoryMetric.RESTING_HR -> MaterialTheme.colorScheme.tertiary
    }
    val grid = MaterialTheme.colorScheme.outlineVariant
    val rawMax = present.maxOrNull() ?: 0.0
    val minimum = if (metric == HistoryMetric.RESTING_HR && present.isNotEmpty()) max(0.0, floor(((present.minOrNull() ?: 0.0) - 8.0) / 10.0) * 10.0) else 0.0
    val maximum = when (metric) {
        HistoryMetric.STEPS -> max(1000.0, ceil(rawMax / 1000.0) * 1000.0)
        HistoryMetric.SLEEP -> max(8.0, ceil(rawMax))
        HistoryMetric.READINESS -> max(100.0, ceil(rawMax))
        HistoryMetric.RESTING_HR -> max(minimum + 20.0, ceil((rawMax + 5.0) / 10.0) * 10.0)
    }
    val description = "${metric.title}, ${points.size} dní. ${present.size} dní s údajom, ${points.size - present.size} dní bez údaja. Os od ${decimal(minimum)} do ${decimal(maximum)} ${metric.unit}. Presné hodnoty sú pod tlačidlom Zobraziť hodnoty grafu."
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        MutedText("${decimal(maximum)} ${metric.unit}", small = true)
        Canvas(Modifier.fillMaxWidth().height(176.dp).clearAndSetSemantics { contentDescription = description }) {
            val inset = 7.dp.toPx()
            val graphWidth = (size.width - inset * 2).coerceAtLeast(1f)
            val graphHeight = size.height - inset * 2
            val xStep = graphWidth / (points.size - 1).coerceAtLeast(1)
            fun point(index: Int, value: Double): Offset = Offset(
                x = inset + xStep * index,
                y = inset + graphHeight * (1.0 - (value - minimum) / (maximum - minimum)).toFloat(),
            )
            listOf(0f, 0.5f, 1f).forEach { fraction ->
                val y = inset + graphHeight * fraction
                drawLine(grid, Offset(inset, y), Offset(size.width - inset, y), strokeWidth = 1.dp.toPx())
            }
            values.forEachIndexed { index, value ->
                if (value != null) {
                    val current = point(index, value)
                    if (index > 0) values[index - 1]?.let { previous ->
                        drawLine(color, point(index - 1, previous), current, strokeWidth = 3.dp.toPx(), cap = StrokeCap.Round)
                    }
                    drawCircle(color, if (points.size > 14) 2.5.dp.toPx() else 3.5.dp.toPx(), current)
                }
            }
        }
        MutedText("${decimal(minimum)} ${metric.unit}", small = true)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            MutedText(shortDay(points.first().date.toString()), small = true)
            MutedText(shortDay(points.last().date.toString()), small = true)
        }
        if (present.isEmpty()) MutedText("V tomto období nie sú údaje pre ${metric.title.lowercase()}.")
    }
}

@Composable
private fun DayDetail(day: DaySummary?, onBack: () -> Unit) {
    ScreenList {
        item { TextButton(onClick = onBack) { Text("← Späť na históriu") } }
        if (day == null) {
            item {
                Panel {
                    SectionTitle("Tento deň už nie je dostupný")
                    MutedText("Po obnovení údajov sa história zmenila. Vyberte deň znova.")
                    OutlinedButton(onClick = onBack) { Text("Otvoriť históriu") }
                }
            }
        } else {
            item { ScreenHeading("Detail dňa", dayLabel(day.day)) }
            item { StatusPill(if (day.complete) "Uzavretý deň" else "Priebežné údaje", MaterialTheme.colorScheme.secondary) }
            item {
                Panel {
                    SectionTitle("Pohyb")
                    ValueRow("Kroky", steps(day.steps))
                    ValueRow("Vzdialenosť", distanceLabel(day))
                    ValueRow("Aktívny čas", activeMinutesLabel(day))
                    ValueRow("Skóre aktivity", finiteValue(day.activityScore)?.let { "${whole(it)} / 100" } ?: "—")
                }
            }
            item {
                Panel {
                    SectionTitle("Spánok a pripravenosť")
                    ValueRow("Spánok", duration(day.sleepMinutes))
                    ValueRow("Skóre spánku", sleepScoreLabel(day))
                    ValueRow("Pripravenosť ≈", finiteValue(day.readiness)?.let { "≈ ${whole(it)} / 100" } ?: "—")
                    MutedText("Pripravenosť je približné skóre vypočítané z dostupných údajov.", small = true)
                }
            }
            item {
                Panel {
                    SectionTitle("Srdcové údaje")
                    ValueRow("Pokojový tep", finiteValue(day.restingHr)?.let { "${restingHrValue(day)} úderov/min" } ?: "—")
                    if (day.restingHrSource == "derived" || day.restingHrSource == "estimated") MutedText("Pokojový tep bol odvodený z dostupných meraní.", small = true)
                    ValueRow("Variabilita tepu · HRV", finiteValue(day.hrvMs)?.let { "${decimal(it)} ms" } ?: "—")
                    if (day.hrvKind in listOf("rmssd", "sdnn", "RMSSD", "SDNN")) MutedText("Metóda HRV: ${day.hrvKind?.uppercase()}", small = true)
                }
            }
            item { SectionTitle("Tréningy · ${day.workouts.size}") }
            if (day.workouts.isEmpty()) {
                item { Panel { MutedText("Pre tento deň nie je zaznamenaný tréning.") } }
            } else items(day.workouts, key = { it.id }) { WorkoutCard(it, day.timezone) }
            item { MutedText("Chýbajúce údaje zobrazujeme ako —. Symbol ≈ označuje približnú hodnotu.", small = true) }
        }
    }
}

internal fun distanceLabel(day: DaySummary): String = finiteValue(day.distanceMeters)?.let {
    "${if (day.distanceSource == "estimated") "≈ " else ""}${decimal(it / 1000)} km"
} ?: "—"
