package sk.zdravie.app.logic

import java.time.Instant
import kotlin.math.floor
import kotlin.math.max
import sk.zdravie.app.logic.Format.DASH
import sk.zdravie.app.model.Day
import sk.zdravie.app.model.DayScores
import sk.zdravie.app.model.NightSignal
import sk.zdravie.app.model.Score

/** Which layout fits the local time. */
enum class Mode { MORNING, EVENING }

data class ModeResult(val mode: Mode, val day: String)

/** One score band; [tone] is one of "top", "good", "fair", "low". */
data class Band(val key: String, val label: String, val tone: String)

/** [level] is "yellow" or "red". */
data class NightAlert(val level: String, val title: String, val text: String)

data class Extremes(val weakest: Pair<String, Double>?, val strongest: Pair<String, Double>?)

/** [key] is "readiness", "sleepPerformance" or "activity". */
data class SubScore(
    val key: String,
    val label: String,
    val value: Double?,
    val display: String,
    val band: Band?,
    val reason: String,
)

/**
 * Port of web/src/lib/scores.ts: what the pages say about owi's scores, in Slovak. Bands, labels,
 * one-line reasons, the morning/evening mode and the night-signal warning. The app never computes
 * a score; it only words the ones the server sends.
 */
object Scores {
    val SCORE_NAMES: Map<String, String> = mapOf(
        "day" to "Skóre dňa",
        "readiness" to "Readiness",
        "sleepPerformance" to "Sleep Performance",
        "appleSleep" to "Sleep Score",
        "activity" to "Activity",
        "strain" to "Strain",
        "sleepNeed" to "Potreba spánku",
        "cardioLoad" to "Stav záťaže",
        "nightSignal" to "Nočný tep",
        "whoopAge" to "Vek tela",
        "samsungSleep" to "Samsung Sleep Score",
        "energy" to "Energy Score",
    )

    /** Where each score comes from; shown in detail views only, never on the main cards. */
    val SCORE_SOURCES: Map<String, String> = mapOf(
        "readiness" to "Oura Readiness bez HRV a teploty",
        "sleepPerformance" to "WHOOP Sleep Performance",
        "appleSleep" to "Apple Sleep Score",
        "activity" to "Oura Activity",
        "strain" to "WHOOP Strain",
        "sleepNeed" to "WHOOP potreba spánku",
        "cardioLoad" to "Polar Cardio Load",
        "nightSignal" to "NightSignal (Alavi 2022)",
        "whoopAge" to "WHOOP Age",
    )

    /** Slovak names of score components, keyed like owi's `Score.components`. */
    val COMPONENT_LABELS: Map<String, String> = mapOf(
        // Readiness
        "sleep" to "spánok",
        "resting_hr" to "pokojový tep",
        "activity_balance" to "vyváženosť aktivity",
        "sleep_balance" to "spánková bilancia",
        "previous_day_activity" to "včerajšia aktivita",
        "recovery_index" to "zotavenie v noci",
        "sleep_regularity" to "pravidelnosť spánku",
        "hrv_balance" to "variabilita tepu oproti vlastnému priemeru",
        // Sleep Performance
        "hours_vs_needed" to "spánok oproti potrebe",
        "consistency" to "pravidelnosť",
        "efficiency" to "efektivita spánku",
        // Apple Sleep Score
        "duration" to "dĺžka",
        "bedtime" to "čas zaspatia",
        "interruptions" to "prerušenia",
        // Activity
        "meet_daily_targets" to "denné ciele",
        "stay_active" to "menej sedenia",
        "training_volume" to "objem tréningu",
        "training_frequency" to "frekvencia tréningov",
        "move_every_hour" to "pohyb každú hodinu",
        "recovery_time" to "čas na oddych",
        // WHOOP Age
        "sleep_duration" to "dĺžka spánku",
        "sleep_consistency" to "pravidelnosť spánku",
        "steps" to "kroky",
        "zone_1_3" to "zóny 1–3",
        "zone_4_5" to "zóny 4–5",
        "strength" to "silový tréning",
        "vo2max" to "VO2max",
        "lean_mass" to "svalová hmota",
        // Samsung Sleep Score and Energy Score (estimates)
        "deep" to "hlboký spánok",
        "rem" to "REM spánok",
        "latency" to "zaspávanie",
        "timing" to "načasovanie spánku",
        "regularity" to "pravidelnosť spánku",
        "load" to "včerajšia záťaž",
        "night_hr" to "nočný tep",
    )

