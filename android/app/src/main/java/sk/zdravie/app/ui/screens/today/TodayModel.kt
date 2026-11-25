package sk.zdravie.app.ui.screens.today

import java.time.Instant
import kotlin.math.floor
import sk.zdravie.app.logic.Activity
import sk.zdravie.app.logic.Band
import sk.zdravie.app.logic.Dates
import sk.zdravie.app.logic.DayKey
import sk.zdravie.app.logic.DayMetric
import sk.zdravie.app.logic.DayValues
import sk.zdravie.app.logic.Format
import sk.zdravie.app.logic.Format.DASH
import sk.zdravie.app.logic.Heart
import sk.zdravie.app.logic.LatestDays
import sk.zdravie.app.logic.Metrics
import sk.zdravie.app.logic.Mode
import sk.zdravie.app.logic.NightAlert
import sk.zdravie.app.logic.Overview
import sk.zdravie.app.logic.Samsung
import sk.zdravie.app.logic.Scores
import sk.zdravie.app.logic.Sleep
import sk.zdravie.app.logic.SleepKind
import sk.zdravie.app.logic.StageSegment
import sk.zdravie.app.model.Dataset
import sk.zdravie.app.model.Day
import sk.zdravie.app.model.InsightsResult
import sk.zdravie.app.model.SleepStage
import sk.zdravie.app.model.ValueSource

/** Colour role of a row, bar or card; the UI maps it onto the theme tokens. */
internal enum class Tone { ACCENT, SLEEP, HEART, INK }

internal class SubRow(val label: String, val value: String, val fraction: Float, val tone: Tone, val reason: String)

internal class MorningHero(
    /** The day score itself, for the count-up of the ring; null when there is none. */
    val score: Double?,
    /** The day the score belongs to: the ring moment plays once per day and app run. */
    val date: String,
    val valueText: String,
    val fraction: Float,
    val label: String,
    val description: String,
    val sentence: String,
    val rows: List<SubRow>,
)

internal class EveningHero(
    val strainText: String,
    val fraction: Float,
    val label: String,
    val description: String,
    val sentence: String,
    val needText: String,
    val bedtimeText: String,
    val wakeNote: String,
)

internal class InsightCard(
    val key: String,
    /** Subject line above a Balík 1 card ("Spánok"); null for the web observations, which carry bars. */
    val subject: String?,
    val tone: Tone,
    val text: String,
    val detail: String?,
    val bars: List<Double?>,
    val highlight: Set<Int>,
)

internal class InsightsView(val cards: List<InsightCard>, val notes: List<String>)

internal class Legend(val stage: SleepStage, val label: String, val value: String)

internal class SleepBlock(
    val latest: String?,
    val clock: String?,
    val duration: String,
    /** Null while the score is learning; [learning] then says how far it is. */
    val scoreText: String?,
    val scoreCaption: String,
    val learning: String?,
    val segments: List<StageSegment>,
    val stripDescription: String,
    val legend: List<Legend>,
    val footer: String,
)

internal class Mini(val label: String, val value: String, val note: String, val bars: List<Double?>, val description: String)

internal class ActivityBlock(
    val title: String,
    val latest: String?,
    val steps: String,
    val averageLine: String,
    val above: Boolean,
    val ringFraction: Float,
    val ringText: String,
    val ringDescription: String,
    val minis: List<Mini>,
    val zoneTotal: String,
    val light: Double?,
    val moderate: Double?,
    val vigorous: Double?,
    val zoneLegend: List<String>,
    val zoneDescription: String,
)

internal class HeartBlock(
    val latest: String?,
    val resting: String,
    val restingCaption: String,
    val series: List<Double?>,
    val seriesDescription: String,
    val hrvLabel: String,
    val hrv: String,
    val hrvNote: String,
    val night: String,
    /** "green", "yellow", "red" or null. */
    val nightLevel: String?,
    val nightWord: String,
    val nightNote: String,
)

internal class LoadBlock(val status: String, val line: String, val ratio: Double?, val vo2max: String, val description: String)

