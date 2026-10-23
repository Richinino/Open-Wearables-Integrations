package sk.zdravie.app.logic

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sqrt
import sk.zdravie.app.model.Day
import sk.zdravie.app.model.SleepStage

enum class HeatMetric { STEPS, SLEEP, ACTIVE, RESTING }

data class HeatMetricInfo(val id: HeatMetric, val label: String)

/** [level]: 0 = no data; 1-4 are the quartiles of the window's own values, low to high. */
data class HeatCell(
    val day: String,
    val value: Double?,
    val level: Int,
    /** After `end`: drawn as an empty slot so the columns stay whole weeks. */
    val future: Boolean,
    /** An unfinished day whose running total is left out; not the same as missing data. */
    val running: Boolean,
)

data class Heatmap(
    val metric: HeatMetric,
    /** Column-major: week by week, Monday to Sunday. */
    val cells: List<HeatCell>,
    val weeks: Int,
    val first: String,
    val last: String,
    val average: Double?,
    /** Upper bounds of levels 1-3. */
    val thresholds: Triple<Double, Double, Double>?,
)

/** [key] is "steps", "sleep", "resting", "workout" or "dayScore"; [type] is the workout type. */
data class RecordItem(val key: String, val value: Double, val day: String, val type: String? = null)

data class WeekWorkout(val type: String, val minutes: Double)

data class WeekCard(
    val day: String,
    val data: Day?,
    val steps: Double?,
    /** Steps against the 30-day daily average, 0..1, for the small ring. */
    val stepsShare: Double?,
    val sleepMinutes: Double?,
    val dayScore: Double?,
    val workout: WeekWorkout?,
)

data class StageSegment(val stage: SleepStage, val minutes: Double)

/** Minutes since local midnight; [spread] is the standard deviation of the bedtime, minutes. */
data class SleepWindow(val bedtime: Double, val wake: Double, val spread: Double, val nights: Int)

data class InsightBar(val label: String, val value: Double?, val highlight: Boolean)

/** [key]: "weekendSteps", "shortNight" or "restingTrend"; [tone]: "accent", "sleep" or "heart". */
data class Insight(
    val key: String,
    val text: String,
    val detail: String,
    val bars: List<InsightBar>,
    val tone: String,
    val href: String,
)

data class BarRange(val low: Double?, val high: Double?)

/**
 * Port of web/src/lib/overview.ts: the 12-week heatmap, records, the week in short, the sleep stage
 * strip and the "čo si všimnúť" observations. Null and absent days mean "no data", never zero.
 */
object Overview {
    /** Plural, for "najviac bývajú soboty". */
    private val WEEKDAYS_PLURAL = listOf("pondelky", "utorky", "stredy", "štvrtky", "piatky", "soboty", "nedele")

    /** The night that starts on weekday i: "v noci z piatka na sobotu". */
    private val NIGHTS = listOf(
        "z pondelka na utorok",
        "z utorka na stredu",
        "zo stredy na štvrtok",
        "zo štvrtka na piatok",
        "z piatka na sobotu",
        "zo soboty na nedeľu",
        "z nedele na pondelok",
    )
    val WEEKDAY_LETTERS: List<String> = listOf("po", "ut", "st", "št", "pi", "so", "ne")

    private const val WINDOW_DAYS = 28

    private fun isNumber(value: Double?): Boolean = value != null && value.isFinite()

    /** JS Math.round: halves round toward positive infinity. */
    private fun jsRound(value: Double): Double = floor(value + 0.5)

    private fun round(value: Double, step: Double): Double = jsRound(value / step) * step

    /** The main sleep of [day] ended that morning, so the night began on the weekday before. */
    fun nightWeekday(day: String): Int = (Dates.weekdayIndex(day) + 6) % 7

    // -----------------------------------------------------------------------------------
    // Heatmap

