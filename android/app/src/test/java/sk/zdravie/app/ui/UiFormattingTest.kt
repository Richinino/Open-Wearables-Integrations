package sk.zdravie.app.ui

import org.junit.Assert.*
import org.junit.Test
import sk.zdravie.app.model.DaySummary
import java.time.Instant
import java.util.TimeZone

class UiFormattingTest {
    private fun day() = DaySummary("2026-10-21", true, null, null, 24.0, null, 82.0,
        null, null, null, null, null, emptyList(), timezone = "Europe/Bratislava")

    @Test fun activeTimeAlwaysIdentifiesItsEstimateAndPreservesMissingValues() {
        assertEquals("≈ 24 min", activeMinutesLabel(day()))
        assertEquals("≈ 0 min", activeMinutesLabel(day().copy(activeMinutes = 0.0)))
        assertEquals("—", activeMinutesLabel(day().copy(activeMinutes = null)))
        assertEquals("—", activeMinutesLabel(day().copy(activeMinutes = Double.NaN)))
    }

    @Test fun sleepScoreMarksOnlyTheComputedSamsungFallback() {
        assertEquals("82 / 100", sleepScoreLabel(day()))
        assertEquals("≈ 82 / 100", sleepScoreLabel(day().copy(sleepScoreEstimated = true)))
        assertEquals("—", sleepScoreLabel(day().copy(sleepScore = null, sleepScoreEstimated = true)))
    }

    @Test fun workoutClockUsesTheDataTimezoneWhileTravelingWithoutChangingItsDay() {
        val previous = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"))
            val day = day()
            val start = "2026-10-20T23:30:00Z"
            assertEquals("01:30", workoutTime(start, day.timezone))
            assertEquals("19:30", workoutTime(start, "America/New_York"))
            assertEquals("2026-10-21", day.day)
        } finally { TimeZone.setDefault(previous) }
    }

    @Test fun missingOrMalformedWorkoutTimezoneDoesNotFallBackToThePhone() {
        assertEquals("Čas nie je dostupný", workoutTime("2026-10-20T23:30:00Z", null))
        assertEquals("Čas nie je dostupný", workoutTime("2026-10-20T23:30:00Z", "invalid"))
        assertEquals("Čas nie je dostupný", workoutTime("invalid", "Europe/Bratislava"))
    }

    @Test fun ageOfTheDataDayUsesItsOwnTimezoneAtMidnight() {
        val now = Instant.parse("2026-10-22T00:30:00Z")
        assertEquals(1L, dayAge(day(), now))
        assertEquals(0L, dayAge(day().copy(timezone = "America/New_York"), now))
        assertNull(dayAge(day().copy(timezone = null), now))
        assertNull(dayAge(day().copy(timezone = "invalid"), now))
    }
}
