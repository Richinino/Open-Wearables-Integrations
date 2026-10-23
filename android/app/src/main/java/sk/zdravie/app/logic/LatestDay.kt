package sk.zdravie.app.logic

import sk.zdravie.app.model.Day
import sk.zdravie.app.model.ValueSource

/**
 * Port of web/src/lib/latest-day.ts: which day the "today" tiles show. An empty shell of today
 * (no steps, no sleep) falls back to the latest earlier day that has data.
 */
data class LatestDay(
    /** The day the tiles show; null when nothing up to `focus` has data. */
    val day: Day?,
    /** Its date; `focus` when there is no day to show. */
    val date: String,
    /** True when the tiles show an older day than `focus`. */
    val fallback: Boolean,
    /** "posledné dáta: včera" when falling back, else null. */
    val label: String?,
)

// Named LatestDays because the data class already takes the name LatestDay.
object LatestDays {
    private fun isPositive(value: Double?): Boolean = value != null && value.isFinite() && value > 0

    /** A device RHR is a real observation too; a carried rolling fallback alone is not. */
    fun hasDayData(day: Day?): Boolean {
        if (day == null) return false
        return isPositive(day.steps) || isPositive(day.sleepMinutes) || day.workouts.isNotEmpty() ||
            (DayValues.dayValueSource(day, DayMetric.RESTING_HR) == ValueSource.MEASURED &&
                isPositive(DayValues.dayValue(day, DayMetric.RESTING_HR)))
    }

    /** How old the shown day is: "dnes", "včera", "predvčerom" or "po 12. 10.". */
    fun ageLabel(date: String, today: String): String = when (Dates.diffDays(date, today)) {
        0 -> "dnes"
        1 -> "včera"
        2 -> "predvčerom"
        else -> Format.formatDay(date)
    }

    fun latestDay(days: List<Day>, focus: String, today: String): LatestDay {
        var own: Day? = null
        for (index in days.indices.reversed()) {
            val day = days[index]
            if (day.day > focus) continue
            if (day.day == focus) {
                own = day
                if (hasDayData(day)) return LatestDay(day, focus, false, null)
                continue
            }
            if (hasDayData(day)) {
                return LatestDay(day, day.day, true, "posledné dáta: ${ageLabel(day.day, today)}")
            }
        }
        return LatestDay(own, focus, false, null)
    }
}
