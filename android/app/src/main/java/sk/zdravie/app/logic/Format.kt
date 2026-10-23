package sk.zdravie.app.logic

import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import kotlin.math.abs
import kotlin.math.floor

/**
 * Slovak display strings, ported 1:1 from web/src/lib/format.ts. Nothing here throws: a missing or
 * unusable value becomes [DASH]. Separators are written explicitly (no JVM locale data) so the
 * output is identical on every machine and Android version.
 */
object Format {
    const val DASH = "–"

    /** Thousands separator printed by Intl for sk-SK: no-break space U+00A0. */
    const val GROUP = " "

    private const val MINUS = "−"
    private const val GENERIC_WORKOUT = "Tréning"

    private val WEEKDAYS_SHORT = listOf("po", "ut", "st", "št", "pi", "so", "ne")
    private val WEEKDAYS_LONG = listOf(
        "pondelok", "utorok", "streda", "štvrtok", "piatok", "sobota", "nedeľa",
    )
    private val MONTHS = listOf(
        "január", "február", "marec", "apríl", "máj", "jún",
        "júl", "august", "september", "október", "november", "december",
    )
    private val MONTHS_GENITIVE = listOf(
        "januára", "februára", "marca", "apríla", "mája", "júna",
        "júla", "augusta", "septembra", "októbra", "novembra", "decembra",
    )

    private val WORKOUT_LABELS = mapOf(
        "running" to "Beh",
        "trail_running" to "Trailový beh",
        "treadmill" to "Bežecký pás",
        "walking" to "Chôdza",
        "hiking" to "Turistika",
        "cycling" to "Bicykel",
        "mountain_biking" to "Horský bicykel",
        "indoor_cycling" to "Stacionárny bicykel",
        "swimming" to "Plávanie",
        "pool_swimming" to "Plávanie",
        "open_water_swimming" to "Plávanie vonku",
        "strength_training" to "Silový tréning",
        "cardio_training" to "Kardio",
        "yoga" to "Joga",
        "pilates" to "Pilates",
        "stretching" to "Strečing",
        "soccer" to "Futbal",
        "basketball" to "Basketbal",
        "volleyball" to "Volejbal",
        "tennis" to "Tenis",
        "badminton" to "Bedminton",
        "table_tennis" to "Stolný tenis",
        "hockey" to "Hokej",
        "floorball" to "Florbal",
        "rowing" to "Veslovanie",
        "dance" to "Tanec",
        "alpine_skiing" to "Lyžovanie",
        "downhill_skiing" to "Lyžovanie",
        "cross_country_skiing" to "Bežky",
        "snowboarding" to "Snowboard",
        "ice_skating" to "Korčuľovanie",
        "rock_climbing" to "Lezenie",
        "indoor_climbing" to "Lezenie",
        "bouldering" to "Lezenie",
        "generic" to GENERIC_WORKOUT,
        "other" to GENERIC_WORKOUT,
        "sport" to GENERIC_WORKOUT,
    )

    private val STEPS_SOURCE_LABELS = mapOf(
        "samsung_health_total" to "Samsung Health",
        "samsung_hourly" to "Samsung (hodinové)",
        "phone" to "Telefón",
    )

    private fun isNumber(value: Double?): Boolean = value != null && value.isFinite()

    private fun pad(value: Int): String = value.toString().padStart(2, '0')

    /** JS Math.round: halves round toward positive infinity. */
    private fun jsRound(value: Double): Double = floor(value + 0.5)

    /** "snake_case" -> "Snake case", for values the tables above do not know. */
    private fun humanize(text: String): String {
        val words = text.replace(Regex("_+"), " ").trim()
        return words.replaceFirstChar { it.uppercase() }
    }

    private fun groupDigits(digits: String): String {
        val out = StringBuilder()
        for ((index, ch) in digits.withIndex()) {
            if (index > 0 && (digits.length - index) % 3 == 0) out.append(GROUP)
            out.append(ch)
        }
        return out.toString()
    }

    private class DayParts(val year: Int, val month: Int, val date: Int, val weekday: Int)

    private fun dayParts(day: String): DayParts? {
        if (!Dates.isValidDay(day)) return null
        return DayParts(
            year = day.substring(0, 4).toInt(),
            month = day.substring(5, 7).toInt(),
            date = day.substring(8, 10).toInt(),
            weekday = Dates.weekdayIndex(day),
        )
    }

    fun formatInt(value: Double?): String {
        if (value == null || !isNumber(value)) return DASH
        val rounded = jsRound(value)
        // Folds negative zero into zero so a small negative never prints as "-0".
        if (rounded == 0.0) return "0"
        val digits = BigDecimal(abs(rounded)).toBigInteger().toString()
        return (if (rounded < 0) "-" else "") + groupDigits(digits)
    }

    fun formatDecimal(value: Double?, digits: Int = 1): String {
        if (value == null || !isNumber(value)) return DASH
        val scaled = BigDecimal.valueOf(abs(value)).setScale(digits, RoundingMode.HALF_UP).toPlainString()
        val integerPart = scaled.substringBefore('.')
        val fraction = if (scaled.contains('.')) "," + scaled.substringAfter('.') else ""
        // Intl prints a leading hyphen for negatives, including negative zero.
        val negative = value < 0 || (value == 0.0 && 1.0 / value < 0)
        return (if (negative) "-" else "") + groupDigits(integerPart) + fraction
    }

