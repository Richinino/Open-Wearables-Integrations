package sk.zdravie.app.logic

import sk.zdravie.app.model.Day

data class ActivityPart(val key: String, val max: Int, val weight: Double, val explain: String)

/** [key] is "light", "moderate", "high" or "max". */
data class StrainBand(val key: String, val from: Double, val to: Double, val label: String)

/** Ratio range, [from] inclusive; [to] is exclusive except for the last band. */
data class CardioBand(val status: String, val from: Double, val to: Double, val text: String)

data class CardioPoint(
    val day: String,
    val ratio: Double?,
    val strain7: Double?,
    val tolerance28: Double?,
    val status: String?,
)

/** [days] counts the days of the window that had zone data. */
data class ZoneTotals(val light: Double, val moderate: Double, val vigorous: Double, val days: Int)

data class StepsCategory(val from: Double, val label: String)

/** [days] counts finished days with steps. */
data class StepsStats(
    val average: Double?,
    val days: Int,
    val total: Double?,
    val distance: Double?,
    val distanceAverage: Double?,
)

/** [weekday] 0 = Monday. */
data class WeekdaySteps(val weekday: Int, val average: Double?, val days: Int)

data class BestDay(val day: String, val steps: Double, val distance: Double?)

/**
 * Port of web/src/lib/detail-activity.ts: the calculations behind the activity and steps detail
 * pages. Null and absent days mean "no data"; running totals of an unfinished day are left out of
 * averages and records.
 */
object Activity {
    /** Oura Activity as owi computes it, heaviest first. */
    val ACTIVITY_PARTS: List<ActivityPart> = listOf(
        ActivityPart("meet_daily_targets", 100, 0.25, "v koľkých z posledných 7 dní si splnil denný cieľ pohybu; ideál 6–7"),
        ActivityPart("stay_active", 100, 0.2, "koľko bdelých hodín prešlo bez pohybu; do 5–8 h je to v poriadku"),
        ActivityPart("training_volume", 100, 0.15, "objem strednej a vysokej intenzity za 7 dní; cieľ okolo 2 000 MET-minút"),
        ActivityPart("training_frequency", 100, 0.15, "koľko dní z 7 malo poriadny tréning; ideál 3–4"),
        ActivityPart("recovery_time", 100, 0.15, "či mal týždeň aj 1–2 ľahšie dni na oddych"),
        ActivityPart("move_every_hour", 100, 0.1, "či si sa hýbal aspoň raz za hodinu; uberá každé sedenie dlhšie ako 50 min"),
    )

    /** WHOOP strain bands on the 0-21 scale. */
    val STRAIN_BANDS: List<StrainBand> = listOf(
        StrainBand("light", 0.0, 10.0, "ľahká"),
        StrainBand("moderate", 10.0, 14.0, "stredná"),
        StrainBand("high", 14.0, 18.0, "vysoká"),
        StrainBand("max", 18.0, 21.0, "maximálna"),
    )

    const val STRAIN_MAX = 21

    /** Polar's ratio bands. "Recovering" shares the lowest range after an overreaching spell. */
    val CARDIO_BANDS: List<CardioBand> = listOf(
        CardioBand("detraining", 0.0, 0.8, "posledný týždeň je záťaž citeľne nižšia, než na akú si zvyknutý"),
        CardioBand("maintaining", 0.8, 1.0, "trénuješ asi ako zvyčajne alebo o niečo menej; forma sa drží"),
        CardioBand("productive", 1.0, 1.3, "záťaž mierne nad tvojím zvykom; takto sa forma zlepšuje"),
        CardioBand("overreaching", 1.3, Double.POSITIVE_INFINITY, "záťaž výrazne nad tvojím zvykom; dlhšie to zvyšuje únavu a riziko zranenia"),
    )

    const val RECOVERING_TEXT = "po náročnom období záťaž klesla a telo sa zotavuje"

    /** Thresholds between the bands, for guide lines. */
    val CARDIO_THRESHOLDS: List<Double> = listOf(0.8, 1.0, 1.3)

    fun cardioText(status: String?): String? {
        if (status == "recovering") return RECOVERING_TEXT
        return CARDIO_BANDS.firstOrNull { it.status == status }?.text
    }

    private fun finite(value: Double?): Double? = value?.takeIf { it.isFinite() }

    /** The cardio load of every day of the window ending at [end], oldest first. */
    fun cardioTrend(days: List<Day>, end: String, length: Int = 84): List<CardioPoint> {
        val byDay = Metrics.indexByDay(days)
        return Dates.dateRange(Dates.addDays(end, -(length - 1)), end).map { date ->
            val load = byDay[date]?.scores?.cardioLoad
            CardioPoint(
                day = date,
                ratio = finite(load?.ratio),
                strain7 = finite(load?.strain7d),
                tolerance28 = finite(load?.tolerance28d),
                status = load?.status,
            )
        }
    }

