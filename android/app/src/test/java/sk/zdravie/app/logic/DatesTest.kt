package sk.zdravie.app.logic

import java.time.Instant
import java.time.OffsetDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class DatesTest {
    private val zone = "Europe/Bratislava"
    private val spring = "2026-03-29"
    private val autumn = "2026-10-25"

    private fun at(iso: String): Instant = Instant.parse(iso)

    @Test
    fun isValidDayAcceptsRealDays() {
        assertTrue(Dates.isValidDay("2026-10-13"))
        assertTrue(Dates.isValidDay("2028-02-29"))
        assertTrue(Dates.isValidDay("2026-12-31"))
    }

    @Test
    fun isValidDayRejectsImpossibleOrMalformed() {
        val values = listOf(
            "", "2026-02-29", "2026-02-30", "2026-13-01", "2026-00-10", "2026-04-31",
            "2026-1-5", "26-01-05", "2026/01/05", "2026-01-05T00:00:00Z", " 2026-01-05", "dnes",
            "2026-01-05\n",
        )
        for (value in values) assertFalse(value, Dates.isValidDay(value))
    }

    @Test
    fun addDaysCrossesBoundaries() {
        assertEquals("2026-02-01", Dates.addDays("2026-01-31", 1))
        assertEquals("2026-02-28", Dates.addDays("2026-03-01", -1))
        assertEquals("2028-02-29", Dates.addDays("2028-02-28", 1))
        assertEquals("2028-02-29", Dates.addDays("2028-03-01", -1))
        assertEquals("2027-01-01", Dates.addDays("2026-12-31", 1))
        assertEquals("2026-12-31", Dates.addDays("2027-01-01", -1))
        assertEquals("2026-10-13", Dates.addDays("2026-10-13", 0))
        assertEquals("2027-10-13", Dates.addDays("2026-10-13", 365))
    }

    @Test
    fun addDaysNeitherSkipsNorRepeatsAcrossClockChanges() {
        assertEquals(spring, Dates.addDays("2026-03-28", 1))
        assertEquals("2026-03-30", Dates.addDays(spring, 1))
        assertEquals(spring, Dates.addDays("2026-03-30", -1))
        assertEquals(autumn, Dates.addDays("2026-10-24", 1))
        assertEquals("2026-10-26", Dates.addDays(autumn, 1))
        assertEquals(autumn, Dates.addDays("2026-10-26", -1))
    }

    @Test
    fun addDaysThrowsOnInvalidDay() {
        try {
            Dates.addDays("2026-02-30", 1)
            fail("expected IllegalArgumentException")
        } catch (expected: IllegalArgumentException) {
            // RangeError on the web
        }
    }

    @Test
    fun diffDaysReturnsToMinusFrom() {
        assertEquals(0, Dates.diffDays("2026-10-13", "2026-10-13"))
        assertEquals(7, Dates.diffDays("2026-10-13", "2026-10-20"))
        assertEquals(-7, Dates.diffDays("2026-10-20", "2026-10-13"))
        assertEquals(1, Dates.diffDays("2026-12-31", "2027-01-01"))
        assertEquals(365, Dates.diffDays("2026-01-01", "2027-01-01"))
        assertEquals(366, Dates.diffDays("2028-01-01", "2029-01-01"))
    }

    @Test
    fun diffDaysCountsWholeDaysAcrossClockChanges() {
        assertEquals(2, Dates.diffDays("2026-03-28", "2026-03-30"))
        assertEquals(2, Dates.diffDays("2026-10-24", "2026-10-26"))
        assertEquals(245, Dates.diffDays("2026-03-01", "2026-11-01"))
    }

    @Test
    fun dateRangeIncludesBothEnds() {
        assertEquals(
            listOf("2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"),
            Dates.dateRange("2026-02-27", "2026-03-02"),
        )
        assertEquals(listOf("2026-10-13"), Dates.dateRange("2026-10-13", "2026-10-13"))
    }

    @Test
    fun dateRangeIsEmptyWhenFromIsAfterTo() {
        assertEquals(emptyList<String>(), Dates.dateRange("2026-10-14", "2026-10-13"))
    }

    @Test
    fun dateRangeHasOneEntryPerDayAroundClockChanges() {
        assertEquals(listOf("2026-03-28", spring, "2026-03-30"), Dates.dateRange("2026-03-28", "2026-03-30"))
        assertEquals(listOf("2026-10-24", autumn, "2026-10-26"), Dates.dateRange("2026-10-24", "2026-10-26"))
        assertEquals(365, Dates.dateRange("2026-01-01", "2026-12-31").size)
    }

    @Test
    fun todayInUsesTheZoneCalendarNotUtc() {
        assertEquals("2026-07-15", Dates.todayIn(zone, at("2026-07-14T22:30:00Z")))
        assertEquals("2026-01-14", Dates.todayIn(zone, at("2026-01-14T22:30:00Z")))
        assertEquals("2027-01-01", Dates.todayIn(zone, at("2026-12-31T23:00:00Z")))
        assertEquals("2026-07-14", Dates.todayIn("UTC", at("2026-07-14T22:30:00Z")))
    }

    @Test
    fun todayInIsRightOnBothClockChangeDays() {
        assertEquals("2026-03-28", Dates.todayIn(zone, at("2026-03-28T22:59:00Z")))
        assertEquals(spring, Dates.todayIn(zone, at("2026-03-28T23:00:00Z")))
        assertEquals(spring, Dates.todayIn(zone, at("2026-03-29T21:59:00Z")))
        assertEquals("2026-03-30", Dates.todayIn(zone, at("2026-03-29T22:00:00Z")))

        assertEquals("2026-10-24", Dates.todayIn(zone, at("2026-10-24T21:59:00Z")))
        assertEquals(autumn, Dates.todayIn(zone, at("2026-10-24T22:00:00Z")))
        assertEquals(autumn, Dates.todayIn(zone, at("2026-10-25T22:59:00Z")))
        assertEquals("2026-10-26", Dates.todayIn(zone, at("2026-10-25T23:00:00Z")))
    }

    @Test
    fun todayInDefaultsToTheCurrentTime() {
        assertTrue(Dates.isValidDay(Dates.todayIn(zone)))
    }

    @Test
    fun localDaySwitchesAtLocalMidnightInSummerTime() {
        assertEquals("2026-07-14", Dates.localDay(at("2026-07-14T21:59:59Z"), zone))
        assertEquals("2026-07-15", Dates.localDay(at("2026-07-14T22:00:00Z"), zone))
    }

    @Test
    fun localDaySwitchesAtLocalMidnightInWinterTime() {
        assertEquals("2026-01-14", Dates.localDay(at("2026-01-14T22:59:59Z"), zone))
        assertEquals("2026-01-15", Dates.localDay(at("2026-01-14T23:00:00Z"), zone))
    }

    @Test
    fun localDayKeepsTheDayAcrossTheSpringChange() {
        assertEquals("2026-03-28", Dates.localDay(at("2026-03-28T22:59:00Z"), zone))
        assertEquals(spring, Dates.localDay(at("2026-03-28T23:00:00Z"), zone))
        assertEquals(spring, Dates.localDay(at("2026-03-29T00:59:00Z"), zone))
        assertEquals(spring, Dates.localDay(at("2026-03-29T01:00:00Z"), zone))
        assertEquals(spring, Dates.localDay(at("2026-03-29T21:59:00Z"), zone))
        assertEquals("2026-03-30", Dates.localDay(at("2026-03-29T22:00:00Z"), zone))
    }

    @Test
    fun localDayKeepsTheDayAcrossTheAutumnChange() {
        assertEquals("2026-10-24", Dates.localDay(at("2026-10-24T21:59:00Z"), zone))
        assertEquals(autumn, Dates.localDay(at("2026-10-24T22:00:00Z"), zone))
        assertEquals(autumn, Dates.localDay(at("2026-10-25T00:59:00Z"), zone))
        assertEquals(autumn, Dates.localDay(at("2026-10-25T01:00:00Z"), zone))
        assertEquals(autumn, Dates.localDay(at("2026-10-25T22:59:00Z"), zone))
        assertEquals("2026-10-26", Dates.localDay(at("2026-10-25T23:00:00Z"), zone))
    }

    @Test
    fun localDayUnderstandsOtherOffsetsAndTheZSuffix() {
        val offset = OffsetDateTime.parse("2026-07-15T00:30:00+02:00").toInstant()
        assertEquals("2026-07-15", Dates.localDay(offset, zone))
        assertEquals("2026-07-15", Dates.localDay(at("2026-07-14T22:30:00Z"), zone))
    }

    @Test
    fun localMinutesCountsFromLocalMidnightOnEitherSideOfIt() {
        assertEquals(1439, Dates.localMinutesOfDay(at("2026-07-14T21:59:00Z"), zone))
        assertEquals(0, Dates.localMinutesOfDay(at("2026-07-14T22:00:00Z"), zone))
        assertEquals(1, Dates.localMinutesOfDay(at("2026-07-14T22:01:00Z"), zone))
        assertEquals(1439, Dates.localMinutesOfDay(at("2026-01-14T22:59:00Z"), zone))
        assertEquals(0, Dates.localMinutesOfDay(at("2026-01-14T23:00:00Z"), zone))
    }

    @Test
    fun localMinutesDropsSeconds() {
        assertEquals(22 * 60 + 41, Dates.localMinutesOfDay(at("2026-07-14T20:41:59Z"), zone))
    }

    @Test
    fun localMinutesJumpsOnSpringChange() {
        assertEquals(119, Dates.localMinutesOfDay(at("2026-03-29T00:59:00Z"), zone))
        assertEquals(180, Dates.localMinutesOfDay(at("2026-03-29T01:00:00Z"), zone))
        assertEquals(7 * 60, Dates.localMinutesOfDay(at("2026-03-29T05:00:00Z"), zone))
    }

    @Test
    fun localMinutesRepeatsTheHourOnAutumnChange() {
        assertEquals(120, Dates.localMinutesOfDay(at("2026-10-25T00:00:00Z"), zone))
        assertEquals(179, Dates.localMinutesOfDay(at("2026-10-25T00:59:00Z"), zone))
        assertEquals(120, Dates.localMinutesOfDay(at("2026-10-25T01:00:00Z"), zone))
        assertEquals(179, Dates.localMinutesOfDay(at("2026-10-25T01:59:00Z"), zone))
        assertEquals(7 * 60, Dates.localMinutesOfDay(at("2026-10-25T06:00:00Z"), zone))
    }

    @Test
    fun localMinutesStaysWithinADay() {
        val start = at("2026-10-25T00:00:00Z")
        var minute = 0
        while (minute < 1440) {
            val value = Dates.localMinutesOfDay(start.plusSeconds(minute * 60L), zone)
            assertTrue(value in 0..1439)
            minute += 7
        }
    }

    @Test
    fun localMinutesUsesDatasetZone() {
        val instant = at("2026-07-14T22:30:00Z")
        assertEquals(30, Dates.localMinutesOfDay(instant, "Europe/Bratislava"))
        assertEquals(18 * 60 + 30, Dates.localMinutesOfDay(instant, "America/New_York"))
        assertEquals("2026-07-15", Dates.localDay(instant, "Europe/Bratislava"))
        assertEquals("2026-07-14", Dates.localDay(instant, "America/New_York"))
    }

    @Test
    fun weekdayIndexStartsTheWeekOnMonday() {
        assertEquals(0, Dates.weekdayIndex("2026-10-12"))
        assertEquals(1, Dates.weekdayIndex("2026-10-13"))
        assertEquals(5, Dates.weekdayIndex("2026-10-17"))
        assertEquals(6, Dates.weekdayIndex("2026-10-18"))
        assertEquals(0, Dates.weekdayIndex("2026-10-19"))
    }

    @Test
    fun weekdayIndexIsSundayOnBothClockChangeDays() {
        assertEquals(6, Dates.weekdayIndex(spring))
        assertEquals(6, Dates.weekdayIndex(autumn))
    }
}
