package sk.zdravie.app.logic

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.sqrt
import sk.zdravie.app.model.Day
import sk.zdravie.app.model.Score
import sk.zdravie.app.model.SleepStage

/** The three sleep scores the viewer can choose between; the account stores their lower-case names. */
enum class SleepKind {
    PERFORMANCE, APPLE, SAMSUNG;

    companion object {
        /** Maps the stored account value; anything unknown falls back to [PERFORMANCE]. */
        fun fromAccount(value: String): SleepKind = when (value) {
            "apple" -> APPLE
            "samsung" -> SAMSUNG
            else -> PERFORMANCE
        }
    }
}

data class PartInfo(
    val key: String,
    /** Top of the part's scale: 100 for percentages, the points for Apple's parts. */
    val max: Int,
    /** One plain line on what the part measures. */
    val explain: String,
)

data class SleepKindInfo(
    val kind: SleepKind,
    val label: String,
    /** Text of the switch option when it differs from the label. */
    val option: String? = null,
    /** Whose method it follows; shown subtly in the detail only. */
    val vendor: String,
    val about: String,
    val band: (Double?) -> Band?,
    /** Nights from this score on count as strong in the history. */
    val top: Int,
    /** owi's value is always an estimate (≈), whatever its note says; see [Sleep.nightScore]. */
    val estimate: Boolean = false,
    /** Known parts in display order. */
    val parts: List<PartInfo>,
    /** Show only the parts the score has, so a part owi leaves out never shows as an empty row. */
    val onlyPresent: Boolean = false,
)

data class NightScore(
    /** The number shown for the night, null without one. */
    val value: Double?,
    /** The value is owi's estimate (≈). */
    val estimate: Boolean,
    /** The value is Samsung's own Sleep Score, sent by itself. */
    val fromSamsung: Boolean,
    /** owi's score of the kind, with its parts and note; for Samsung its estimate. */
    val score: Score?,
)

data class StageTotal(
    /** One of DEEP, REM, LIGHT, AWAKE. */
    val stage: SleepStage,
    val minutes: Double?,
    /** Share of the sleep (not of the time in bed); null for awake. */
    val share: Double?,
)

data class StageBlock(
    val stage: SleepStage,
    /** Epoch milliseconds. */
    val start: Long,
    val end: Long,
)

data class SleepSession(
    val start: Long,
    val end: Long,
    val blocks: List<StageBlock>,
    /** Minutes asleep: every stage except awake. */
    val asleepMinutes: Double,
    val stageMinutes: Map<SleepStage, Double>,
)

data class SplitTimeline(val main: SleepSession?, val naps: List<SleepSession>)

data class HourTick(
    /** Epoch milliseconds. */
    val at: Long,
    /** Local clock, "23:00". */
    val label: String,
)

data class NeedPlan(
    /** The day whose evening it is; its sleep need is for the night that follows. */
    val day: String,
    val need: Double?,
    /** Usual wake-up on the next morning, minutes since local midnight. */
    val wake: Double?,
    /** Suggested time to fall asleep, minutes since local midnight. */
    val bedtime: Double?,
    val strain: Double?,
    /** The day is still running, so its strain and therefore the need may still grow. */
    val partial: Boolean,
)

data class NightPoint(
    /** The day the night ended on. */
    val day: String,
    val data: Day?,
    val minutes: Double?,
    /** The need set the evening before, which this night is measured against. */
    val need: Double?,
    val score: Double?,
    /** The score is owi's estimate (≈), not the vendor's own number. */
    val estimate: Boolean,
    val scoreNote: String?,
    val regularity: Double?,
)

data class NeedCoverage(
    /** Nights with both a duration and a need. */
    val nights: Int,
    val covered: Int,
    /** Mean shortfall over the nights that fell short, minutes. */
    val shortfall: Double?,
    val averageMinutes: Double?,
    val averageNeed: Double?,
)

/** All values are minutes since local midnight, except [nights] and [bedSpread] (minutes). */
data class ClockSummary(
    val nights: Int,
    val bedMean: Double,
    val bedEarliest: Double,
    val bedLatest: Double,
    val wakeMean: Double,
    val wakeEarliest: Double,
    val wakeLatest: Double,
    /** Standard deviation of the bedtime, minutes. */
    val bedSpread: Double,
)

/** [fifth]: 1 = least regular fifth of adults, 5 = most regular. */
data class RegularityBand(val fifth: Int, val label: String, val text: String)

/**
 * Port of web/src/lib/detail-sleep.ts: the two sleep scores and their parts, the night as a
 * hypnogram with naps apart, sleep need for tonight, history against the need, the usual bed and
 * wake times and what the Sleep Regularity Index means. Null and absent days mean "no data".
 */
