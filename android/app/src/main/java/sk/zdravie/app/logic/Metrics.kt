package sk.zdravie.app.logic

import java.time.Instant
import kotlin.math.floor
import sk.zdravie.app.model.Day
import sk.zdravie.app.model.Workout

/** Numeric day fields; mirrors NumericDayKey in web/src/lib/metrics.ts. */
enum class DayKey {
    STEPS, DISTANCE_M_EST, DISTANCE_M, ACTIVE_KCAL, TOTAL_KCAL, RESTING_HR, ACTIVE_MINUTES_EST,
    ACTIVITY_KCAL_EST, BASAL_KCAL, TOTAL_KCAL_EST, HR_RESTING, HR_AVG, HR_MAX, HR_MIN,
    ZONE_LIGHT_MIN, ZONE_MODERATE_MIN, ZONE_VIGOROUS_MIN, SLEEP_MINUTES, SLEEP_DEEP_MIN,
    SLEEP_REM_MIN, SLEEP_LIGHT_MIN, SLEEP_AWAKE_MIN, NAP_MINUTES;

    /** The raw value of this key for a day; the selected-value keys go through DayValues. */
    fun read(day: Day): Double? = when (this) {
        STEPS -> day.steps
        DISTANCE_M_EST -> day.distanceMEst
        DISTANCE_M -> DayValues.dayValue(day, DayMetric.DISTANCE)
        ACTIVE_KCAL -> DayValues.dayValue(day, DayMetric.ACTIVE_ENERGY)
        TOTAL_KCAL -> DayValues.dayValue(day, DayMetric.TOTAL_ENERGY)
        RESTING_HR -> DayValues.dayValue(day, DayMetric.RESTING_HR)
        ACTIVE_MINUTES_EST -> day.activeMinutesEst
        ACTIVITY_KCAL_EST -> day.activityKcalEst
        BASAL_KCAL -> day.basalKcal
        TOTAL_KCAL_EST -> day.totalKcalEst
        HR_RESTING -> day.hrResting
        HR_AVG -> day.hrAvg
        HR_MAX -> day.hrMax
        HR_MIN -> day.hrMin
        ZONE_LIGHT_MIN -> day.zoneLightMin
        ZONE_MODERATE_MIN -> day.zoneModerateMin
        ZONE_VIGOROUS_MIN -> day.zoneVigorousMin
        SLEEP_MINUTES -> day.sleepMinutes
        SLEEP_DEEP_MIN -> day.sleepDeepMin
        SLEEP_REM_MIN -> day.sleepRemMin
        SLEEP_LIGHT_MIN -> day.sleepLightMin
        SLEEP_AWAKE_MIN -> day.sleepAwakeMin
        NAP_MINUTES -> day.napMinutes
    }
}

data class DaySlot(val day: String, val data: Day?)
data class Point(val day: String, val value: Double?)
data class PeriodSummary(
    val average: Double?, val total: Double?, val count: Int, val previousAverage: Double?, val change: Double?,
)
data class TypeTotal(val type: String, val count: Int, val seconds: Double)
data class WorkoutTotals(
    val count: Int, val seconds: Double, val distanceM: Double?, val kcal: Double?, val byType: List<TypeTotal>,
)
data class SleepNight(
    val day: String, val start: Instant, val end: Instant, val minutes: Double?, val deep: Double?,
    val rem: Double?, val light: Double?, val awake: Double?, val nap: Double?,
    val bedMinutes: Double, val wakeMinutes: Double,
)

/**
 * Port of web/src/lib/metrics.ts. Null and absent days all mean "no data" and are never counted as zero.
 *
 * Sleep clock convention: clock times are minutes counted from local NOON, so an evening bedtime
 * and one just after midnight sit next to each other. wakeMinutes is elapsed time.
 */
object Metrics {
    private const val MINUTES_PER_DAY = 1440
    private const val NOON_MINUTES = 720

    private fun present(values: List<Double?>): List<Double> = values.filterNotNull().filter { it.isFinite() }

    fun indexByDay(days: List<Day>): Map<String, Day> = days.associateBy { it.day }

    fun windowEnding(days: List<Day>, end: String, length: Int): List<DaySlot> {
        val byDay = indexByDay(days)
        val slots = ArrayList<DaySlot>()
        for (offset in length - 1 downTo 0) {
            val day = Dates.addDays(end, -offset)
            slots.add(DaySlot(day, byDay[day]))
        }
        return slots
    }