    val HEAT_METRICS: List<HeatMetricInfo> = listOf(
        HeatMetricInfo(HeatMetric.STEPS, "Kroky"),
        HeatMetricInfo(HeatMetric.SLEEP, "Spánok"),
        HeatMetricInfo(HeatMetric.ACTIVE, "Aktívny čas"),
        HeatMetricInfo(HeatMetric.RESTING, "Pokojový tep"),
    )

    private fun isCumulative(metric: HeatMetric): Boolean =
        metric == HeatMetric.STEPS || metric == HeatMetric.ACTIVE

    /** The day's value for a heatmap metric. Running totals of an unfinished day are left out. */
    fun heatValue(day: Day?, metric: HeatMetric): Double? {
        if (day == null) return null
        if (isCumulative(metric) && !day.complete) return null
        val value = when (metric) {
            HeatMetric.STEPS -> day.steps
            HeatMetric.SLEEP -> day.sleepMinutes
            HeatMetric.ACTIVE -> day.activeMinutesEst
            HeatMetric.RESTING -> DayValues.dayValue(day, DayMetric.RESTING_HR)
        }
        return value?.takeIf { it.isFinite() }
    }

    private fun quantile(sorted: List<Double>, q: Double): Double {
        val position = (sorted.size - 1) * q
        val low = floor(position).toInt()
        val high = min(low + 1, sorted.size - 1)
        return sorted[low] + (sorted[high] - sorted[low]) * (position - low)
    }

    private data class Slot(val day: String, val future: Boolean, val running: Boolean, val value: Double?)

    /** [weeks] whole weeks, Monday first, the last one containing [end]. */
    fun heatmap(days: List<Day>, end: String, metric: HeatMetric, weeks: Int = 12): Heatmap {
        val byDay = Metrics.indexByDay(days)
        val first = Dates.addDays(end, -Dates.weekdayIndex(end) - (weeks - 1) * 7)
        val last = Dates.addDays(first, weeks * 7 - 1)
        val cumulative = isCumulative(metric)
        val slots = Dates.dateRange(first, last).map { day ->
            Slot(
                day = day,
                future = day > end,
                running = day <= end && cumulative && byDay[day]?.complete == false,
                value = if (day > end) null else heatValue(byDay[day], metric),
            )
        }
        val values = slots.mapNotNull { it.value }.sorted()
        val thresholds = if (values.isEmpty()) {
            null
        } else {
            Triple(quantile(values, 0.25), quantile(values, 0.5), quantile(values, 0.75))
        }
        fun levelOf(value: Double?): Int {
            if (value == null || thresholds == null) return 0
            if (value <= thresholds.first) return 1
            if (value <= thresholds.second) return 2
            if (value <= thresholds.third) return 3
            return 4
        }
        return Heatmap(
            metric = metric,
            cells = slots.map { HeatCell(it.day, it.value, levelOf(it.value), it.future, it.running) },
            weeks = weeks,
            first = first,
            last = last,
            average = Metrics.average(values),
            thresholds = thresholds,
        )
    }

    private fun meanBy(entries: List<Pair<Int, Double>>, groups: Int): List<Double?> =
        List(groups) { group -> Metrics.average(entries.filter { it.first == group }.map { it.second }) }

    private fun extremeIndex(values: List<Double?>, highest: Boolean): Int? {
        var best: Int? = null
        values.forEachIndexed { index, value ->
            if (value == null) return@forEachIndexed
            val current = best
            if (current == null || (if (highest) value > values[current]!! else value < values[current]!!)) {
                best = index
            }
        }
        return best
    }

