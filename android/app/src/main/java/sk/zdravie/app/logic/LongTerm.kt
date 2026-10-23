package sk.zdravie.app.logic

import kotlin.math.abs
import kotlin.math.floor
import sk.zdravie.app.model.Day
import sk.zdravie.app.model.Score
import sk.zdravie.app.model.Workout

data class WeekValue(
    /** Monday of the week. */
    val week: String,
    val value: Double?,
)

data class Vo2Week(val week: String, val watch: Double?, val uth: Double?)

data class LatestValue(val value: Double, val day: String)

data class AgeContribution(
    val key: String,
    val label: String,
    /** The metric's own impact in years, before the overlap factor. */
    val raw: Double,
    /** Its share of the difference between body age and age: raw x factor. */
    val years: Double,
    /** Part of all impacts, by size, 0..1. */
    val share: Double,
)

data class BodyAge(
    val value: Double?,
    /** Calendar age, read back from the score: value - factor x sum of impacts. */
    val realAge: Double?,
    /** Body age minus age; negative is younger. */
    val difference: Double?,
    /** The overlap factor the score was built with. */
    val factor: Double,
    /** Most "younger" first, most "older" last. */
    val contributions: List<AgeContribution>,
    /** Metrics without data, by name. */
    val missing: List<String>,
    /** owi's note in Slovak, e.g. "odhad". */
    val note: String?,
)

/**
 * [key] is one of "steps", "sleep", "resting", "workout", "dayScore" (the overview's five),
 * "strain", "workoutStrain", "distance", "active", "vo2max"; [type] is the workout type.
 */
data class LongRecord(val key: String, val value: Double, val day: String, val type: String? = null)

/**
 * Port of web/src/lib/detail-longterm.ts: VO2max from the watch against the Uth-Sorensen estimate,
 * WHOOP-style body age and what moves it, weekly series and records. Null and absent days mean
 * "no data" and are never counted as zero.
 */
object LongTerm {
    private fun isNumber(value: Double?): Boolean = value != null && value.isFinite()

    /** JS Math.round: halves round toward positive infinity. */
    private fun jsRound(value: Double): Double = floor(value + 0.5)

    // -----------------------------------------------------------------------------------
    // Weekly series

    /**
     * Mean of [pick] per week for the [weeks] weeks ending with the week of [end], oldest first.
     * Leading weeks without any value are dropped, so a short history fills the chart.
     */
    fun weeklyMeans(days: List<Day>, end: String, weeks: Int = 52, pick: (Day) -> Double?): List<WeekValue> {
        val byDay = Metrics.indexByDay(days)
        val lastWeek = Dates.addDays(end, -Dates.weekdayIndex(end))
        val series = ArrayList<WeekValue>()
        for (index in weeks - 1 downTo 0) {
            val week = Dates.addDays(lastWeek, -7 * index)
            val values = List(7) { offset ->
                val day = Dates.addDays(week, offset)
                val data = if (day <= end) byDay[day] else null
                if (data != null) pick(data) else null
            }
            series.add(WeekValue(week, Metrics.average(values)))
        }
        val first = series.indexOfFirst { it.value != null }
        return if (first < 0) emptyList() else series.drop(first)
    }

    /** VO2max per week: the watch's own value and the Uth-Sorensen estimate side by side. */
    fun vo2maxWeeks(days: List<Day>, end: String, weeks: Int = 52): List<Vo2Week> {
        val watch = weeklyMeans(days, end, weeks) { it.scores?.vo2max }
        val uth = weeklyMeans(days, end, weeks) { it.scores?.vo2maxUth }
        val starts = listOfNotNull(watch.firstOrNull()?.week, uth.firstOrNull()?.week).sorted()
        if (starts.isEmpty()) return emptyList()
        val first = starts[0]
        fun valueAt(series: List<WeekValue>, week: String): Double? = series.find { it.week == week }?.value
        val count = Dates.diffDays(first, Dates.addDays(end, -Dates.weekdayIndex(end))) / 7 + 1
        return List(count) { index ->
            val week = Dates.addDays(first, index * 7)
            Vo2Week(week, valueAt(watch, week), valueAt(uth, week))
        }
    }

    /** The latest value of [pick] on or before [end], with its day. */
    fun latestValue(days: List<Day>, end: String, pick: (Day) -> Double?): LatestValue? {
        for (index in days.indices.reversed()) {
            val day = days[index]
            if (day.day > end) continue
            val value = pick(day)
            if (value != null && value.isFinite()) return LatestValue(value, day.day)
        }
        return null
    }

    /** Mean of the last [span] values minus the mean of the first [span]; null without both. */
    fun seriesChange(values: List<Double?>, span: Int = 4): Double? {
        if (values.size < span * 2) return null
        val head = Metrics.average(values.take(span))
        val tail = Metrics.average(values.takeLast(span))
        return if (head == null || tail == null) null else tail - head
    }

