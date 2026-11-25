package sk.zdravie.app.logic

import sk.zdravie.app.model.Day

/** The metrics the Trendy screen can show, in chip order. */
enum class TrendMetric(val label: String) {
    STEPS("Kroky"),
    SLEEP("Spánok"),
    DAY_SCORE("Skóre dňa"),
    READINESS("Pripravenosť"),
    STRAIN("Strain"),
    RESTING_HR("Pokojový tep"),
    HRV("HRV"),
    ACTIVE("Aktívny čas"),
    KCAL("Kalórie"),
    VO2MAX("VO2max"),
}

/**
 * Values of one metric over a range. [values] are daily (null = missing day, a gap in the chart),
 * or weekly means for a year. [covered] counts present values of [total].
 */
data class TrendSeries(
    val values: List<Double?>,
    val labels: List<String>,
    val average: Double?,
    val previousAverage: Double?,
    val best: Double?,
    val worst: Double?,
    val covered: Int,
    val total: Int,
)

object Trends {
    /** A lower value is the better one (resting heart rate); everything else: higher is better. */
    fun lowerIsBetter(metric: TrendMetric): Boolean = metric == TrendMetric.RESTING_HR

    fun value(day: Day?, metric: TrendMetric): Double? {
        if (day == null) return null
        val raw = when (metric) {
            TrendMetric.STEPS -> day.steps
            TrendMetric.SLEEP -> day.sleepMinutes
            TrendMetric.DAY_SCORE -> day.scores?.dayScore
            TrendMetric.READINESS -> day.scores?.readiness?.value
            TrendMetric.STRAIN -> day.scores?.strain
            TrendMetric.RESTING_HR -> DayValues.dayValue(day, DayMetric.RESTING_HR)
            TrendMetric.HRV -> day.hrv?.value
            TrendMetric.ACTIVE -> day.activeMinutesEst
            TrendMetric.KCAL -> DayValues.dayValue(day, DayMetric.TOTAL_ENERGY)
            TrendMetric.VO2MAX -> day.scores?.vo2max
        }
        return raw?.takeIf { it.isFinite() }
    }

    /**
     * [range] is 7, 30, 90 or 365 days ending at [end]. A year is shown as 52 weekly means (as the
     * web's long-term view does); shorter ranges day by day. The previous average covers the same
     * length right before the range.
     */
    fun trendValues(days: List<Day>, end: String, metric: TrendMetric, range: Int): TrendSeries {
        val byDay = Metrics.indexByDay(days)
        val (values, labels) = if (range >= 365) {
            val weeks = LongTerm.weeklyMeans(days, end, 52) { value(it, metric) }
            weeks.map { it.value } to weeks.map { it.week }
        } else {
            val range0 = Dates.dateRange(Dates.addDays(end, -(range - 1)), end)
            range0.map { value(byDay[it], metric) } to range0
        }
        val previous = if (range >= 365) {
            val prevEnd = Dates.addDays(end, -364)
            LongTerm.weeklyMeans(days, prevEnd, 52) { value(it, metric) }.map { it.value }
        } else {
            val prevEnd = Dates.addDays(end, -range)
            Dates.dateRange(Dates.addDays(prevEnd, -(range - 1)), prevEnd).map { value(byDay[it], metric) }
        }
        val present = values.filterNotNull()
        val lowBetter = lowerIsBetter(metric)
        return TrendSeries(
            values = values,
            labels = labels,
            average = Metrics.average(values),
            previousAverage = Metrics.average(previous),
            best = if (lowBetter) present.minOrNull() else present.maxOrNull(),
            worst = if (lowBetter) present.maxOrNull() else present.minOrNull(),
            covered = present.size,
            total = values.size,
        )
    }

    fun format(metric: TrendMetric, value: Double?): String = when (metric) {
        TrendMetric.SLEEP, TrendMetric.ACTIVE -> Format.formatDuration(value)
        TrendMetric.STRAIN -> Scores.formatStrain(value)
        TrendMetric.RESTING_HR -> Format.formatBpm(value)
        TrendMetric.HRV -> if (value == null) Format.DASH else "${Format.formatInt(value)} ms"
        TrendMetric.KCAL -> Format.formatKcal(value)
        TrendMetric.VO2MAX -> Format.formatDecimal(value)
        else -> Format.formatInt(value)
    }
}