    /** The line under the heatmap's headline figure. */
    fun heatmapNote(map: Heatmap): String {
        val present = map.cells.filter { it.value != null }
        if (present.isEmpty()) return "za 12 týždňov zatiaľ bez dát"
        if (map.metric == HeatMetric.RESTING) {
            val firstWeeks = Metrics.average(
                present.filter { it.day < Dates.addDays(map.first, 28) }.map { it.value },
            )
            val lastWeeks = Metrics.average(
                present.filter { it.day > Dates.addDays(map.last, -28) }.map { it.value },
            )
            if (firstWeeks == null || lastWeeks == null) return "priemer za 12 týždňov"
            val change = jsRound(lastWeeks - firstWeeks)
            if (change == 0.0) return "priemer · za 12 týždňov sa nezmenil"
            return "priemer · za 12 týždňov ${if (change < 0) "klesol" else "stúpol"} o ${Format.formatInt(abs(change))} bpm"
        }
        if (map.metric == HeatMetric.SLEEP) {
            val byNight = meanBy(present.map { nightWeekday(it.day) to it.value!! }, 7)
            val shortest = extremeIndex(byNight, false)
            return if (shortest == null) "za noc" else "za noc · najkratšie spíš v noci ${NIGHTS[shortest]}"
        }
        val byWeekday = meanBy(present.map { Dates.weekdayIndex(it.day) to it.value!! }, 7)
        val busiest = extremeIndex(byWeekday, true)
        val lead = if (map.metric == HeatMetric.STEPS) "krokov za deň" else "za deň · odhad z tepu a tréningov"
        return if (busiest == null) lead else "$lead · najviac bývajú ${WEEKDAYS_PLURAL[busiest]}"
    }

    // -----------------------------------------------------------------------------------
    // Records

    /**
     * Bests of the [length] days ending at [end]: most steps, longest sleep, lowest resting heart
     * rate, longest workout and best day score. Unfinished days do not compete on running totals.
     * On a tie the earlier day keeps the record.
     */
    fun records(days: List<Day>, end: String, length: Int = 90): List<RecordItem> {
        val from = Dates.addDays(end, -(length - 1))
        val inWindow = days.filter { it.day >= from && it.day <= end }
        fun best(key: String, highest: Boolean, candidates: List<Day>, pick: (Day) -> Double?): RecordItem? {
            var found: RecordItem? = null
            for (day in candidates) {
                val value = pick(day)
                if (value == null || !value.isFinite()) continue
                val current = found
                if (current == null || (if (highest) value > current.value else value < current.value)) {
                    found = RecordItem(key, value, day.day)
                }
            }
            return found
        }
        val complete = inWindow.filter { it.complete }
        var workout: RecordItem? = null
        for (day in inWindow) {
            for (item in day.workouts) {
                val duration = item.durationS
                if (duration == null || !duration.isFinite()) continue
                val current = workout
                if (current == null || duration > current.value) {
                    workout = RecordItem("workout", duration, item.day, item.type)
                }
            }
        }
        return listOfNotNull(
            best("steps", true, complete) { it.steps },
            best("sleep", true, inWindow) { it.sleepMinutes },
            best("resting", false, inWindow) { DayValues.dayValue(it, DayMetric.RESTING_HR) },
            workout,
            best("dayScore", true, inWindow) { it.scores?.dayScore },
        )
    }

    // -----------------------------------------------------------------------------------
    // The week in short

    /** The seven days ending at [end], oldest first. */
    fun weekCards(days: List<Day>, end: String): List<WeekCard> {
        val byDay = Metrics.indexByDay(days)
        val month = Dates.dateRange(Dates.addDays(end, -30), Dates.addDays(end, -1))
            .map { heatValue(byDay[it], HeatMetric.STEPS) }
        val usual = Metrics.average(month)
        return Dates.dateRange(Dates.addDays(end, -6), end).map { day ->
            val data = byDay[day]
            val steps = data?.steps?.takeIf { it.isFinite() }
            val longest = data?.workouts?.sortedByDescending { it.durationS ?: 0.0 }?.firstOrNull()
            WeekCard(
                day = day,
                data = data,
                steps = steps,
                stepsShare = if (steps == null || usual == null || usual == 0.0) null else min(1.0, steps / usual),
                sleepMinutes = data?.sleepMinutes?.takeIf { it.isFinite() },
                dayScore = data?.scores?.dayScore?.takeIf { it.isFinite() },
                workout = longest?.let { WeekWorkout(it.type, (it.durationS ?: 0.0) / 60) },
            )
        }
    }

    // -----------------------------------------------------------------------------------
    // Sleep