internal class WorkoutRow(
    val id: String,
    val type: String,
    val duration: String,
    val light: Double?,
    val moderate: Double?,
    val vigorous: Double?,
    val meta: List<String>,
    val zoneDescription: String,
)

internal class WorkoutsBlock(val title: String, val summary: String?, val rows: List<WorkoutRow>, val empty: String)

/** Everything the Today screen shows for one date and mode, computed once per input change. */
internal class TodayModel(
    val date: String,
    val today: String,
    val mode: Mode,
    val eyebrow: String,
    val title: String,
    val canGoBack: Boolean,
    val canGoForward: Boolean,
    /** The day of [date] exists and is still running. */
    val incomplete: Boolean,
    val alert: NightAlert?,
    val morning: MorningHero?,
    val evening: EveningHero?,
    val webInsights: List<InsightCard>,
    val sleep: SleepBlock,
    val activity: ActivityBlock,
    val heart: HeartBlock,
    val load: LoadBlock,
    val workouts: WorkoutsBlock,
)

private fun Double?.finite(): Double? = this?.takeIf { it.isFinite() }

/** JS Math.round, as the web rounds. */
private fun jsRound(value: Double): Double = floor(value + 0.5)

private fun fraction(value: Double?, max: Double): Float =
    ((value ?: 0.0) / max).coerceIn(0.0, 1.0).toFloat()

private fun withBand(band: Band?, reason: String): String = if (band != null) "${band.label} · $reason" else reason

/** "rano" / "vecer" for [Scores.resolveMode]; null keeps the automatic layout. */
internal fun overrideKey(mode: Mode?): String? = when (mode) {
    Mode.MORNING -> "rano"
    Mode.EVENING -> "vecer"
    null -> null
}

/**
 * The day the overview opens on, as the web picks it: the focus day of [Scores.resolveMode] (with
 * [mode] forcing the layout when given), or the last day with data before it when the source is behind.
 */
fun focusDate(dataset: Dataset, now: Instant, mode: Mode? = null): String {
    val focus = Scores.resolveMode(now, dataset.timezone, overrideKey(mode)).day
    if (dataset.days.any { it.day == focus }) return focus
    return dataset.days.lastOrNull { it.day <= focus }?.day ?: dataset.lastDay ?: focus
}

private fun capitalized(text: String): String = text.replaceFirstChar { it.uppercase() }

private fun sleepCaption(kind: SleepKind): String = when (kind) {
    SleepKind.PERFORMANCE -> "Sleep Performance"
    SleepKind.APPLE -> "Apple skóre"
    SleepKind.SAMSUNG -> "Samsung skóre"
}

private fun stageLabel(stage: SleepStage): String = when (stage) {
    SleepStage.DEEP -> "Hlboký"
    SleepStage.REM -> "REM"
    SleepStage.LIGHT -> "Ľahký"
    SleepStage.AWAKE -> "Bdenie"
    SleepStage.ASLEEP -> "Spánok"
}

internal fun buildTodayModel(dataset: Dataset, date: String, today: String, mode: Mode, kind: SleepKind): TodayModel {
    val days = dataset.days
    val tz = dataset.timezone
    val byDay = Metrics.indexByDay(days)
    val day = byDay[date]
    val previous = byDay[Dates.addDays(date, -1)]
    // While the day is an empty shell, the tiles show the latest day with data and say how old it is.
    val shown = LatestDays.latestDay(days, date, today)
    val first = dataset.firstDay ?: days.firstOrNull()?.day

    val long = Format.formatDayLong(date)
    val year = date.take(4)
    val eyebrow = if (year == today.take(4)) long.removeSuffix(" $year") else long
    val base = when (Dates.diffDays(date, today)) {
        0 -> "Dnes"
        1 -> "Včera"
        else -> capitalized(long.substringBefore(' '))
    }

    return TodayModel(
        date = date,
        today = today,
        mode = mode,
        eyebrow = eyebrow,
        title = if (mode == Mode.EVENING) "$base večer" else base,
        canGoBack = first != null && date > first,
        canGoForward = date < today,
        incomplete = day?.complete == false,
        alert = Scores.nightSignalAlert(day?.scores?.nightSignal),
        morning = if (mode == Mode.MORNING) morningHero(day, previous, kind, date) else null,
        evening = if (mode == Mode.EVENING) eveningHero(dataset, day, date) else null,
        webInsights = webInsights(days, date),
        sleep = sleepBlock(dataset, byDay, date, today, kind),
        activity = activityBlock(days, shown.day, shown.date, shown.date == today, shown.label),
        heart = heartBlock(days, day, shown.day, shown.date, shown.label),
        load = loadBlock(day),
        workouts = workoutsBlock(tz, shown.day, shown.date, shown.date == today),
    )
}