    fun componentLabel(key: String): String =
        COMPONENT_LABELS[key] ?: key.replace(Regex("_+"), " ")

    private val NOTE_TEXTS: Map<String, String> = mapOf(
        "estimate" to "odhad",
        "too little history" to "zatiaľ málo dát",
        "no data" to "bez dát",
        "no sleep recorded" to "spánok sa nezaznamenal",
        "no sleep need from the day before" to "chýba potreba spánku z predošlého dňa",
        "age missing" to "chýba vek",
        "no sleep stages, no stage deductions" to "bez fáz spánku",
        "learning" to "učí sa",
    )

    private val NOTE_SPLIT = Regex(";\\s*")
    private val LIST_SPLIT = Regex(",\\s*")
    private val WITHOUT = Regex("^without (.+)$")

    /** owi's English score notes in Slovak; unknown notes pass through unchanged. */
    fun noteText(note: String?): String? {
        if (note.isNullOrEmpty()) return null
        return note.split(NOTE_SPLIT).joinToString("; ") { part ->
            val without = WITHOUT.find(part)
            if (without != null) {
                "bez: " + without.groupValues[1].split(LIST_SPLIT).joinToString(", ") { componentLabel(it) }
            } else {
                NOTE_TEXTS[part] ?: part
            }
        }
    }

    // -----------------------------------------------------------------------------------
    // Values

    private fun isNumber(value: Double?): Boolean = value != null && value.isFinite()

    /** JS Math.round: halves round toward positive infinity. */
    private fun jsRound(value: Double): Double = floor(value + 0.5)

    fun scoreValue(score: Score?): Double? = score?.value?.takeIf { it.isFinite() }

    fun isEstimate(score: Score?): Boolean {
        val note = score?.note
        return !note.isNullOrEmpty() && note.split(NOTE_SPLIT).contains("estimate")
    }

    /** A 0-100 score as a whole number; estimates carry the ≈ marker. */
    fun formatScore(score: Score?): String {
        val value = scoreValue(score) ?: return DASH
        val text = Format.formatInt(value)
        return if (isEstimate(score)) Format.approx(text) else text
    }

    /** Strain keeps one decimal, as WHOOP shows it: "13,4". */
    fun formatStrain(strain: Double?): String =
        if (isNumber(strain)) Format.formatDecimal(strain, 1) else DASH

    // -----------------------------------------------------------------------------------
    // Bands

    private fun pick(value: Double?, bands: List<Pair<Double, Band>>, last: Band): Band? {
        if (value == null || !value.isFinite()) return null
        for ((from, band) in bands) if (value >= from) return band
        return last
    }

    /** WHOOP strain bands: 0-9.9 light, 10-13.9 moderate, 14-17.9 high, 18-21 all out. */
    fun strainBand(strain: Double?): Band? = pick(
        strain,
        listOf(
            18.0 to Band("max", "maximálna záťaž", "low"),
            14.0 to Band("high", "vysoká záťaž", "fair"),
            10.0 to Band("moderate", "stredná záťaž", "good"),
        ),
        Band("light", "ľahká záťaž", "top"),
    )

    /** Oura readiness bands: 85+ optimal, 70-84 good, 60-69 fair, below 60 pay attention. */
    fun readinessBand(value: Double?): Band? = pick(
        value,
        listOf(
            85.0 to Band("optimal", "optimálna", "top"),
            70.0 to Band("good", "dobrá", "good"),
            60.0 to Band("fair", "slabšia", "fair"),
        ),
        Band("low", "nízka", "low"),
    )

    /** WHOOP Sleep Performance bands: 85+ optimal, 70-84 sufficient, below 70 poor. */
    fun sleepPerformanceBand(value: Double?): Band? = pick(
        value,
        listOf(
            85.0 to Band("optimal", "optimálny", "top"),
            70.0 to Band("sufficient", "dostačujúci", "good"),
        ),
        Band("poor", "slabý", "low"),
    )

    /** Apple Sleep Score bands: 0-40, 41-60, 61-80, 81-95, 96+, on whole points. */
    fun appleSleepBand(value: Double?): Band? {
        if (value == null || !value.isFinite()) return null
        return pick(
            jsRound(value),
            listOf(
                96.0 to Band("very_high", "veľmi vysoké", "top"),
                81.0 to Band("high", "vysoké", "top"),
                61.0 to Band("ok", "v poriadku", "good"),
                41.0 to Band("low", "nízke", "fair"),
            ),
            Band("very_low", "veľmi nízke", "low"),
        )
    }