    /**
     * The night of [day] as a strip of stages, in time order. Uses the stage timeline when the API
     * sends one (only the stretch of the main sleep), otherwise one block per stage.
     */
    fun sleepSegments(day: Day?): List<StageSegment> {
        if (day == null) return emptyList()
        val start = day.sleepStart
        val end = day.sleepEnd
        val timeline = day.sleepTimeline.filter { item ->
            if (!item.end.isAfter(item.start)) return@filter false
            if (start == null || end == null) true else !item.start.isBefore(start) && !item.end.isAfter(end)
        }
        if (timeline.isNotEmpty()) {
            val segments = ArrayList<StageSegment>()
            for (item in timeline) {
                val minutes = (item.end.toEpochMilli() - item.start.toEpochMilli()) / 60_000.0
                val previous = segments.lastOrNull()
                if (previous?.stage == item.stage) {
                    segments[segments.lastIndex] = previous.copy(minutes = previous.minutes + minutes)
                } else {
                    segments.add(StageSegment(item.stage, minutes))
                }
            }
            return segments
        }
        return listOf(
            SleepStage.LIGHT to day.sleepLightMin,
            SleepStage.DEEP to day.sleepDeepMin,
            SleepStage.REM to day.sleepRemMin,
            SleepStage.AWAKE to day.sleepAwakeMin,
        ).filter { (_, minutes) -> minutes != null && minutes.isFinite() && minutes > 0 }
            .map { (stage, minutes) -> StageSegment(stage, minutes!!) }
    }

    /** Usual bedtime and wake-up over the last [nights] nights ending at [end]. */
    fun sleepWindow(days: List<Day>, timeZone: String, end: String, nights: Int = 14): SleepWindow? {
        val from = Dates.addDays(end, -(nights - 1))
        val recent = Metrics.sleepNights(days.filter { it.day >= from && it.day <= end }, timeZone)
        if (recent.size < 3) return null
        val beds = recent.map { it.bedMinutes }
        val meanBed = Metrics.average(beds)!!
        val wakes = recent.map { Dates.localMinutesOfDay(it.end, timeZone).toDouble() }
        val spread = sqrt(Metrics.average(beds.map { (it - meanBed) * (it - meanBed) })!!)
        return SleepWindow(
            bedtime = (jsRound(meanBed) + 720) % 1440,
            wake = jsRound(Metrics.average(wakes)!!),
            spread = jsRound(spread),
            nights = recent.size,
        )
    }

    // -----------------------------------------------------------------------------------
    // "Čo si všimnúť"

    private fun weekendSteps(days: List<Day>, end: String): Insight? {
        val byDay = Metrics.indexByDay(days)
        val window = Dates.dateRange(Dates.addDays(end, -(WINDOW_DAYS - 1)), end).mapNotNull { day ->
            heatValue(byDay[day], HeatMetric.STEPS)?.let { day to it }
        }
        val weekend = window.filter { Dates.weekdayIndex(it.first) >= 5 }.map { it.second }
        val weekday = window.filter { Dates.weekdayIndex(it.first) < 5 }.map { it.second }
        if (weekend.size < 3 || weekday.size < 8) return null
        val we = Metrics.average(weekend)!!
        val wd = Metrics.average(weekday)!!
        if (wd <= 0 || we <= 0) return null
        val byWeekday = meanBy(window.map { Dates.weekdayIndex(it.first) to it.second }, 7)
        val weekendMore = we >= wd
        val bars = byWeekday.mapIndexed { index, value ->
            InsightBar(WEEKDAY_LETTERS[index], value, if (weekendMore) index >= 5 else index < 5)
        }
        val share = if (weekendMore) we / wd - 1 else wd / we - 1
        val percent = jsRound(share * 100)
        val detail = "${Format.formatInt(round(we, 100.0))} oproti ${Format.formatInt(round(wd, 100.0))} krokom"
        if (percent < 10) {
            return Insight(
                "weekendSteps", "Cez víkendy a v pracovné dni prejdeš zhruba rovnako.", "víkend $detail",
                bars, "accent", "/kroky",
            )
        }
        return Insight(
            key = "weekendSteps",
            text = if (weekendMore) {
                "Cez víkendy prejdeš o ${Format.formatInt(percent)} % viac než v pracovné dni."
            } else {
                "V pracovné dni prejdeš o ${Format.formatInt(percent)} % viac než cez víkendy."
            },
            detail = if (weekendMore) detail else "${Format.formatInt(round(wd, 100.0))} oproti ${Format.formatInt(round(we, 100.0))} krokom",
            bars = bars,
            tone = "accent",
            href = "/kroky",
        )
    }