private fun morningHero(day: Day?, previous: Day?, kind: SleepKind, date: String): MorningHero {
    val value = day?.scores?.dayScore.finite()
    val label = Scores.dayScoreLabel(value)
    return MorningHero(
        score = value,
        date = date,
        valueText = Format.formatInt(value),
        fraction = fraction(value, 100.0),
        label = label,
        description = if (value == null) "Skóre dňa zatiaľ nie je" else "Skóre dňa ${Format.formatInt(value)} zo 100, $label",
        sentence = Scores.morningSummary(day?.scores),
        rows = if (day == null) emptyList() else subRows(day, previous, kind),
    )
}

/** Readiness, the account's preferred sleep score and Activity, each with the web's band and reason. */
private fun subRows(day: Day, previous: Day?, kind: SleepKind): List<SubRow> {
    val (readiness, sleep, activity) = Scores.subScores(day, previous)
    val night = Sleep.nightScore(day, kind)
    val info = Sleep.SLEEP_KINDS.getValue(kind)
    val value = night.value
    val estimated = night.estimate || (!night.fromSamsung && Scores.isEstimate(night.score))
    val text = value?.let { val whole = Format.formatInt(it); if (estimated) Format.approx(whole) else whole } ?: DASH
    val learning = if (value == null) Samsung.learningText(night.score) else null
    return listOf(
        SubRow("Pripravenosť ≈", readiness.display, fraction(readiness.value, 100.0), Tone.HEART, withBand(readiness.band, readiness.reason)),
        SubRow("Spánok", text, fraction(value, 100.0), Tone.SLEEP, learning ?: withBand(info.band(value), sleep.reason)),
        SubRow("Aktivita", activity.display, fraction(activity.value, 100.0), Tone.ACCENT, withBand(activity.band, activity.reason)),
    )
}

private fun eveningHero(dataset: Dataset, day: Day?, date: String): EveningHero {
    val scores = day?.scores
    val strain = scores?.strain.finite()
    val band = Scores.strainBand(strain)
    val plan = Sleep.needTonight(dataset.days, dataset.timezone, date)
    val strainText = Scores.formatStrain(strain)
    return EveningHero(
        strainText = strainText,
        fraction = fraction(strain, Activity.STRAIN_MAX.toDouble()),
        label = if (band != null) "z 21 · ${band.label}" else "zatiaľ bez dát",
        description = if (band == null) "Strain zatiaľ nie je" else "Strain dňa $strainText z 21, ${band.label}",
        sentence = Scores.eveningSummary(scores, plan.bedtime),
        needText = Format.formatDurationCompact(plan.need),
        bedtimeText = Format.formatTimeOfDay(plan.bedtime),
        wakeNote = if (plan.wake != null) "vstávaš zvyčajne ${Format.formatTimeOfDay(plan.wake)}" else "na bežný čas vstávania je málo nocí",
    )
}

private fun toneOf(tone: String): Tone = when (tone) {
    "sleep" -> Tone.SLEEP
    "heart" -> Tone.HEART
    else -> Tone.ACCENT
}

/** The web's observations without the resting-heart trend, which the heart panel already shows. */
private fun webInsights(days: List<Day>, date: String): List<InsightCard> =
    Overview.insights(days, date).filter { it.key != "restingTrend" }.map { insight ->
        InsightCard(
            key = insight.key,
            subject = null,
            tone = toneOf(insight.tone),
            text = insight.text,
            detail = insight.detail,
            bars = insight.bars.map { it.value },
            highlight = insight.bars.indices.filter { insight.bars[it].highlight }.toSet(),
        )
    }