    fun formatDuration(minutes: Double?): String {
        if (minutes == null || !isNumber(minutes)) return DASH
        val total = maxOf(0.0, jsRound(minutes)).toLong()
        val hours = total / 60
        val rest = total % 60
        if (hours == 0L) return "$rest min"
        return if (rest == 0L) "$hours h" else "$hours h $rest min"
    }

    /** Tight duration for legends and small tiles: "1 h 30", "2 h", "8 min". */
    fun formatDurationCompact(minutes: Double?): String {
        if (minutes == null || !isNumber(minutes)) return DASH
        val total = maxOf(0.0, jsRound(minutes)).toLong()
        val hours = total / 60
        val rest = total % 60
        if (hours == 0L) return "$rest min"
        return if (rest == 0L) "$hours h" else "$hours h ${pad(rest.toInt())}"
    }

    /** Clock time from minutes since local midnight; values outside one day wrap around. */
    fun formatTimeOfDay(minutes: Double?): String {
        if (minutes == null || !isNumber(minutes)) return DASH
        val ofDay = Math.floorMod(jsRound(minutes).toLong(), 1440L).toInt()
        return "${pad(ofDay / 60)}:${pad(ofDay % 60)}"
    }

    fun formatDurationShort(minutes: Double?): String {
        if (minutes == null || !isNumber(minutes)) return DASH
        val total = maxOf(0.0, jsRound(minutes)).toLong()
        return "${total / 60}:${pad((total % 60).toInt())}"
    }

    fun formatDistance(meters: Double?): String {
        if (meters == null || !isNumber(meters)) return DASH
        if (jsRound(meters) < 1000) return "${formatInt(meters)} m"
        return "${formatDecimal(meters / 1000, 1)} km"
    }

    fun formatKcal(value: Double?): String =
        if (value != null && isNumber(value)) "${formatInt(value)} kcal" else DASH

    fun formatBpm(value: Double?): String =
        if (value != null && isNumber(value)) "${formatInt(value)} bpm" else DASH

    fun formatDay(day: String): String {
        val parts = dayParts(day) ?: return DASH
        return "${WEEKDAYS_SHORT[parts.weekday]} ${parts.date}. ${parts.month}."
    }

    fun formatDayMonth(day: String): String {
        val parts = dayParts(day) ?: return DASH
        return "${parts.date}. ${parts.month}."
    }

    fun formatDayLong(day: String): String {
        val parts = dayParts(day) ?: return DASH
        return "${WEEKDAYS_LONG[parts.weekday]} ${parts.date}. ${MONTHS_GENITIVE[parts.month - 1]} ${parts.year}"
    }

    fun formatMonth(day: String): String {
        val parts = dayParts(day) ?: return DASH
        return "${MONTHS[parts.month - 1]} ${parts.year}"
    }

    fun formatClock(instant: Instant?, timeZone: String): String {
        if (instant == null) return DASH
        return try {
            val minutes = Dates.localMinutesOfDay(instant, timeZone)
            "${pad(minutes / 60)}:${pad(minutes % 60)}"
        } catch (_: Exception) {
            DASH
        }
    }

    /** Clock time from the minutes-from-noon convention described in metrics.ts. */
    fun formatClockMinutes(minutesFromNoon: Double?): String {
        if (minutesFromNoon == null || !isNumber(minutesFromNoon)) return DASH
        val ofDay = Math.floorMod(jsRound(minutesFromNoon).toLong() + 720L, 1440L).toInt()
        return "${pad(ofDay / 60)}:${pad(ofDay % 60)}"
    }

    /**
     * Elapsed time, not calendar days: "včera" means 24 to 48 hours ago. From two days on
     * the noun is always "dňami", the instrumental plural that follows "pred".
     */
    fun formatRelative(instant: Instant?, now: Instant): String {
        if (instant == null) return DASH
        val minutes = Math.floorDiv(now.toEpochMilli() - instant.toEpochMilli(), 60_000L)
        if (minutes < 1) return "práve teraz"
        if (minutes < 60) return "pred $minutes min"
        val hours = minutes / 60
        if (hours < 24) return "pred $hours h"
        val days = hours / 24
        return if (days == 1L) "včera" else "pred ${formatInt(days.toDouble())} dňami"
    }

    fun formatChange(fraction: Double?): String {
        if (fraction == null || !isNumber(fraction)) return DASH
        val percent = jsRound(fraction * 100)
        if (percent == 0.0) return "0 %"
        return "${if (percent > 0) "+" else MINUS}${formatInt(abs(percent))} %"
    }

    /**
     * Slovak noun form for a count: 1 -> one, 2-4 -> few, otherwise many (also 0 and fractions).
     */
    fun plural(count: Double, one: String, few: String, many: String): String {
        if (count == 1.0) return one
        if (count == floor(count) && count >= 2 && count <= 4) return few
        return many
    }

    fun plural(count: Int, one: String, few: String, many: String): String =
        plural(count.toDouble(), one, few, many)

    /** Marks an estimate. A missing value stays a plain dash. */
    fun approx(text: String): String = if (text == DASH) DASH else "≈ $text"

    fun workoutLabel(type: String): String {
        val key = type.trim().lowercase()
        if (key.isEmpty()) return GENERIC_WORKOUT
        return WORKOUT_LABELS[key] ?: humanize(type)
    }

    fun stepsSourceLabel(source: String?): String {
        if (source.isNullOrEmpty()) return DASH
        return STEPS_SOURCE_LABELS[source] ?: humanize(source)
    }
}
