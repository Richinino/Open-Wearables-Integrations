package sk.zdravie.app.ui

import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.roundToLong
import sk.zdravie.app.model.DaySummary

private val Slovak = Locale.forLanguageTag("sk-SK")
private val LongDate = DateTimeFormatter.ofPattern("EEEE d. MMMM yyyy", Slovak)
private val ShortDate = DateTimeFormatter.ofPattern("d. M.", Slovak)
private val SyncDate = DateTimeFormatter.ofPattern("d. M. yyyy, HH:mm", Slovak)

internal fun parseDay(value: String): LocalDate? = runCatching { LocalDate.parse(value) }.getOrNull()
internal fun dayLabel(value: String): String = parseDay(value)?.format(LongDate) ?: value
internal fun shortDay(value: String): String = parseDay(value)?.format(ShortDate) ?: value
internal fun finiteValue(value: Double?): Double? = value?.takeIf { it.isFinite() && it >= 0.0 }

internal fun whole(value: Double?): String = finiteValue(value)?.let {
    NumberFormat.getIntegerInstance(Slovak).format(it.roundToLong())
} ?: "—"

internal fun steps(value: Long?): String = value?.takeIf { it >= 0L }?.let {
    NumberFormat.getIntegerInstance(Slovak).format(it)
} ?: "—"

internal fun decimal(value: Double?, places: Int = 1): String = finiteValue(value)?.let {
    NumberFormat.getNumberInstance(Slovak).apply {
        minimumFractionDigits = 0
        maximumFractionDigits = places
    }.format(it)
} ?: "—"

internal fun duration(minutes: Double?): String = finiteValue(minutes)?.let {
    val total = it.roundToLong()
    if (total < 60) "$total min" else "${total / 60} h ${total % 60} min"
} ?: "—"

internal fun syncLabel(value: String?): String? {
    if (value.isNullOrBlank()) return null
    val instant = runCatching { Instant.parse(value) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(value).toInstant() }.getOrNull()
        ?: value.toLongOrNull()?.let { runCatching { Instant.ofEpochMilli(it) }.getOrNull() }
    return instant?.atZone(ZoneId.systemDefault())?.format(SyncDate)
}

internal fun workoutTime(value: String, timezone: String?): String = runCatching {
    val zone = ZoneId.of(requireNotNull(timezone))
    Instant.parse(value).atZone(zone).format(DateTimeFormatter.ofPattern("HH:mm", Slovak))
}.getOrDefault("Čas nie je dostupný")

internal fun dayAge(day: DaySummary, now: Instant = Instant.now()): Long? = runCatching {
    val zone = ZoneId.of(requireNotNull(day.timezone))
    ChronoUnit.DAYS.between(LocalDate.parse(day.day), now.atZone(zone).toLocalDate())
}.getOrNull()

internal fun activeMinutesLabel(day: DaySummary): String = finiteValue(day.activeMinutes)?.let {
    "≈ ${whole(it)} min"
} ?: "—"

internal fun sleepScoreLabel(day: DaySummary): String = finiteValue(day.sleepScore)?.let {
    "${if (day.sleepScoreEstimated) "≈ " else ""}${whole(it)} / 100"
} ?: "—"

internal enum class HistoryMetric(val title: String, val unit: String) {
    STEPS("Kroky", "krokov"),
    SLEEP("Spánok", "hodín"),
    READINESS("Pripravenosť ≈", "bodov zo 100"),
    RESTING_HR("Pokojový tep", "úderov/min"),
    ;

    fun value(day: DaySummary): Double? = when (this) {
        STEPS -> day.steps?.takeIf { it >= 0 }?.toDouble()
        SLEEP -> finiteValue(day.sleepMinutes)?.div(60)
        READINESS -> finiteValue(day.readiness)
        RESTING_HR -> finiteValue(day.restingHr)
    }

    fun label(day: DaySummary?): String {
        if (day == null) return "—"
        return when (this) {
            STEPS -> steps(day.steps)
            SLEEP -> duration(day.sleepMinutes)
            READINESS -> finiteValue(day.readiness)?.let { "≈ ${whole(it)} / 100" } ?: "—"
            RESTING_HR -> finiteValue(day.restingHr)?.let { "${restingHrValue(day)} úderov/min" } ?: "—"
        }
    }
}

internal fun restingHrValue(day: DaySummary): String = finiteValue(day.restingHr)?.let {
    "${if (day.restingHrSource == "estimated" || day.restingHrSource == "derived") "≈ " else ""}${whole(it)}"
} ?: "—"