private val SUBJECTS: Map<String, Pair<String, Tone>> = mapOf(
    "sleep_duration" to ("Spánok" to Tone.SLEEP),
    "resting_hr_trend" to ("Pokojový tep" to Tone.HEART),
    "readiness_change" to ("Pripravenosť" to Tone.INK),
    "readiness_comparability" to ("Pripravenosť" to Tone.INK),
)

/** Balík 1 observations with the web's subject labels and status lines. */
internal fun balikInsights(result: InsightsResult): InsightsView {
    val cards = result.items.map { item ->
        val (subject, tone) = SUBJECTS[item.messageKey] ?: ("Postreh" to Tone.INK)
        InsightCard(item.id, subject, tone, item.text, null, emptyList(), emptySet())
    }
    val notes = buildList {
        if (cards.isEmpty()) {
            add(
                if (result.status == "insufficient_data") "Na porovnanie zatiaľ nemáme dostatok údajov."
                else "V dostupných porovnaniach dnes nebola výrazná zmena.",
            )
        }
        if (result.status == "partial") add("Niektoré porovnania čakajú na ďalšie údaje.")
    }
    return InsightsView(cards, notes)
}

private fun sleepBlock(dataset: Dataset, byDay: Map<String, Day>, date: String, today: String, kind: SleepKind): SleepBlock {
    val tz = dataset.timezone
    val night = Sleep.lastNight(dataset.days, date)
    val minutes = night?.sleepMinutes.finite()
    val hasSleep = minutes != null
    val score = Sleep.nightScore(night, kind)
    val value = score.value
    val estimated = score.estimate || (!score.fromSamsung && Scores.isEstimate(score.score))
    val learning = if (value == null) Samsung.learningText(score.score) else null
    val duration = if (hasSleep) Format.formatDuration(minutes) else DASH
    val need = night?.let { byDay[Dates.addDays(it.day, -1)]?.scores?.sleepNeedMinutes.finite() }
    val footer = when {
        !hasSleep -> "Minulú noc sa spánok nezaznamenal."
        need != null -> "Potreba bola ${Format.formatDuration(need)}"
        else -> Overview.sleepWindow(dataset.days, tz, date)?.let {
            "Zaspávaš okolo ${Format.formatTimeOfDay(it.bedtime)}, vstávaš ${Format.formatTimeOfDay(it.wake)} · ± ${Format.formatInt(it.spread)} min"
        } ?: "Na bežné časy je zatiaľ málo nocí."
    }
    return SleepBlock(
        latest = night?.takeIf { it.day != date }?.let { "posledné dáta: ${LatestDays.ageLabel(it.day, today)}" },
        clock = if (hasSleep) "${Format.formatClock(night?.sleepStart, tz)} → ${Format.formatClock(night?.sleepEnd, tz)}" else null,
        duration = duration,
        scoreText = when {
            value != null -> Format.formatInt(value).let { if (estimated) Format.approx(it) else it }
            learning != null -> null
            else -> DASH
        },
        scoreCaption = sleepCaption(kind),
        learning = learning,
        segments = Overview.sleepSegments(night),
        stripDescription = if (hasSleep) "Priebeh noci po fázach, $duration spánku" else "Priebeh noci",
        legend = Sleep.stageTotals(night).map { Legend(it.stage, stageLabel(it.stage), Format.formatDurationCompact(it.minutes)) },
        footer = footer,
    )
}