object Sleep {
    private const val MINUTE_MS = 60_000L
    /** Stretches of the timeline closer than this belong to the same nap. */
    private const val NAP_GAP_MINUTES = 30
    /** Timeline stretches may overhang the main sleep by this much and still belong to it. */
    private const val EDGE_MS = 2 * MINUTE_MS

    private fun isNumber(value: Double?): Boolean = value != null && value.isFinite()

    /** JS Math.round: halves round toward positive infinity. */
    private fun jsRound(value: Double): Double = floor(value + 0.5)

    // -----------------------------------------------------------------------------------
    // The two scores

    val SLEEP_KINDS: Map<SleepKind, SleepKindInfo> = mapOf(
        SleepKind.PERFORMANCE to SleepKindInfo(
            kind = SleepKind.PERFORMANCE,
            label = "Výkon spánku",
            vendor = "WHOOP",
            about = "Koľko z potrebného spánku si naozaj naspal. 100 znamená, že si potrebu pokryl celú.",
            band = Scores::sleepPerformanceBand,
            top = 85,
            parts = listOf(
                PartInfo("hours_vs_needed", 100, "koľko percent potreby spánku z predošlého dňa si naspal"),
                PartInfo("consistency", 100, "ako sa časy zaspatia a vstávania zhodujú s poslednými nocami"),
                PartInfo("efficiency", 100, "podiel času v posteli, keď si naozaj spal, nie ležal hore"),
            ),
        ),
        SleepKind.APPLE to SleepKindInfo(
            kind = SleepKind.APPLE,
            label = "Sleep Score",
            vendor = "Apple",
            about = "Súčet troch častí: dĺžka spánku do 50 bodov, čas zaspatia do 30 a prerušenia do 20.",
            band = Scores::appleSleepBand,
            top = 81,
            parts = listOf(
                PartInfo("duration", 50, "plný počet od asi 7 h 50 min spánku; uberá aj málo hlbokého spánku či REM"),
                PartInfo("bedtime", 30, "zaspatie oproti tvojmu bežnému času za posledných 13 nocí"),
                PartInfo("interruptions", 20, "bdenie počas noci a počet prebudení"),
            ),
        ),
        SleepKind.SAMSUNG to SleepKindInfo(
            kind = SleepKind.SAMSUNG,
            label = "Samsung Sleep Score",
            option = "Samsung",
            vendor = "Samsung",
            about = "Skóre zo Samsung Health. Keď ho Samsung pošle, je tu jeho číslo; inak odhad owi z častí, ako ich Samsung popisuje, s váhami naučenými zo skutočných skóre.",
            band = Scores::samsungSleepBand,
            top = 90,
            estimate = true,
            onlyPresent = true,
            // Keys as owi's samsung_scores.py names them.
            parts = listOf(
                PartInfo("duration", 100, "celkový čas spánku oproti potrebe, pri tvojom veku 8 h"),
                PartInfo("deep", 100, "hlboký spánok, fyzická regenerácia"),
                PartInfo("rem", 100, "REM spánok, psychická regenerácia"),
                PartInfo("efficiency", 100, "koľko z času v posteli si naozaj spal"),
                PartInfo("interruptions", 100, "bdenie po zaspaní"),
                PartInfo("latency", 100, "ako dlho ti trvá zaspať"),
            ),
        ),
    )

    fun sleepScoreOf(day: Day?, kind: SleepKind): Score? {
        val scores = day?.scores ?: return null
        return when (kind) {
            SleepKind.PERFORMANCE -> scores.sleepPerformance
            SleepKind.APPLE -> scores.appleSleep
            SleepKind.SAMSUNG -> scores.samsungSleep
        }
    }

    /**
     * The night's number for the chosen kind. For Samsung: its own Sleep Score when it sent one,
     * else owi's estimate (≈), else nothing (owi's score then says why, e.g. "learning").
     */
    fun nightScore(day: Day?, kind: SleepKind): NightScore {
        val score = sleepScoreOf(day, kind)
        val sent = if (kind == SleepKind.SAMSUNG) day?.samsungAuto?.sleepScore else null
        if (sent != null && isNumber(sent)) return NightScore(sent, estimate = false, fromSamsung = true, score = score)
        val value = Scores.scoreValue(score)
        val estimate = value != null && SLEEP_KINDS.getValue(kind).estimate
        return NightScore(value, estimate = estimate, fromSamsung = false, score = score)
    }

    // -----------------------------------------------------------------------------------
    // Last night

    /** The latest day up to [date] with a recorded main sleep: the night that ended that morning. */
    fun lastNight(days: List<Day>, date: String): Day? {
        for (index in days.indices.reversed()) {
            val day = days[index]
            if (day.day <= date && (isNumber(day.sleepMinutes) || day.sleepStart != null)) return day
        }
        return null
    }