    /** The last value of each whole week in the trend, newest first: the table twin of the chart. */
    fun cardioWeeks(points: List<CardioPoint>): List<CardioPoint> {
        val weeks = ArrayList<CardioPoint>()
        var index = points.size - 1
        while (index >= 0) {
            val week = points.subList(maxOf(0, index - 6), index + 1).reversed()
            val last = week.firstOrNull { it.ratio != null }
            if (last != null) weeks.add(last)
            index -= 7
        }
        return weeks
    }

    /** Minutes in each zone over the [length] days ending at [end]; null with no zone data. */
    fun zoneTotals(days: List<Day>, end: String, length: Int): ZoneTotals? {
        val from = Dates.addDays(end, -(length - 1))
        val window = days.filter {
            it.day >= from && it.day <= end &&
                (finite(it.zoneLightMin) != null || finite(it.zoneModerateMin) != null || finite(it.zoneVigorousMin) != null)
        }
        if (window.isEmpty()) return null
        return ZoneTotals(
            light = Metrics.sum(window.map { it.zoneLightMin }) ?: 0.0,
            moderate = Metrics.sum(window.map { it.zoneModerateMin }) ?: 0.0,
            vigorous = Metrics.sum(window.map { it.zoneVigorousMin }) ?: 0.0,
            days = window.size,
        )
    }

    /** Tudor-Locke's daily step categories. */
    val STEPS_CATEGORIES: List<StepsCategory> = listOf(
        StepsCategory(12_500.0, "veľmi aktívny"),
        StepsCategory(10_000.0, "aktívny"),
        StepsCategory(7_500.0, "čiastočne aktívny"),
        StepsCategory(5_000.0, "málo aktívny"),
        StepsCategory(0.0, "sedavý"),
    )

    fun stepsCategory(steps: Double?): StepsCategory? {
        if (finite(steps) == null) return null
        return STEPS_CATEGORIES.firstOrNull { steps!! >= it.from } ?: STEPS_CATEGORIES.last()
    }

    /** Steps of a finished day; an unfinished day's running total and missing steps give null. */
    fun finishedSteps(day: Day?): Double? {
        if (day == null || !day.complete) return null
        return finite(day.steps)
    }

    /** Averages of the finished days in the [length] days ending at [end]. */
    fun stepsStats(days: List<Day>, end: String, length: Int): StepsStats {
        val from = Dates.addDays(end, -(length - 1))
        val finished = days.filter { it.day >= from && it.day <= end && finishedSteps(it) != null }
        val distances = days
            .filter { it.day >= from && it.day <= end && it.complete }
            .map { DayValues.dayValue(it, DayMetric.DISTANCE) }
        return StepsStats(
            average = Metrics.average(finished.map { finishedSteps(it) }),
            days = finished.size,
            total = Metrics.sum(finished.map { finishedSteps(it) }),
            distance = Metrics.sum(distances),
            distanceAverage = Metrics.average(distances),
        )
    }

    /** Mean steps per weekday over the finished days of the window. */
    fun weekdaySteps(days: List<Day>, end: String, length: Int = 90): List<WeekdaySteps> {
        val from = Dates.addDays(end, -(length - 1))
        val finished = days.filter { it.day >= from && it.day <= end && finishedSteps(it) != null }
        return (0 until 7).map { weekday ->
            val values = finished.filter { Dates.weekdayIndex(it.day) == weekday }.map { finishedSteps(it) }
            WeekdaySteps(weekday, Metrics.average(values), values.size)
        }
    }

    /** The finished days with the most steps, best first; on a tie the earlier day comes first. */
    fun bestStepDays(days: List<Day>, end: String, length: Int = 90, count: Int = 5): List<BestDay> {
        val from = Dates.addDays(end, -(length - 1))
        return days
            .filter { it.day >= from && it.day <= end && finishedSteps(it) != null }
            .map { BestDay(it.day, finishedSteps(it)!!, DayValues.dayValue(it, DayMetric.DISTANCE)) }
            .sortedWith(compareByDescending<BestDay> { it.steps }.thenBy { it.day })
            .take(count)
    }

    /** Weekend days against working days, as a share: 0.2 = the weekend has 20 % more. */
    fun weekendShare(pattern: List<WeekdaySteps>): Double? {
        val weekend = Metrics.average(pattern.filter { it.weekday >= 5 }.map { it.average })
        val weekday = Metrics.average(pattern.filter { it.weekday < 5 }.map { it.average })
        if (weekend == null || weekday == null || weekday <= 0) return null
        return weekend / weekday - 1
    }
}