private fun activityBlock(days: List<Day>, day: Day?, date: String, isToday: Boolean, latest: String?): ActivityBlock {
    val steps = day?.steps.finite()
    val average = Activity.stepsStats(days, date, 30).average
    val share = if (steps != null && average != null && average > 0) steps / average else null
    val percent = share?.let { jsRound(it * 100) }
    val above = percent != null && percent > 100
    fun week(key: DayKey) = Metrics.series(Metrics.windowEnding(days, date, 7), key).map { it.value }
    fun usual(key: DayKey) = Metrics.periodSummary(days, date, 30, key).average
    val light = day?.zoneLightMin.finite()
    val moderate = day?.zoneModerateMin.finite()
    val vigorous = day?.zoneVigorousMin.finite()
    val zoneSum = Metrics.sum(listOf(light, moderate, vigorous))
    return ActivityBlock(
        title = if (isToday) "Kroky dnes" else "Kroky · ${Format.formatDay(date)}",
        latest = latest,
        steps = Format.formatInt(steps),
        averageLine = if (above && percent != null) "↑ ${Format.formatInt(percent - 100)} % nad 30-dňovým priemerom"
            else "priemer 30 dní ${Format.formatInt(average)}",
        above = above,
        ringFraction = (share ?: 0.0).coerceIn(0.0, 1.0).toFloat(),
        ringText = percent?.let { "${Format.formatInt(it)} %" } ?: DASH,
        ringDescription = if (percent == null) "Kroky oproti 30-dňovému priemeru zatiaľ nemožno porovnať"
            else "Kroky: ${Format.formatInt(percent)} % 30-dňového priemeru",
        minis = listOf(
            Mini(
                label = "Aktívny čas",
                value = Format.approx(Format.formatDurationCompact(day?.activeMinutesEst)),
                note = "bežne ${Format.approx(Format.formatDurationCompact(usual(DayKey.ACTIVE_MINUTES_EST)))}",
                bars = week(DayKey.ACTIVE_MINUTES_EST),
                description = "Aktívny čas za posledných 7 dní",
            ),
            Mini(
                label = "Kalórie",
                value = DayValues.dayFigure(day, DayMetric.TOTAL_ENERGY, Format::formatInt),
                note = "aktívne ${DayValues.dayFigure(day, DayMetric.ACTIVE_ENERGY, Format::formatInt)}",
                bars = week(DayKey.TOTAL_KCAL),
                description = "Kalórie za posledných 7 dní",
            ),
            Mini(
                label = "Vzdialenosť",
                value = DayValues.dayFigure(day, DayMetric.DISTANCE, Format::formatDistance),
                note = "bežne ${DayValues.periodFigure(days, date, 30, DayMetric.DISTANCE, usual(DayKey.DISTANCE_M), Format::formatDistance)}",
                bars = week(DayKey.DISTANCE_M),
                description = "Vzdialenosť za posledných 7 dní",
            ),
        ),
        zoneTotal = Format.formatDuration(zoneSum),
        light = light,
        moderate = moderate,
        vigorous = vigorous,
        zoneLegend = listOf("ľahká ${Format.formatInt(light)}", "stredná ${Format.formatInt(moderate)}", "vysoká ${Format.formatInt(vigorous)}"),
        zoneDescription = if (zoneSum == null) "Zóny tepu: bez dát"
            else "Ľahká zóna ${Format.formatInt(light)} min, stredná ${Format.formatInt(moderate)} min, vysoká ${Format.formatInt(vigorous)} min",
    )
}

