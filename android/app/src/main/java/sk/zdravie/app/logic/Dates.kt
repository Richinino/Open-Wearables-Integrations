package sk.zdravie.app.logic

import java.time.DateTimeException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Calendar days are "YYYY-MM-DD" strings. Port of web/src/lib/dates.ts: all arithmetic runs on
 * plain calendar dates, so daylight-saving changes cannot shift or duplicate a day.
 * Invalid input throws [IllegalArgumentException] where the web throws a RangeError.
 */
object Dates {
    private val DAY_PATTERN = Regex("""(\d{4})-(\d{2})-(\d{2})""")

    private fun parseDay(day: String): LocalDate? {
        val match = DAY_PATTERN.matchEntire(day) ?: return null
        val year = match.groupValues[1].toInt()
        val month = match.groupValues[2].toInt()
        val date = match.groupValues[3].toInt()
        // The web maps years below 100 to 19xx and then rejects the day; do the same.
        if (year < 100) return null
        return try {
            LocalDate.of(year, month, date)
        } catch (_: DateTimeException) {
            null
        }
    }

    private fun toDate(day: String): LocalDate =
        parseDay(day) ?: throw IllegalArgumentException("Invalid day: $day")

    fun isValidDay(value: String): Boolean = parseDay(value) != null

    fun addDays(day: String, n: Int): String = toDate(day).plusDays(n.toLong()).toString()

    /** Whole days from [from] to [to]; negative when [to] is earlier. */
    fun diffDays(from: String, to: String): Int =
        (toDate(to).toEpochDay() - toDate(from).toEpochDay()).toInt()

    /** Every day from [from] to [to], both included; empty when [from] is after [to]. */
    fun dateRange(from: String, to: String): List<String> {
        val end = toDate(to)
        val days = ArrayList<String>()
        var current = toDate(from)
        while (!current.isAfter(end)) {
            days.add(current.toString())
            current = current.plusDays(1)
        }
        return days
    }

    fun todayIn(timeZone: String, now: Instant = Instant.now()): String = localDay(now, timeZone)

    /** Calendar day of an instant as seen in [timeZone]. */
    fun localDay(instant: Instant, timeZone: String): String =
        instant.atZone(ZoneId.of(timeZone)).toLocalDate().toString()

    /** Minutes since local midnight of an instant as seen in [timeZone], 0..1439. */
    fun localMinutesOfDay(instant: Instant, timeZone: String): Int {
        val time = instant.atZone(ZoneId.of(timeZone)).toLocalTime()
        return time.hour * 60 + time.minute
    }

    /** 0 = Monday ... 6 = Sunday. */
    fun weekdayIndex(day: String): Int = toDate(day).dayOfWeek.value - 1
}