    /** Samsung Health Sleep Score bands: 90+ excellent, 70-89 good, 50-69 fair, below 50 attention. */
    fun samsungSleepBand(value: Double?): Band? = pick(
        value,
        listOf(
            90.0 to Band("excellent", "výborné", "top"),
            70.0 to Band("good", "dobré", "good"),
            50.0 to Band("fair", "priemerné", "fair"),
        ),
        Band("attention", "slabé", "low"),
    )

    /** Oura activity bands: 85+ optimal, 70-84 good, below 70 pay attention. */
    fun activityBand(value: Double?): Band? = pick(
        value,
        listOf(
            85.0 to Band("optimal", "optimálna", "top"),
            70.0 to Band("good", "dobrá", "good"),
        ),
        Band("low", "nízka", "low"),
    )

    /** Words under the day score ring. */
    fun dayScoreLabel(value: Double?): String {
        if (value == null || !value.isFinite()) return "skóre zatiaľ nie je"
        if (value >= 85) return "výborný deň"
        if (value >= 70) return "dobrý deň"
        if (value >= 60) return "priemerný deň"
        return "slabší deň"
    }

    private val CARDIO_LABELS: Map<String, String> = mapOf(
        "detraining" to "pokles formy",
        "recovering" to "zotavovanie",
        "maintaining" to "udržiavanie",
        "productive" to "produktívna záťaž",
        "overreaching" to "preťaženie",
    )

    fun cardioStatusLabel(status: String?): String = status?.let { CARDIO_LABELS[it] } ?: DASH

    // -----------------------------------------------------------------------------------
    // Morning and evening

    /** Local time from which the overview switches to the evening layout. */
    const val EVENING_FROM_MINUTES = 15 * 60

    /** Until this local time the evening of the day before is still running. */
    const val NIGHT_UNTIL_MINUTES = 4 * 60

    /**
     * Which layout fits the local time, and which day it is about.
     *   04:00-14:59 morning, about today
     *   15:00-23:59 evening, about today
     *   00:00-03:59 still the evening of yesterday
     * [override] ("rano" or "vecer") forces the layout; the day then stays the natural one when
     * the layouts agree and is today otherwise.
     */
    fun resolveMode(now: Instant, timeZone: String, override: String?): ModeResult {
        val today = Dates.todayIn(timeZone, now)
        val minutes = Dates.localMinutesOfDay(now, timeZone)
        val natural = when {
            minutes < NIGHT_UNTIL_MINUTES -> ModeResult(Mode.EVENING, Dates.addDays(today, -1))
            minutes < EVENING_FROM_MINUTES -> ModeResult(Mode.MORNING, today)
            else -> ModeResult(Mode.EVENING, today)
        }
        val forced = when (override) {
            "rano" -> Mode.MORNING
            "vecer" -> Mode.EVENING
            else -> null
        }
        if (forced == null || forced == natural.mode) return natural
        return ModeResult(forced, today)
    }

    // -----------------------------------------------------------------------------------
    // Night signal

    /** Plain wording for a yellow or red night signal; null when there is nothing to say. */
    fun nightSignalAlert(signal: NightSignal?): NightAlert? {
        if (signal == null || (signal.level != "yellow" && signal.level != "red")) return null
        val delta = signal.delta
        val baseline = signal.baseline
        val over = if (isNumber(delta)) "o ${Format.formatInt(max(1.0, delta!!))} bpm" else "citeľne"
        val usual = if (isNumber(baseline)) " (bežne okolo ${Format.formatInt(baseline)} bpm)" else ""
        if (signal.level == "red") {
            return NightAlert(
                level = "red",
                title = "Nočný tep je zvýšený už druhú noc po sebe",
                text = "Tep počas noci bol $over vyšší než zvyčajne$usual. Takýto vzorec sa často objavuje " +
                    "pri začínajúcej chorobe, strese alebo preťažení. Zváž oddych a ľahší deň; ak sa necítiš " +
                    "dobre, poraď sa s lekárom. Je to pozorovanie z dát, nie diagnóza.",
            )
        }
        return NightAlert(
            level = "yellow",
            title = "Nočný tep bol vyšší než zvyčajne",
            text = "Minulú noc bol tep $over nad tvojím normálom$usual. Býva to po náročnom dni, " +
                "pri strese, nedostatku spánku alebo na začiatku choroby. Sleduj, ako sa cítiš.",
        )
    }