    private fun shortNight(days: List<Day>, end: String): Insight? {
        val from = Dates.addDays(end, -(WINDOW_DAYS - 1))
        val nights = days
            .filter { it.day >= from && it.day <= end && isNumber(it.sleepMinutes) }
            .map { nightWeekday(it.day) to it.sleepMinutes!! }
        val byNight = meanBy(nights, 7)
        if (byNight.count { it != null } < 5 || nights.size < 14) return null
        val shortest = extremeIndex(byNight, false)!!
        val others = Metrics.average(nights.filter { it.first != shortest }.map { it.second })!!
        val value = byNight[shortest]!!
        val bars = byNight.mapIndexed { index, night -> InsightBar(WEEKDAY_LETTERS[index], night, index == shortest) }
        if (others - value < 20) {
            return Insight(
                key = "shortNight",
                text = "Spíš podobne dlho každú noc, okolo ${Format.formatDuration(round(Metrics.average(nights.map { it.second })!!, 5.0))}.",
                detail = "rozdiel medzi nocami je menší ako 20 min",
                bars = bars,
                tone = "sleep",
                href = "/spanok",
            )
        }
        return Insight(
            key = "shortNight",
            text = "Najkratšie spíš v noci ${NIGHTS[shortest]}, priemerne ${Format.formatDuration(value)}.",
            detail = "ostatné noci ${Format.formatDuration(others)}",
            bars = bars,
            tone = "sleep",
            href = "/spanok",
        )
    }

    private fun restingTrend(days: List<Day>, end: String): Insight? {
        val byDay = Metrics.indexByDay(days)
        fun mean(last: String): Double? = Metrics.average(
            Dates.dateRange(Dates.addDays(last, -6), last).map { DayValues.dayValue(byDay[it], DayMetric.RESTING_HR) },
        )
        val recent = mean(end)
        val before = mean(Dates.addDays(end, -30))
        if (recent == null || before == null) return null
        val bars = List(8) { index ->
            val last = Dates.addDays(end, -7 * (7 - index))
            InsightBar("${index + 1}", mean(last), index == 7)
        }
        val change = jsRound(recent - before)
        val from = Format.formatInt(before)
        val to = Format.formatInt(recent)
        if (change == 0.0) {
            return Insight(
                "restingTrend", "Pokojový tep je za mesiac stabilný, okolo $to bpm.", "pred mesiacom $from bpm",
                bars, "heart", "/tep",
            )
        }
        return Insight(
            key = "restingTrend",
            text = "Pokojový tep ti za mesiac ${if (change < 0) "klesol" else "stúpol"} o ${Format.formatInt(abs(change))} bpm.",
            detail = if (change < 0) {
                "z $from na $to · často to sprevádza lepšiu kondíciu"
            } else {
                "z $from na $to · môže to súvisieť so záťažou, spánkom alebo stresom"
            },
            bars = bars,
            tone = "heart",
            href = "/tep",
        )
    }

    /** Observations from the last weeks ending at [end]; each needs enough data to appear. */
    fun insights(days: List<Day>, end: String): List<Insight> =
        listOfNotNull(weekendSteps(days, end), shortNight(days, end), restingTrend(days, end))

    /** Lowest and highest of a run of bars, for scaling them to a common height. */
    fun barRange(bars: List<InsightBar>): BarRange =
        BarRange(Metrics.min(bars.map { it.value }), Metrics.max(bars.map { it.value }))
}