    fun series(slots: List<DaySlot>, key: DayKey, includeIncomplete: Boolean = true): List<Point> =
        slots.map { (day, data) ->
            if (data == null || (!includeIncomplete && !data.complete)) {
                Point(day, null)
            } else {
                Point(day, key.read(data)?.takeIf { it.isFinite() })
            }
        }

    fun sum(values: List<Double?>): Double? {
        val numbers = present(values)
        return if (numbers.isEmpty()) null else numbers.fold(0.0) { total, v -> total + v }
    }

    fun average(values: List<Double?>): Double? {
        val numbers = present(values)
        return if (numbers.isEmpty()) null else numbers.fold(0.0) { total, v -> total + v } / numbers.size
    }

    fun min(values: List<Double?>): Double? = present(values).reduceOrNull { low, v -> if (v < low) v else low }

    fun max(values: List<Double?>): Double? = present(values).reduceOrNull { high, v -> if (v > high) v else high }

    fun periodSummary(
        days: List<Day>, end: String, length: Int, key: DayKey, includeIncomplete: Boolean = false,
    ): PeriodSummary {
        fun valuesEnding(lastDay: String): List<Double?> =
            series(windowEnding(days, lastDay, length), key, includeIncomplete).map { it.value }

        val current = valuesEnding(end)
        val currentAverage = average(current)
        val previousAverage = average(valuesEnding(Dates.addDays(end, -length)))
        val comparable = currentAverage != null && previousAverage != null && previousAverage != 0.0
        return PeriodSummary(
            average = currentAverage,
            total = sum(current),
            count = present(current).size,
            previousAverage = previousAverage,
            change = if (comparable) (currentAverage!! - previousAverage!!) / previousAverage else null,
        )
    }

    /** Every workout, newest first; ties by id ascending. */
    fun allWorkouts(days: List<Day>): List<Workout> =
        days.flatMap { it.workouts }.sortedWith(
            compareByDescending<Workout> { it.start }.thenBy { it.id },
        )

    fun workoutTotals(workouts: List<Workout>): WorkoutTotals {
        val byType = LinkedHashMap<String, Pair<Int, Double>>()
        var seconds = 0.0
        for (workout in workouts) {
            val duration = workout.durationS?.takeIf { it.isFinite() } ?: 0.0
            seconds += duration
            val (count, secs) = byType[workout.type] ?: (0 to 0.0)
            byType[workout.type] = (count + 1) to (secs + duration)
        }
        return WorkoutTotals(
            count = workouts.size,
            seconds = seconds,
            distanceM = sum(workouts.map { it.distanceM }),
            kcal = sum(workouts.map { it.kcalEst }),
            byType = byType.map { (type, v) -> TypeTotal(type, v.first, v.second) }
                .sortedWith(compareByDescending<TypeTotal> { it.count }.thenBy { it.type }),
        )
    }

    /** Nights that have both a start and an end, oldest first. */
    fun sleepNights(days: List<Day>, timeZone: String): List<SleepNight> {
        val nights = ArrayList<SleepNight>()
        for (day in days) {
            val start = day.sleepStart ?: continue
            val end = day.sleepEnd ?: continue
            val bedMinutes =
                ((Dates.localMinutesOfDay(start, timeZone) - NOON_MINUTES + MINUTES_PER_DAY) % MINUTES_PER_DAY).toDouble()
            val elapsed = floor((end.toEpochMilli() - start.toEpochMilli()) / 60_000.0 + 0.5)
            nights.add(
                SleepNight(
                    day = day.day, start = start, end = end, minutes = day.sleepMinutes, deep = day.sleepDeepMin,
                    rem = day.sleepRemMin, light = day.sleepLightMin, awake = day.sleepAwakeMin, nap = day.napMinutes,
                    bedMinutes = bedMinutes, wakeMinutes = bedMinutes + elapsed,
                ),
            )
        }
        return nights.sortedBy { it.day }
    }

    /** Mean of clock values in the minutes-from-noon convention; null for no values. */
    fun averageClock(minutesFromNoon: List<Double>): Double? = average(minutesFromNoon)

    fun isStale(syncedAt: Instant?, now: Instant, thresholdMinutes: Int = 90): Boolean {
        if (syncedAt == null) return true
        return now.toEpochMilli() - syncedAt.toEpochMilli() > thresholdMinutes * 60_000L
    }
}