    /** Minutes per stage of the main sleep, deep first, from the day's totals. */
    fun stageTotals(day: Day?): List<StageTotal> {
        val sleep = day?.sleepMinutes?.takeIf { it.isFinite() && it > 0 }
        fun of(stage: SleepStage, minutes: Double?, withShare: Boolean): StageTotal {
            val value = minutes?.takeIf { it.isFinite() }
            val share = if (withShare && value != null && sleep != null) value / sleep else null
            return StageTotal(stage, value, share)
        }
        return listOf(
            of(SleepStage.DEEP, day?.sleepDeepMin, true),
            of(SleepStage.REM, day?.sleepRemMin, true),
            of(SleepStage.LIGHT, day?.sleepLightMin, true),
            of(SleepStage.AWAKE, day?.sleepAwakeMin, false),
        )
    }

    // -----------------------------------------------------------------------------------
    // Hypnogram

    private fun blocksOf(day: Day): List<StageBlock> =
        day.sleepTimeline
            .map { StageBlock(it.stage, it.start.toEpochMilli(), it.end.toEpochMilli()) }
            .filter { it.end > it.start }
            .sortedBy { it.start }

    private fun session(blocks: List<StageBlock>): SleepSession {
        val merged = ArrayList<StageBlock>()
        for (block in blocks) {
            val previous = merged.lastOrNull()
            if (previous != null && previous.stage == block.stage && block.start <= previous.end) {
                merged[merged.lastIndex] = previous.copy(end = max(previous.end, block.end))
            } else {
                merged.add(block)
            }
        }
        val stageMinutes = LinkedHashMap<SleepStage, Double>()
        var asleep = 0.0
        for (block in merged) {
            val minutes = (block.end - block.start) / MINUTE_MS.toDouble()
            stageMinutes[block.stage] = (stageMinutes[block.stage] ?: 0.0) + minutes
            if (block.stage != SleepStage.AWAKE) asleep += minutes
        }
        return SleepSession(
            start = merged.first().start,
            end = merged.maxOf { it.end },
            blocks = merged,
            asleepMinutes = jsRound(asleep),
            stageMinutes = stageMinutes,
        )
    }

    /**
     * The stage timeline of [day] split into the main sleep (the stretch between sleepStart and
     * sleepEnd) and naps (everything else, grouped when less than 30 min apart). `main` is null
     * when the day sends no timeline for its main sleep.
     */
    fun splitTimeline(day: Day?): SplitTimeline {
        if (day == null) return SplitTimeline(null, emptyList())
        val blocks = blocksOf(day)
        val from = day.sleepStart?.toEpochMilli()
        val to = day.sleepEnd?.toEpochMilli()
        fun inMain(block: StageBlock): Boolean =
            from != null && to != null && to > from && block.start >= from - EDGE_MS && block.end <= to + EDGE_MS

        val mainBlocks = blocks.filter { inMain(it) }
        val napBlocks = blocks.filter { !inMain(it) && it.stage != SleepStage.AWAKE }
        val groups = ArrayList<MutableList<StageBlock>>()
        for (block in napBlocks) {
            val group = groups.lastOrNull()
            val lastEnd = group?.maxOf { it.end } ?: Long.MIN_VALUE
            if (group != null && block.start - lastEnd <= NAP_GAP_MINUTES * MINUTE_MS) group.add(block)
            else groups.add(mutableListOf(block))
        }
        return SplitTimeline(
            main = if (mainBlocks.isNotEmpty()) session(mainBlocks) else null,
            naps = groups.map { session(it) },
        )
    }

    private fun pad(value: Int): String = value.toString().padStart(2, '0')

    /** Whole local hours (every [step] minutes) between two instants, both ends included. */
    fun hourTicks(start: Long, end: Long, timeZone: String, step: Int = 60): List<HourTick> {
        if (end <= start || step <= 0) return emptyList()
        val local = Dates.localMinutesOfDay(java.time.Instant.ofEpochMilli(start), timeZone)
        val sub = Math.floorMod(start, MINUTE_MS)
        val offset = (step - (local % step)) % step
        val first = start - sub + offset * MINUTE_MS
        val ticks = ArrayList<HourTick>()
        var at = first
        var minutes = local + offset
        while (at <= end) {
            if (at >= start) {
                val ofDay = Math.floorMod(minutes, 1440)
                ticks.add(HourTick(at, "${pad(ofDay / 60)}:${pad(ofDay % 60)}"))
            }
            at += step * MINUTE_MS
            minutes += step
        }
        return ticks
    }

    // -----------------------------------------------------------------------------------
    // Sleep need for tonight