private fun heartBlock(days: List<Day>, day: Day?, shown: Day?, date: String, latest: String?): HeartBlock {
    val source = when (DayValues.dayValueSource(shown, DayMetric.RESTING_HR)) {
        ValueSource.MEASURED -> "z hodiniek"
        ValueSource.DERIVED -> "z minútových meraní"
        ValueSource.ESTIMATED -> "odhad"
        null -> null
    }
    val trend = Heart.restingTrend(days, date, 30)
    val change = trend.change?.let { jsRound(it) }
    val note = when {
        change == null -> "Na porovnanie s minulým mesiacom je zatiaľ málo dát."
        change == 0.0 -> "Rovnaký ako pred mesiacom"
        else -> "O ${Format.formatInt(kotlin.math.abs(change))} bpm ${if (change < 0) "nižší" else "vyšší"} než pred mesiacom"
    }
    val hrvValue = shown?.hrv?.value.finite()
    val hrvText = hrvValue?.let { "${Format.formatInt(it)} ms" }?.let {
        if (shown?.hrv?.source == ValueSource.ESTIMATED) Format.approx(it) else it
    } ?: DASH
    val kind = shown?.hrvKind
    val hrvBase = Metrics.average(
        days.filter { it.day >= Dates.addDays(date, -30) && it.day < date && it.hrvKind == kind }.map { it.hrv?.value },
    )
    val signal = day?.scores?.nightSignal
    val status = Heart.signalStatus(signal)
    val word = when (status.level) {
        "green" -> "v norme"
        "yellow" -> "vyšší než zvyčajne"
        "red" -> "zvýšený druhú noc"
        else -> "nedá sa porovnať"
    }
    return HeartBlock(
        latest = latest,
        resting = DayValues.dayFigure(shown, DayMetric.RESTING_HR, Format::formatInt),
        restingCaption = listOfNotNull("bpm pokojový", source).joinToString(" · "),
        series = Metrics.series(Metrics.windowEnding(days, date, 30), DayKey.RESTING_HR).map { it.value },
        seriesDescription = "Pokojový tep za 30 dní: ${note.lowercase()}",
        hrvLabel = when (kind) {
            "rmssd" -> "HRV · RMSSD"
            "sdnn" -> "HRV · SDNN"
            else -> "HRV"
        },
        hrv = hrvText,
        hrvNote = if (hrvBase != null) "priemer 30 dní ${Format.formatInt(hrvBase)} ms" else "na priemer je zatiaľ málo dní",
        night = Format.formatInt(signal?.nightHr.finite()),
        nightLevel = status.level,
        nightWord = word,
        nightNote = listOfNotNull(signal?.baseline.finite()?.let { "bežne ${Format.formatInt(it)}" }, word).joinToString(" · "),
    )
}

private fun loadBlock(day: Day?): LoadBlock {
    val load = day?.scores?.cardioLoad
    val ratio = load?.ratio.finite()
    val label = Scores.cardioStatusLabel(load?.status)
    return LoadBlock(
        status = capitalized(label),
        line = if (ratio == null) "potrebuje aspoň pár týždňov dát" else "7 dní oproti 28 dňom · ${Format.formatDecimal(ratio, 2)}",
        ratio = ratio,
        vo2max = Format.formatInt(day?.scores?.vo2max.finite()),
        description = if (ratio == null) "Pomer záťaže zatiaľ nie je" else "Pomer záťaže ${Format.formatDecimal(ratio, 2)}, $label",
    )
}

private fun workoutsBlock(tz: String, day: Day?, date: String, isToday: Boolean): WorkoutsBlock {
    val list = day?.workouts.orEmpty().sortedWith(compareBy({ it.start }, { it.id }))
    val seconds = Metrics.sum(list.map { it.durationS })
    val rows = list.map { workout ->
        val light = workout.zoneLightMin.finite()
        val moderate = workout.zoneModerateMin.finite()
        val vigorous = workout.zoneVigorousMin.finite()
        val hrAvg = workout.hrAvg.finite()
        WorkoutRow(
            id = workout.id,
            type = Format.workoutLabel(workout.type),
            duration = Format.formatDuration(workout.durationS?.div(60)),
            light = light,
            moderate = moderate,
            vigorous = vigorous,
            meta = listOfNotNull(
                Format.formatClock(workout.start, tz),
                workout.distanceM.finite()?.let { Format.formatDistance(it) },
                if (hrAvg == null) "bez tepu" else "${Format.formatInt(hrAvg)} / ${Format.formatInt(workout.hrMax.finite())} bpm",
                workout.strain.finite()?.let { "strain ${Scores.formatStrain(it)}" },
                workout.kcalEst.finite()?.let { Format.approx(Format.formatKcal(it)) },
            ),
            zoneDescription = "Intenzita: ľahká ${Format.formatInt(light)} min, stredná ${Format.formatInt(moderate)} min, " +
                "vysoká ${Format.formatInt(vigorous)} min",
        )
    }
    return WorkoutsBlock(
        title = if (isToday) "Tréningy dnes" else "Tréningy · ${Format.formatDay(date)}",
        summary = if (rows.isEmpty()) null else "${rows.size} · ${Format.formatDuration(seconds?.div(60))}",
        rows = rows,
        empty = if (isToday) "Dnes zatiaľ žiadny tréning." else "V tento deň žiadny tréning.",
    )
}