    // -----------------------------------------------------------------------------------
    // One-line reasons under the three sub-scores

    /** The lowest and highest component that exists; ties are broken by key. */
    fun componentExtremes(score: Score?): Extremes {
        val entries = (score?.components ?: emptyMap()).entries
            .mapNotNull { (key, value) -> if (value != null && value.isFinite()) key to value else null }
        if (entries.isEmpty()) return Extremes(null, null)
        val sorted = entries.sortedWith(compareBy({ it.second }, { it.first }))
        return Extremes(sorted.first(), sorted.last())
    }

    private fun missingReason(score: Score?): String = noteText(score?.note) ?: "zatiaľ sa nedá spočítať"

    private fun readinessReason(day: Day, score: Score?): String {
        if (scoreValue(score) == null) return missingReason(score)
        val parts = ArrayList<String>()
        val restingComponent = score?.components?.get("resting_hr")
        val resting = day.hrResting
        // Describe the exact rolling-minute input used by the backend score, not device RHR.
        if (resting != null && resting.isFinite() && restingComponent != null && restingComponent.isFinite()) {
            // 87.5 at the person's mean, 100 a standard deviation below it, 57.5 one above.
            val where = when {
                restingComponent >= 95 -> "pod tvojím priemerom"
                restingComponent >= 75 -> "blízko tvojho priemeru"
                else -> "nad tvojím priemerom"
            }
            parts.add("pokojový tep ${Format.formatInt(resting)}, $where")
        }
        val (weakest, strongest) = componentExtremes(score)
        if (weakest != null && weakest.second < 60 && weakest.first != "resting_hr") {
            parts.add("brzdí ${componentLabel(weakest.first)}")
        } else if (parts.isEmpty() && strongest != null) {
            parts.add("najviac pomáha ${componentLabel(strongest.first)}")
        }
        return parts.joinToString(" · ").ifEmpty { "z nočného tepu a spánku" }
    }

    private fun sleepReason(day: Day, score: Score?, needMinutes: Double?): String {
        val sleepMinutes = day.sleepMinutes
        if (sleepMinutes == null || !sleepMinutes.isFinite()) return missingReason(score)
        val slept = Format.formatDuration(sleepMinutes)
        if (needMinutes != null && needMinutes.isFinite() && needMinutes > 0) {
            return if (sleepMinutes >= needMinutes) {
                "$slept, potreba spánku pokrytá"
            } else {
                "$slept z potrebných ${Format.formatDuration(needMinutes)}"
            }
        }
        if (scoreValue(score) == null) return "$slept · ${missingReason(score)}"
        return slept
    }

    private fun activityReason(day: Day, score: Score?): String {
        if (scoreValue(score) == null) return missingReason(score)
        val parts = ArrayList<String>()
        val steps = day.steps
        if (steps != null && steps.isFinite()) parts.add("${Format.formatInt(steps)} krokov")
        val workout = day.workouts.lastOrNull()
        if (workout != null) {
            parts.add(
                "${Format.workoutLabel(workout.type).lowercase()} ${Format.formatDuration(workout.durationS?.div(60))}",
            )
        } else {
            val weakest = componentExtremes(score).weakest
            if (weakest != null && weakest.second < 60) parts.add("slabšie: ${componentLabel(weakest.first)}")
        }
        return parts.joinToString(" · ").ifEmpty { "z krokov, tepu a tréningov" }
    }

    /**
     * Readiness, Sleep Performance and Activity of [day], each with its one-line reason.
     * [previous] is the day before; its sleep need is what last night is measured against.
     */
    fun subScores(day: Day, previous: Day?): List<SubScore> {
        val scores = day.scores
        val readiness = scores?.readiness
        val sleep = scores?.sleepPerformance
        val activity = scores?.activity
        val need = previous?.scores?.sleepNeedMinutes
        return listOf(
            SubScore(
                key = "readiness",
                label = SCORE_NAMES.getValue("readiness"),
                value = scoreValue(readiness),
                display = formatScore(readiness),
                band = readinessBand(scoreValue(readiness)),
                reason = readinessReason(day, readiness),
            ),
            SubScore(
                key = "sleepPerformance",
                label = SCORE_NAMES.getValue("sleepPerformance"),
                value = scoreValue(sleep),
                display = formatScore(sleep),
                band = sleepPerformanceBand(scoreValue(sleep)),
                reason = sleepReason(day, sleep, need),
            ),
            SubScore(
                key = "activity",
                label = SCORE_NAMES.getValue("activity"),
                value = scoreValue(activity),
                display = formatScore(activity),
                band = activityBand(scoreValue(activity)),
                reason = activityReason(day, activity),
            ),
        )
    }

