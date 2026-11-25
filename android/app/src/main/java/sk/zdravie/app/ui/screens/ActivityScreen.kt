package sk.zdravie.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sk.zdravie.app.logic.Activity
import sk.zdravie.app.logic.Dates
import sk.zdravie.app.logic.DayKey
import sk.zdravie.app.logic.DayMetric
import sk.zdravie.app.logic.DayValues
import sk.zdravie.app.logic.Format
import sk.zdravie.app.logic.Metrics
import sk.zdravie.app.logic.Scores
import sk.zdravie.app.model.Dataset
import sk.zdravie.app.model.Workout
import sk.zdravie.app.ui.components.Eyebrow
import sk.zdravie.app.ui.components.MiniBars
import sk.zdravie.app.ui.components.Sparkline
import sk.zdravie.app.ui.components.ZoneBar
import sk.zdravie.app.ui.components.pressClickable
import sk.zdravie.app.ui.screens.today.InnerTile
import sk.zdravie.app.ui.screens.today.ZPanel
import sk.zdravie.app.ui.screens.today.mono
import sk.zdravie.app.ui.screens.today.urbanist
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.ZType
import sk.zdravie.app.ui.theme.panelColor

/**
 * Steps with 30 days, strain over 14 days, cardio load over 8 weeks, four day tiles, zones and the
 * workouts of 30 days. A workout opens in a bottom sheet with zones, heart rate, strain, energy,
 * distance and, for running and walking only, the pace.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActivityScreen(
    dataset: Dataset,
    date: String,
    today: String,
    initial: String,
    onDate: (String) -> Unit,
    onAccount: () -> Unit,
) {
    val t = LocalZTokens.current
    val byDay = remember(dataset) { Metrics.indexByDay(dataset.days) }
    val day = byDay[date]
    val window = remember(dataset, date) { Metrics.windowEnding(dataset.days, date, 30) }
    val steps30 = window.map { slot -> slot.data?.steps }
    val stats = remember(dataset, date) { Activity.stepsStats(dataset.days, date, 30) }
    val strain14 = (13 downTo 0).map { back -> byDay[Dates.addDays(date, -back)]?.scores?.strain?.takeIf { it.isFinite() } }
    val weeks = remember(dataset, date) { Activity.cardioWeeks(Activity.cardioTrend(dataset.days, date, 56)).reversed() }
    val status = day?.scores?.cardioLoad?.status
    val workouts = remember(dataset, date) {
        val from = Dates.addDays(date, -29)
        Metrics.allWorkouts(dataset.days).filter { it.day in from..date }.sortedByDescending { it.start }
    }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    val selected = workouts.firstOrNull { it.id == open }

    DayScaffold("Aktivita", date, dataset.firstDay, today, initial, onDate, onAccount, "activity-list") {
        item(key = "steps") {
            ZPanel {
                Eyebrow(if (date == today) "Kroky dnes" else "Kroky · ${Format.formatDay(date)}")
                Text(Format.formatInt(day?.steps), style = ZType.display.copy(fontSize = 72.sp, lineHeight = 66.sp), color = t.ink, modifier = Modifier.testTag("steps-value"))
                Text(
                    "priemer 30 dní ${Format.formatInt(stats.average)} · zdroj ${Format.stepsSourceLabel(day?.stepsSource)}",
                    style = urbanist(14.sp),
                    color = t.ink2,
                    modifier = Modifier.testTag("steps-average"),
                )
                Sparkline(steps30, t.accent, height = 64.dp, contentDescription = "Kroky za 30 dní, priemer ${Format.formatInt(stats.average)}")
            }
        }
        item(key = "strain") {
            ZPanel {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Eyebrow("Strain · 14 dní")
                    Text(Scores.formatStrain(day?.scores?.strain), style = urbanist(20.sp, FontWeight.Medium), color = t.ink, modifier = Modifier.testTag("strain-today"))
                }
                MiniBars(strain14, setOf(13), t.accent, height = 72.dp, contentDescription = "Strain za 14 dní")
                Text(Scores.strainBand(day?.scores?.strain)?.label?.let { "dnes $it" } ?: "dnes zatiaľ bez strainu", style = urbanist(13.sp), color = t.ink2)
            }
        }
        item(key = "load") {
            ZPanel {
                Eyebrow("Stav záťaže · 8 týždňov")
                Text(Scores.cardioStatusLabel(status).replaceFirstChar { it.uppercase() }, style = ZType.heading, color = t.ink)
                MiniBars(weeks.map { it.ratio }, setOf(weeks.size - 1), t.accent, height = 64.dp, contentDescription = "Pomer 7 dní oproti 28 dňom za 8 týždňov")
                Text(Activity.cardioText(status) ?: "Potrebuje aspoň pár týždňov dát.", style = urbanist(13.sp), color = t.ink2)
            }
        }
        item(key = "tiles") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    DayTile("Aktívny čas", Format.approx(Format.formatDuration(day?.activeMinutesEst)), Modifier.weight(1f).fillMaxHeight())
                    DayTile("Kalórie spolu", DayValues.dayFigure(day, DayMetric.TOTAL_ENERGY, Format::formatInt), Modifier.weight(1f).fillMaxHeight())
                }
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    DayTile("Vzdialenosť", DayValues.dayFigure(day, DayMetric.DISTANCE, Format::formatDistance), Modifier.weight(1f).fillMaxHeight(), tag = "distance-value")
                    DayTile("Priemerný tep", Format.formatBpm(day?.hrAvg), Modifier.weight(1f).fillMaxHeight())
                }
            }
        }
        item(key = "zones") {
            ZPanel {
                Eyebrow("Zóny tepu")
                ZoneBar(day?.zoneLightMin, day?.zoneModerateMin, day?.zoneVigorousMin, contentDescription = "Zóny tepu dňa")
                Text(
                    "ľahká ${Format.formatInt(day?.zoneLightMin)} · stredná ${Format.formatInt(day?.zoneModerateMin)} · vysoká ${Format.formatInt(day?.zoneVigorousMin)} min",
                    style = urbanist(13.sp),
                    color = t.ink2,
                )
            }
        }
        item(key = "workouts") {
            ZPanel {
                Eyebrow("Tréningy · 30 dní")
                if (workouts.isEmpty()) Text("Za 30 dní žiadny tréning.", style = urbanist(14.sp), color = t.ink2)
                workouts.forEach { workout -> WorkoutRow(workout, dataset.timezone) { open = workout.id } }
            }
        }
    }

    if (selected != null) {
        ModalBottomSheet(
            onDismissRequest = { open = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = panelColor(t),
        ) {
            WorkoutDetail(selected, dataset.timezone)
        }
    }
}

@Composable
private fun DayTile(label: String, value: String, modifier: Modifier, tag: String? = null) {
    val t = LocalZTokens.current
    InnerTile(modifier, horizontal = 16.dp, vertical = 16.dp) {
        Text(label, style = urbanist(12.sp), color = t.ink2)
        Text(value, style = urbanist(26.sp, spacing = -0.02f, line = 1.1f), color = t.ink, modifier = if (tag != null) Modifier.testTag(tag) else Modifier)
    }
}

@Composable
private fun WorkoutRow(workout: Workout, tz: String, onOpen: () -> Unit) {
    val t = LocalZTokens.current
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(RoundedCornerShape(16.dp))
            .pressClickable(onClickLabel = "Detail tréningu", onClick = onOpen)
            .padding(vertical = 8.dp)
            .testTag("workout-${workout.id}"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(Format.workoutLabel(workout.type), style = urbanist(16.sp, FontWeight.SemiBold), color = t.ink)
            Text("${Format.formatDay(workout.day)} · ${Format.formatClock(workout.start, tz)}", style = mono(11.sp), color = t.muted)
        }
        Text(Format.formatDurationCompact(workout.durationS?.div(60)), style = urbanist(16.sp, FontWeight.Medium), color = t.ink)
        Text(Scores.formatStrain(workout.strain), style = mono(12.sp), color = t.ink2)
    }
}

/** Minutes per km, only where a pace means something. */
internal fun paceText(workout: Workout): String? {
    val type = workout.type.lowercase()
    if (!(type.contains("run") || type.contains("walk") || type.contains("beh") || type.contains("chôdz"))) return null
    val minutes = workout.durationS?.div(60) ?: return null
    val km = workout.distanceM?.div(1000)?.takeIf { it > 0.05 } ?: return null
    val pace = minutes / km
    val whole = pace.toInt()
    val seconds = ((pace - whole) * 60).toInt()
    return "$whole:${seconds.toString().padStart(2, '0')} min/km"
}