    fun needTonight(days: List<Day>, timeZone: String, date: String): NeedPlan {
        val day = Metrics.indexByDay(days)[date]
        val need = day?.scores?.sleepNeedMinutes?.takeIf { it.isFinite() }
        val wake = Scores.typicalWake(days, timeZone, Dates.addDays(date, 1))
        return NeedPlan(
            day = date,
            need = need,
            wake = wake,
            bedtime = Scores.bedtimeFor(need, wake),
            strain = day?.scores?.strain?.takeIf { it.isFinite() },
            partial = day?.complete == false,
        )
    }

    // -----------------------------------------------------------------------------------
    // History

    /** One entry per day of the window ending at [end], oldest first; missing days stay null. */
    fun sleepHistory(days: List<Day>, end: String, nights: Int, kind: SleepKind): List<NightPoint> {
        val byDay = Metrics.indexByDay(days)
        return Dates.dateRange(Dates.addDays(end, -(max(1, nights) - 1)), end).map { date ->
            val data = byDay[date]
            val need = byDay[Dates.addDays(date, -1)]?.scores?.sleepNeedMinutes
            val night = nightScore(data, kind)
            val regularity = data?.scores?.sleepRegularity
            NightPoint(
                day = date,
                data = data,
                minutes = data?.sleepMinutes?.takeIf { it.isFinite() },
                need = need?.takeIf { it.isFinite() },
                score = night.value,
                estimate = night.estimate,
                scoreNote = night.score?.note,
                regularity = regularity?.takeIf { it.isFinite() },
            )
        }
    }

    fun needCoverage(points: List<NightPoint>): NeedCoverage {
        val paired = points.filter { it.minutes != null && it.need != null }
        val short = paired.filter { it.minutes!! < it.need!! }
        return NeedCoverage(
            nights = paired.size,
            covered = paired.size - short.size,
            shortfall = Metrics.average(short.map { it.need!! - it.minutes!! }),
            averageMinutes = Metrics.average(points.map { it.minutes }),
            averageNeed = Metrics.average(points.map { it.need }),
        )
    }

    private fun fromNoon(minutes: Double): Double = (jsRound(minutes) + 720) % 1440

    /** Usual, earliest and latest bed and wake times of the nights in the window ending at [end]. */
    fun clockSummary(days: List<Day>, timeZone: String, end: String, nights: Int): ClockSummary? {
        val from = Dates.addDays(end, -(max(1, nights) - 1))
        val recent = Metrics.sleepNights(days.filter { it.day >= from && it.day <= end }, timeZone)
        if (recent.isEmpty()) return null
        val beds = recent.map { it.bedMinutes }
        // Wake times in the same noon-based scale, so a wake-up after midnight never wraps.
        val wakes = recent.map { ((Dates.localMinutesOfDay(it.end, timeZone) - 720 + 1440) % 1440).toDouble() }
        val meanBed = Metrics.average(beds)!!
        return ClockSummary(
            nights = recent.size,
            bedMean = fromNoon(meanBed),
            bedEarliest = fromNoon(beds.min()),
            bedLatest = fromNoon(beds.max()),
            wakeMean = fromNoon(Metrics.average(wakes)!!),
            wakeEarliest = fromNoon(wakes.min()),
            wakeLatest = fromNoon(wakes.max()),
            bedSpread = jsRound(sqrt(Metrics.average(beds.map { (it - meanBed) * (it - meanBed) })!!)),
        )
    }

    // -----------------------------------------------------------------------------------
    // Sleep Regularity Index

    /** Quintile limits of the SRI in UK Biobank (Windred 2024); the median is 81. */
    val SRI_QUINTILES: List<Double> = listOf(71.7, 78.6, 83.2, 87.3)
    const val SRI_MEDIAN: Double = 81.0

    fun regularityBand(sri: Double?): RegularityBand? {
        if (sri == null || !sri.isFinite()) return null
        if (sri >= SRI_QUINTILES[3]) {
            return RegularityBand(5, "veľmi pravidelný", "Patríš medzi pätinu dospelých s najpravidelnejším spánkom.")
        }
        if (sri >= SRI_QUINTILES[2]) {
            return RegularityBand(4, "pravidelný", "Spíš pravidelnejšie než väčšina dospelých.")
        }
        if (sri >= SRI_QUINTILES[1]) {
            return RegularityBand(3, "priemerný", "Pravidelnosť je okolo bežnej hodnoty dospelých (medián 81).")
        }
        if (sri >= SRI_QUINTILES[0]) {
            return RegularityBand(2, "menej pravidelný", "Spíš o niečo nepravidelnejšie než väčšina dospelých.")
        }
        return RegularityBand(
            1,
            "nepravidelný",
            "Patríš medzi pätinu dospelých s najmenej pravidelným spánkom. Pomáha zaspávať a vstávať v podobných časoch aj cez víkend.",
        )
    }
}
