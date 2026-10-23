package sk.zdravie.app.logic

import sk.zdravie.app.model.Day
import sk.zdravie.app.model.Selected
import sk.zdravie.app.model.ValueSource

enum class DayMetric { DISTANCE, ACTIVE_ENERGY, TOTAL_ENERGY, RESTING_HR }

/** Port of web/src/lib/day-values.ts. A null `Selected` means the field was absent (older response). */
object DayValues {
    private fun selected(day: Day, metric: DayMetric): Selected? = when (metric) {
        DayMetric.DISTANCE -> day.distance
        DayMetric.ACTIVE_ENERGY -> day.activeKcal
        DayMetric.TOTAL_ENERGY -> day.totalKcal
        DayMetric.RESTING_HR -> day.restingHr
    }

    private fun fallback(day: Day, metric: DayMetric): Double? = when (metric) {
        DayMetric.DISTANCE -> day.distanceMEst
        DayMetric.ACTIVE_ENERGY -> day.activityKcalEst
        DayMetric.TOTAL_ENERGY -> day.totalKcalEst
        DayMetric.RESTING_HR -> day.hrResting
    }

    /** Selected device values win. RHR also has a valid derived rolling-minute fallback. */
    fun dayValue(day: Day?, metric: DayMetric): Double? {
        if (day == null) return null
        val chosen = selected(day, metric)
        val value = if (metric == DayMetric.RESTING_HR) {
            chosen?.value ?: fallback(day, metric)
        } else if (chosen != null) {
            chosen.value
        } else {
            fallback(day, metric)
        }
        return value?.takeIf { it.isFinite() }
    }

    fun dayValueSource(day: Day?, metric: DayMetric): ValueSource? {
        if (day == null || dayValue(day, metric) == null) return null
        val chosen = selected(day, metric)
        if (chosen == null || (metric == DayMetric.RESTING_HR && chosen.value == null)) {
            return if (metric == DayMetric.RESTING_HR) ValueSource.DERIVED else ValueSource.ESTIMATED
        }
        return chosen.source
    }

    fun restingHrDescription(day: Day?): String = when (dayValueSource(day, DayMetric.RESTING_HR)) {
        ValueSource.MEASURED -> "Pokojový tep zo zariadenia."
        ValueSource.DERIVED -> "Pokojový tep je najnižší 30-minútový priemer dňa z minútových meraní."
        ValueSource.ESTIMATED -> "Odhad pokojového tepu."
        null -> "Pokojový tep pre tento deň chýba."
    }

    fun dayFigure(day: Day?, metric: DayMetric, format: (Double?) -> String): String {
        val text = format(dayValue(day, metric))
        return if (dayValueSource(day, metric) == ValueSource.ESTIMATED) Format.approx(text) else text
    }

    fun periodHasEstimate(days: List<Day>, metric: DayMetric): Boolean =
        days.any { dayValueSource(it, metric) == ValueSource.ESTIMATED }

    fun periodFigure(
        days: List<Day>, end: String, length: Int, metric: DayMetric,
        value: Double?, format: (Double?) -> String,
    ): String {
        val from = Dates.addDays(end, -(length - 1))
        val used = days.filter {
            (metric == DayMetric.RESTING_HR || it.complete) && it.day >= from && it.day <= end
        }
        val text = format(value)
        return if (periodHasEstimate(used, metric)) Format.approx(text) else text
    }
}