@Composable
private fun WorkoutDetail(workout: Workout, tz: String) {
    val t = LocalZTokens.current
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(bottom = 24.dp).navigationBarsPadding().testTag("workout-sheet"),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Eyebrow("${Format.formatDay(workout.day)} · ${Format.formatClock(workout.start, tz)} → ${Format.formatClock(workout.end, tz)}")
        Text(Format.workoutLabel(workout.type), style = ZType.title, color = t.ink)
        Text(Format.formatDuration(workout.durationS?.div(60)), style = ZType.figure, color = t.ink)
        ZoneBar(workout.zoneLightMin, workout.zoneModerateMin, workout.zoneVigorousMin, contentDescription = "Zóny tepu tréningu")
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            DayTile("Tep min / priem / max", "${Format.formatInt(workout.hrMin)} / ${Format.formatInt(workout.hrAvg)} / ${Format.formatInt(workout.hrMax)}", Modifier.weight(1f).fillMaxHeight())
            DayTile("Strain", Scores.formatStrain(workout.strain), Modifier.weight(1f).fillMaxHeight())
        }
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            DayTile("Energia", Format.approx(Format.formatKcal(workout.kcalEst)), Modifier.weight(1f).fillMaxHeight())
            DayTile("Vzdialenosť", Format.formatDistance(workout.distanceM), Modifier.weight(1f).fillMaxHeight())
        }
        paceText(workout)?.let { pace ->
            Text("Tempo $pace", style = urbanist(16.sp, FontWeight.Medium), color = t.ink, modifier = Modifier.testTag("pace"))
        }
    }
}