    // -----------------------------------------------------------------------------------
    // Evening: when to go to bed

    private const val LATENCY_MINUTES = 15.0

    /**
     * Median wake-up time, in minutes since local midnight, over the last [nights] nights
     * before [forDay] that fall on the same kind of day (school day or weekend) as [forDay].
     */
    fun typicalWake(days: List<Day>, timeZone: String, forDay: String, nights: Int = 28): Double? {
        val weekend = Dates.weekdayIndex(forDay) >= 5
        val from = Dates.addDays(forDay, -nights)
        val wakes = days
            .filter { it.day >= from && it.day < forDay && it.sleepEnd != null }
            .filter { (Dates.weekdayIndex(it.day) >= 5) == weekend }
            .map { Dates.localMinutesOfDay(it.sleepEnd!!, timeZone) }
            .sorted()
        if (wakes.isEmpty()) return null
        val middle = wakes.size / 2
        return if (wakes.size % 2 == 1) {
            wakes[middle].toDouble()
        } else {
            jsRound((wakes[middle - 1] + wakes[middle]) / 2.0)
        }
    }

    /** Time to fall asleep, minutes since midnight, to sleep [needMinutes] before [wakeMinutes]. */
    fun bedtimeFor(needMinutes: Double?, wakeMinutes: Double?): Double? {
        if (needMinutes == null || !needMinutes.isFinite() || wakeMinutes == null || !wakeMinutes.isFinite()) return null
        val minutes = jsRound(wakeMinutes - needMinutes - LATENCY_MINUTES)
        // Round to five minutes so it reads as advice, not a measurement.
        val rounded = jsRound(minutes / 5) * 5
        return Math.floorMod(rounded.toLong(), 1440L).toDouble()
    }

    // -----------------------------------------------------------------------------------
    // Headline sentences

    private const val NOT_SCORED = "Skóre za dnešok ešte nie je spočítané. Nižšie je, čo ukazujú posledné dni."

    /** The morning sentence above "čo si všimnúť". Observations, not medical advice. */
    fun morningSummary(scores: DayScores?): String {
        if (scores == null) return NOT_SCORED
        if (scores.nightSignal.level == "red") {
            return "Nočný tep je zvýšený, telo môže potrebovať oddych. Dnes radšej ľahší deň."
        }
        val readiness = scoreValue(scores.readiness)
        val sleep = scoreValue(scores.sleepPerformance)
        if (readiness == null && sleep == null) {
            return "Na skóre za túto noc zatiaľ chýbajú dáta. Nižšie je, čo ukazujú posledné dni."
        }
        if (sleep != null && sleep < 70) {
            return "Spal si menej, než telo potrebovalo. Dnes pomôže ubrať zo záťaže a ísť spať skôr."
        }
        if (readiness != null && readiness < 70) {
            return "Telo sa ešte zotavuje. Ľahší deň mu pomôže."
        }
        if ((readiness ?: 0.0) >= 85 && (sleep ?: 0.0) >= 85) {
            return "Dobrá noc za tebou a telo je oddýchnuté. Dnes máš priestor aj na dlhší pohyb."
        }
        return "Noc bola v poriadku a pripravenosť je dobrá. Bežný deň by mal sedieť."
    }

    /** The evening sentence: the day's strain and what tonight's sleep should cover. */
    fun eveningSummary(scores: DayScores?, bedtime: Double?): String {
        if (scores == null) return NOT_SCORED
        val parts = ArrayList<String>()
        val band = strainBand(scores.strain)
        if (band != null) parts.add("Dnešný strain je ${formatStrain(scores.strain)}, ${band.label}.")
        val need = scores.sleepNeedMinutes
        if (need != null && need.isFinite()) {
            val whenText = if (bedtime == null) "" else ", takže je dobré zaspať okolo ${Format.formatTimeOfDay(bedtime)}"
            parts.add("Na dnešnú noc potrebuješ asi ${Format.formatDuration(need)} spánku$whenText.")
        }
        return parts.joinToString(" ").ifEmpty { "Na večerné skóre zatiaľ chýbajú dáta." }
    }
}