    // -----------------------------------------------------------------------------------
    // VO2max

    /**
     * Words for a VO2max of a 17-year-old male: about 45-50 is typical, above 55 excellent.
     * The bands move with age and sex; these follow the person the app is built for.
     */
    fun vo2maxLevel(value: Double?): String? {
        if (value == null || !value.isFinite()) return null
        if (value >= 55) return "výborná kondícia"
        if (value > 50) return "nad bežnou hodnotou"
        if (value >= 45) return "bežná hodnota"
        return "pod bežnou hodnotou"
    }

    // -----------------------------------------------------------------------------------
    // Body age (WHOOP Age)

    /** owi scales the sum of the metric impacts by this to allow for their overlap. */
    const val OVERLAP_FACTOR = 0.45

    private data class AgeRead(val age: Double, val factor: Double)

    /**
     * The calendar age behind a body age. owi adds OVERLAP_FACTOR x sum of impacts to the age, so
     * the age is what is left. Data built without the factor gives a whole number only with
     * factor 1, which is tried second.
     */
    private fun readAge(value: Double, sum: Double): AgeRead? {
        for (factor in listOf(OVERLAP_FACTOR, 1.0)) {
            val age = value - factor * sum
            if (abs(age - jsRound(age)) <= 0.11 && age > 0) return AgeRead(jsRound(age), factor)
        }
        return null
    }

    fun bodyAge(score: Score?): BodyAge? {
        if (score == null) return null
        val entries = score.components.entries.toList()
        val present = entries.filter { isNumber(it.value) }.map { it.key to it.value!! }
        val missing = entries.filter { !isNumber(it.value) }.map { Scores.componentLabel(it.key) }
        val scoreValue = score.value?.takeIf { it.isFinite() }
        if (scoreValue == null && present.isEmpty()) {
            return BodyAge(null, null, null, OVERLAP_FACTOR, emptyList(), missing, Scores.noteText(score.note))
        }
        val sum = present.fold(0.0) { total, (_, value) -> total + value }
        val read = if (scoreValue != null) readAge(scoreValue, sum) else null
        val factor = read?.factor ?: OVERLAP_FACTOR
        val magnitude = present.fold(0.0) { total, (_, value) -> total + abs(value) }
        val contributions = present
            .map { (key, raw) ->
                AgeContribution(
                    key = key,
                    label = Scores.componentLabel(key),
                    raw = raw,
                    years = raw * factor,
                    share = if (magnitude > 0) abs(raw) / magnitude else 0.0,
                )
            }
            .sortedWith { a, b ->
                val diff = a.raw - b.raw
                if (diff < 0) -1 else if (diff > 0) 1 else if (a.key < b.key) -1 else 1
            }
        return BodyAge(
            value = scoreValue,
            realAge = read?.age,
            difference = if (scoreValue != null && read != null) scoreValue - read.age else null,
            factor = factor,
            contributions = contributions,
            missing = missing,
            note = Scores.noteText(score.note),
        )
    }

    // -----------------------------------------------------------------------------------
    // Records

    /**
     * Bests of the [length] days ending at [end]: the overview's five (steps, sleep, resting heart
     * rate, longest workout, day score) and the highest day strain, workout strain, workout
     * distance, active time and VO2max. Unfinished days do not compete on running totals; on a
     * tie the earlier day keeps the record.
     */
    fun longRecords(days: List<Day>, end: String, length: Int = 90): List<LongRecord> {
        val from = Dates.addDays(end, -(length - 1))
        val inWindow = days.filter { it.day >= from && it.day <= end }
        val complete = inWindow.filter { it.complete }
        fun highest(key: String, candidates: List<Day>, pick: (Day) -> Double?): LongRecord? {
            var found: LongRecord? = null
            for (day in candidates) {
                val value = pick(day)
                val current = found
                if (value != null && value.isFinite() && (current == null || value > current.value)) {
                    found = LongRecord(key, value, day.day)
                }
            }
            return found
        }
        fun bestWorkout(key: String, pick: (Workout) -> Double?): LongRecord? {
            var found: LongRecord? = null
            for (day in inWindow) {
                for (workout in day.workouts) {
                    val value = pick(workout)
                    val current = found
                    if (value != null && value.isFinite() && (current == null || value > current.value)) {
                        found = LongRecord(key, value, workout.day, workout.type)
                    }
                }
            }
            return found
        }
        return Overview.records(days, end, length).map { LongRecord(it.key, it.value, it.day, it.type) } +
            listOfNotNull(
                highest("strain", complete) { it.scores?.strain },
                bestWorkout("workoutStrain") { it.strain },
                bestWorkout("distance") { it.distanceM },
                highest("active", complete) { it.activeMinutesEst },
                highest("vo2max", inWindow) { it.scores?.vo2max },
            )
    }
}
