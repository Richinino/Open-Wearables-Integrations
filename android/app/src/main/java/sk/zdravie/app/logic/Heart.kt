package sk.zdravie.app.logic

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.sqrt
import sk.zdravie.app.model.Day
import sk.zdravie.app.model.NightSignal

data class WeightedPart(val key: String, val max: Int, val weight: Double, val explain: String)

/** Mean and spread of a resting heart rate; [sd] is at least 1 bpm, [days] the values behind it. */
data class Baseline(val mean: Double, val sd: Double, val days: Int)

/** [level] is "green", "yellow", "red" or null (not comparable). */
data class SignalStatus(val level: String?, val title: String, val text: String)

/** [level] is "yellow" or "red". */
data class SignalNight(
    val day: String,
    val level: String,
    val nightHr: Double?,
    val baseline: Double?,
    val delta: Double?,
)

data class NightHeartPoint(val day: String, val nightHr: Double?, val baseline: Double?, val level: String?)

/** Mean of the last 7 days with a value, and of the 7 days a period earlier. */
data class HeartTrend(val recent: Double?, val before: Double?, val change: Double?)

/**
 * Port of web/src/lib/detail-heart.ts: the calculations behind the readiness and heart-rate
 * detail pages. Null and absent days mean "no data". Observations, not medical advice.
 */
object Heart {
    /** Oura Readiness without HRV and temperature: the parts owi computes, heaviest first. */
    val READINESS_PARTS: List<WeightedPart> = listOf(
        WeightedPart("sleep", 100, 0.25, "koľko si spal za posledných 24 hodín aj so zdriemnutím; plný počet okolo 9 h"),
        WeightedPart("resting_hr", 100, 0.2, "nočný pokojový tep oproti tvojmu priemeru za 60 dní; nižší pomáha, vyšší uberá"),
        WeightedPart("activity_balance", 100, 0.15, "pohyb za 2 týždne oproti posledným 2 mesiacom; prudký skok hore aj dole uberá"),
        WeightedPart("sleep_balance", 100, 0.11, "či si za posledné 2 týždne spal toľko, koľko potrebuješ, alebo sa hromadí deficit"),
        WeightedPart("previous_day_activity", 100, 0.11, "včerajšia záťaž oproti tvojmu bežnému dňu; náročný deň dnes uberá"),
        WeightedPart("recovery_index", 100, 0.1, "ako skoro v noci klesol tep na minimum; čím skôr, tým lepšie zotavenie"),
        WeightedPart("sleep_regularity", 100, 0.05, "či zaspávaš a vstávaš v podobných časoch, pravidelnosť spánku za 14 dní"),
    )

    private fun isNumber(value: Double?): Boolean = value != null && value.isFinite()

    private fun restingHr(day: Day?): Double? = DayValues.dayValue(day, DayMetric.RESTING_HR)

    /**
     * The day the readiness page is about: the latest day up to [focus] with a readiness value.
     * Today has none until its night is synced and scored. Without any value, the focus day.
     */
    fun readinessDay(days: List<Day>, focus: String): Day? {
        val upTo = days.filter { it.day <= focus }
        val scored = upTo.lastOrNull { Scores.scoreValue(it.scores?.readiness) != null }
        return scored ?: upTo.firstOrNull { it.day == focus }
    }

    /** Mean and spread of the resting heart rate over the [length] days before [date]. */
    fun restingBaseline(days: List<Day>, date: String, length: Int = 60, minimum: Int = 7): Baseline? {
        val from = Dates.addDays(date, -length)
        val values = days
            .filter { it.day >= from && it.day < date }
            .mapNotNull { restingHr(it) }
        if (values.size < minimum) return null
        val mean = Metrics.average(values)!!
        val sd = sqrt(Metrics.average(values.map { (it - mean) * (it - mean) })!!)
        return Baseline(mean, max(1.0, sd), values.size)
    }

    /** A resting heart rate against the baseline, in plain words. */
    fun restingComparison(value: Double?, baseline: Baseline?): String {
        if (value == null || !value.isFinite()) return "Pokojový tep pre tento deň chýba."
        if (baseline == null) return "Na porovnanie s tvojím priemerom je zatiaľ málo dní."
        val delta = floor(value - baseline.mean + 0.5)
        val usual = "priemer ${Format.formatInt(baseline.mean)} bpm za ${Format.formatInt(baseline.days.toDouble())} dní"
        if (delta == 0.0) return "Rovnaký ako tvoj $usual."
        val within = abs(value - baseline.mean) <= baseline.sd
        val direction = if (delta < 0) "nižší" else "vyšší"
        val tail = when {
            within -> " To je v rámci bežného kolísania."
            delta < 0 -> " Zvyčajne to znamená dobré zotavenie."
            else -> " Býva to po náročnom dni, pri strese, nedostatku spánku alebo na začiatku choroby."
        }
        return "O ${Format.formatInt(abs(delta))} bpm $direction než tvoj $usual.$tail"
    }

    /** The night signal of one night in words, for every level including green and missing. */
    fun signalStatus(signal: NightSignal?): SignalStatus {
        val alert = Scores.nightSignalAlert(signal)
        if (alert != null) return SignalStatus(alert.level, alert.title, alert.text)
        if (signal?.level == "green") {
            val night = if (isNumber(signal.nightHr)) "Nočný tep ${Format.formatInt(signal.nightHr)} bpm" else "Nočný tep"
            val usual = if (isNumber(signal.baseline)) ", tvoj normál ${Format.formatInt(signal.baseline)} bpm" else ""
            return SignalStatus(
                level = "green",
                title = "Nočný tep je v norme",
                text = "$night$usual. Rozdiel je menší ako 3 bpm, čo je bežné kolísanie.",
            )
        }
        return SignalStatus(
            level = null,
            title = "Nočný tep sa nedá porovnať",
            text = "Na túto noc chýba dosť minút spánku s tepom alebo zatiaľ nie je s čím porovnávať.",
        )
    }

    /** Yellow and red nights in the [length] days ending at [end], newest first. */
    fun signalNights(days: List<Day>, end: String, length: Int = 90): List<SignalNight> {
        val from = Dates.addDays(end, -(length - 1))
        return days
            .filter { it.day >= from && it.day <= end }
            .mapNotNull { day ->
                val signal = day.scores?.nightSignal ?: return@mapNotNull null
                val level = signal.level
                if (level != "yellow" && level != "red") return@mapNotNull null
                SignalNight(
                    day = day.day,
                    level = level,
                    nightHr = signal.nightHr?.takeIf { it.isFinite() },
                    baseline = signal.baseline?.takeIf { it.isFinite() },
                    delta = signal.delta?.takeIf { it.isFinite() },
                )
            }
            .reversed()
    }

    /** One line about a flagged night. */
    fun signalNightText(night: SignalNight): String {
        val nightHr = night.nightHr
        val baseline = night.baseline
        val delta = night.delta
        val heart = if (nightHr == null) "Nočný tep" else "Nočný tep ${Format.formatInt(nightHr)} bpm"
        val over = if (delta == null) " nad normálom" else ", o ${Format.formatInt(max(1.0, delta))} bpm nad normálom"
        val usual = if (baseline == null) "" else " (${Format.formatInt(baseline)} bpm)"
        val tail = if (night.level == "red") ", druhá zvýšená noc po sebe." else "."
        return "$heart$over$usual$tail"
    }

    /** Night heart rate and its baseline for every day of the window, oldest first. */
    fun nightHeartSeries(days: List<Day>, end: String, length: Int): List<NightHeartPoint> {
        val byDay = Metrics.indexByDay(days)
        return Dates.dateRange(Dates.addDays(end, -(length - 1)), end).map { date ->
            val signal = byDay[date]?.scores?.nightSignal
            NightHeartPoint(
                day = date,
                nightHr = signal?.nightHr?.takeIf { it.isFinite() },
                baseline = signal?.baseline?.takeIf { it.isFinite() },
                level = signal?.level,
            )
        }
    }

    /** Resting heart rate of the last week against the same week [period] days earlier. */
    fun restingTrend(days: List<Day>, end: String, period: Int): HeartTrend {
        val byDay = Metrics.indexByDay(days)
        fun week(last: String): Double? =
            Metrics.average(Dates.dateRange(Dates.addDays(last, -6), last).map { restingHr(byDay[it]) })
        val recent = week(end)
        val before = week(Dates.addDays(end, -period))
        return HeartTrend(recent, before, if (recent == null || before == null) null else recent - before)
    }
}
