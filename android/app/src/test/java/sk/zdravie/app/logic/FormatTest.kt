package sk.zdravie.app.logic

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class FormatTest {
    private val zone = "Europe/Bratislava"
    private val minus = "−"

    // Slovak thousands separator as printed by Intl on the web: U+00A0.
    private val group = " "
    private val missing = listOf<Double?>(null, Double.NaN, Double.POSITIVE_INFINITY)
    private val dash = Format.DASH

    @Test
    fun thousandsSeparatorIsNoBreakSpace() {
        assertEquals(" ", Format.GROUP)
    }

    @Test
    fun formatIntGroupsThousands() {
        assertEquals("12${group}345", Format.formatInt(12345.0))
        assertEquals("2${group}130", Format.formatInt(2130.0))
        assertEquals("1${group}234${group}567", Format.formatInt(1234567.0))
        assertEquals("999", Format.formatInt(999.0))
        assertEquals("0", Format.formatInt(0.0))
    }

    @Test
    fun formatIntRounds() {
        assertEquals("52", Format.formatInt(52.4))
        assertEquals("53", Format.formatInt(52.5))
        assertEquals("0", Format.formatInt(-0.2))
    }

    @Test
    fun formatIntDashForMissing() {
        for (v in missing) assertEquals(dash, Format.formatInt(v))
    }

    @Test
    fun formatDecimalCommaAndOneDigit() {
        assertEquals("8,9", Format.formatDecimal(8.94))
        assertEquals("9,0", Format.formatDecimal(8.96))
        assertEquals("8,0", Format.formatDecimal(8.0))
        assertEquals("0,0", Format.formatDecimal(0.0))
    }

    @Test
    fun formatDecimalTakesDigits() {
        assertEquals("8,95", Format.formatDecimal(8.946, 2))
        assertEquals("9", Format.formatDecimal(8.94, 0))
        assertEquals("1${group}234,6", Format.formatDecimal(1234.56, 1))
    }

    @Test
    fun formatDecimalDashForMissing() {
        for (v in missing) assertEquals(dash, Format.formatDecimal(v))
    }

    @Test
    fun formatDurationHoursAndMinutes() {
        assertEquals("7 h 20 min", Format.formatDuration(440.0))
        assertEquals("45 min", Format.formatDuration(45.0))
        assertEquals("1 h", Format.formatDuration(60.0))
        assertEquals("0 min", Format.formatDuration(0.0))
        assertEquals("1 h 1 min", Format.formatDuration(61.0))
        assertEquals("25 h", Format.formatDuration(1500.0))
    }

    @Test
    fun formatDurationRoundsToWholeMinutes() {
        assertEquals("1 h", Format.formatDuration(59.6))
        assertEquals("44 min", Format.formatDuration(44.4))
        assertEquals("7 h 20 min", Format.formatDuration(439.5))
    }

    @Test
    fun formatDurationDashForMissing() {
        for (v in missing) assertEquals(dash, Format.formatDuration(v))
    }

    @Test
    fun formatDurationShortWritesHMM() {
        assertEquals("7:20", Format.formatDurationShort(440.0))
        assertEquals("0:45", Format.formatDurationShort(45.0))
        assertEquals("1:00", Format.formatDurationShort(60.0))
        assertEquals("0:05", Format.formatDurationShort(5.0))
        assertEquals("0:00", Format.formatDurationShort(0.0))
        assertEquals("11:00", Format.formatDurationShort(659.6))
    }

    @Test
    fun formatDurationShortDashForMissing() {
        for (v in missing) assertEquals(dash, Format.formatDurationShort(v))
    }

    @Test
    fun formatDurationCompactDropsMinuteUnit() {
        assertEquals("1 h 30", Format.formatDurationCompact(90.0))
        assertEquals("2 h 05", Format.formatDurationCompact(125.0))
        assertEquals("2 h", Format.formatDurationCompact(120.0))
        assertEquals("8 min", Format.formatDurationCompact(8.0))
        assertEquals("0 min", Format.formatDurationCompact(0.0))
        assertEquals("0 min", Format.formatDurationCompact(-4.0))
    }

    @Test
    fun formatDurationCompactDashForMissing() {
        for (v in missing) assertEquals(dash, Format.formatDurationCompact(v))
    }

    @Test
    fun formatTimeOfDayWritesClock() {
        assertEquals("00:00", Format.formatTimeOfDay(0.0))
        assertEquals("22:05", Format.formatTimeOfDay(22.0 * 60 + 5))
        assertEquals("06:55", Format.formatTimeOfDay(415.4))
    }

    @Test
    fun formatTimeOfDayWraps() {
        assertEquals("23:30", Format.formatTimeOfDay(-30.0))
        assertEquals("01:15", Format.formatTimeOfDay(1440.0 + 75))
    }

    @Test
    fun formatTimeOfDayDashForMissing() {
        for (v in missing) assertEquals(dash, Format.formatTimeOfDay(v))
    }

    @Test
    fun formatDistanceSwitchesAtOneKilometre() {
        assertEquals("8,9 km", Format.formatDistance(8940.0))
        assertEquals("850 m", Format.formatDistance(850.0))
        assertEquals("0 m", Format.formatDistance(0.0))
        assertEquals("999 m", Format.formatDistance(999.4))
        assertEquals("1,0 km", Format.formatDistance(999.6))
        assertEquals("1,0 km", Format.formatDistance(1000.0))
        assertEquals("42,2 km", Format.formatDistance(42195.0))
        assertEquals("1${group}234,5 km", Format.formatDistance(1234500.0))
    }

    @Test
    fun formatDistanceDashForMissing() {
        for (v in missing) assertEquals(dash, Format.formatDistance(v))
    }

    @Test
    fun formatKcalAndBpmRoundAndAddUnit() {
        assertEquals("2${group}130 kcal", Format.formatKcal(2130.4))
        assertEquals("480 kcal", Format.formatKcal(480.0))
        assertEquals("0 kcal", Format.formatKcal(0.0))
        assertEquals("52 bpm", Format.formatBpm(52.4))
        assertEquals("168 bpm", Format.formatBpm(168.0))
    }

    @Test
    fun formatKcalAndBpmDashForMissing() {
        for (v in missing) {
            assertEquals(dash, Format.formatKcal(v))
            assertEquals(dash, Format.formatBpm(v))
        }
    }

    @Test
    fun formatDayShortWeekday() {
        assertEquals("po 12. 10.", Format.formatDay("2026-10-12"))
        assertEquals("ut 13. 10.", Format.formatDay("2026-10-13"))
        assertEquals("st 14. 10.", Format.formatDay("2026-10-14"))
        assertEquals("št 15. 10.", Format.formatDay("2026-10-15"))
        assertEquals("pi 16. 10.", Format.formatDay("2026-10-16"))
        assertEquals("so 17. 10.", Format.formatDay("2026-10-17"))
        assertEquals("ne 18. 10.", Format.formatDay("2026-10-18"))
        assertEquals("ne 1. 3.", Format.formatDay("2026-03-01"))
    }

    @Test
    fun formatDayMonthNoLeadingZeroes() {
        assertEquals("12. 10.", Format.formatDayMonth("2026-10-12"))
        assertEquals("5. 1.", Format.formatDayMonth("2026-01-05"))
    }

    @Test
    fun formatDayLongGenitive() {
        assertEquals("pondelok 12. októbra 2026", Format.formatDayLong("2026-10-12"))
        assertEquals("nedeľa 29. marca 2026", Format.formatDayLong("2026-03-29"))
        assertEquals("piatok 1. januára 2027", Format.formatDayLong("2027-01-01"))
        assertEquals("štvrtok 18. júna 2026", Format.formatDayLong("2026-06-18"))
    }

    @Test
    fun formatMonthNominative() {
        assertEquals("október 2026", Format.formatMonth("2026-10-12"))
        assertEquals("marec 2026", Format.formatMonth("2026-03-01"))
        assertEquals("január 2027", Format.formatMonth("2027-01-31"))
    }

    @Test
    fun dayFormatsDashForNonDays() {
        for (value in listOf("", "2026-02-30", "včera", "2026-10-12T10:00:00Z")) {
            assertEquals(dash, Format.formatDay(value))
            assertEquals(dash, Format.formatDayMonth(value))
            assertEquals(dash, Format.formatDayLong(value))
            assertEquals(dash, Format.formatMonth(value))
        }
    }

    @Test
    fun formatClockShowsLocalTime() {
        assertEquals("22:41", Format.formatClock(Instant.parse("2026-07-14T20:41:00Z"), zone))
        assertEquals("21:41", Format.formatClock(Instant.parse("2026-01-14T20:41:00Z"), zone))
        assertEquals("06:05", Format.formatClock(Instant.parse("2026-07-15T04:05:00Z"), zone))
        assertEquals("00:00", Format.formatClock(Instant.parse("2026-07-14T22:00:00Z"), zone))
        assertEquals("20:41", Format.formatClock(Instant.parse("2026-07-14T20:41:00Z"), "UTC"))
    }

    @Test
    fun formatClockFollowsClockChange() {
        assertEquals("01:59", Format.formatClock(Instant.parse("2026-03-29T00:59:00Z"), zone))
        assertEquals("03:00", Format.formatClock(Instant.parse("2026-03-29T01:00:00Z"), zone))
        assertEquals("02:59", Format.formatClock(Instant.parse("2026-10-25T00:59:00Z"), zone))
        assertEquals("02:00", Format.formatClock(Instant.parse("2026-10-25T01:00:00Z"), zone))
    }

    @Test
    fun formatClockDashForMissingOrBadZone() {
        assertEquals(dash, Format.formatClock(null, zone))
        assertEquals(dash, Format.formatClock(Instant.parse("2026-07-14T20:41:00Z"), "Nowhere/Nothing"))
    }

    @Test
    fun formatClockMinutesFromNoon() {
        assertEquals("22:30", Format.formatClockMinutes(630.0))
        assertEquals("07:00", Format.formatClockMinutes(1140.0))
        assertEquals("12:00", Format.formatClockMinutes(0.0))
        assertEquals("00:00", Format.formatClockMinutes(720.0))
        assertEquals("00:15", Format.formatClockMinutes(735.0))
        assertEquals("23:59", Format.formatClockMinutes(719.0))
    }

    @Test
    fun formatClockMinutesWrapsAndRounds() {
        assertEquals("12:00", Format.formatClockMinutes(1440.0))
        assertEquals("07:00", Format.formatClockMinutes(2580.0))
        assertEquals("11:00", Format.formatClockMinutes(-60.0))
        assertEquals("23:23", Format.formatClockMinutes(682.5))
    }

    @Test
    fun formatClockMinutesDashForMissing() {
        for (v in missing) assertEquals(dash, Format.formatClockMinutes(v))
    }

    private val now = Instant.parse("2026-10-13T12:00:00Z")
    private fun ago(minutes: Double): Instant =
        Instant.ofEpochMilli(now.toEpochMilli() - Math.round(minutes * 60_000))

    @Test
    fun formatRelativeJustNow() {
        assertEquals("práve teraz", Format.formatRelative(ago(0.0), now))
        assertEquals("práve teraz", Format.formatRelative(ago(0.98), now))
        assertEquals("práve teraz", Format.formatRelative(ago(-5.0), now))
    }

    @Test
    fun formatRelativeMinutes() {
        assertEquals("pred 1 min", Format.formatRelative(ago(1.0), now))
        assertEquals("pred 12 min", Format.formatRelative(ago(12.0), now))
        assertEquals("pred 59 min", Format.formatRelative(ago(59.9), now))
    }

    @Test
    fun formatRelativeHours() {
        assertEquals("pred 1 h", Format.formatRelative(ago(60.0), now))
        assertEquals("pred 3 h", Format.formatRelative(ago(3 * 60.0 + 20), now))
        assertEquals("pred 23 h", Format.formatRelative(ago(23 * 60.0 + 59), now))
    }

    @Test
    fun formatRelativeYesterday() {
        assertEquals("včera", Format.formatRelative(ago(24 * 60.0), now))
        assertEquals("včera", Format.formatRelative(ago(47 * 60.0 + 59), now))
    }

    @Test
    fun formatRelativeDnamiFromTwoDays() {
        assertEquals("pred 2 dňami", Format.formatRelative(ago(2 * 24 * 60.0), now))
        assertEquals("pred 4 dňami", Format.formatRelative(ago(4 * 24 * 60.0 + 300), now))
        assertEquals("pred 5 dňami", Format.formatRelative(ago(5 * 24 * 60.0), now))
        assertEquals("pred 21 dňami", Format.formatRelative(ago(21 * 24 * 60.0), now))
        assertEquals("pred 100 dňami", Format.formatRelative(ago(100 * 24 * 60.0), now))
    }

    @Test
    fun formatRelativeReadsApiTimestamp() {
        assertEquals("pred 12 min", Format.formatRelative(Instant.parse("2026-10-13T11:48:00Z"), now))
    }

    @Test
    fun formatRelativeDashForMissing() {
        assertEquals(dash, Format.formatRelative(null, now))
    }

    @Test
    fun formatChangeSignsWithRealMinus() {
        assertEquals("+12 %", Format.formatChange(0.123))
        assertEquals("${minus}4 %", Format.formatChange(-0.04))
        assertEquals("+100 %", Format.formatChange(1.0))
        assertEquals("${minus}50 %", Format.formatChange(-0.5))
        assertFalse(Format.formatChange(-0.04).contains("-"))
    }

    @Test
    fun formatChangeZeroWithoutSign() {
        assertEquals("0 %", Format.formatChange(0.0))
        assertEquals("0 %", Format.formatChange(0.004))
        assertEquals("0 %", Format.formatChange(-0.004))
    }

    @Test
    fun formatChangeGroupsLargeChanges() {
        assertEquals("+1${group}250 %", Format.formatChange(12.5))
    }

    @Test
    fun formatChangeDashForMissing() {
        for (v in missing) assertEquals(dash, Format.formatChange(v))
    }

    @Test
    fun pluralPicksSlovakForm() {
        val counts = listOf(0.0, 1.0, 2.0, 4.0, 5.0, 11.0, 2.5)
        assertEquals(
            listOf(
                "tréningov", "tréning", "tréningy", "tréningy",
                "tréningov", "tréningov", "tréningov",
            ),
            counts.map { Format.plural(it, "tréning", "tréningy", "tréningov") },
        )
    }

    @Test
    fun approxMarksEstimate() {
        assertEquals("≈ 8,9 km", Format.approx("8,9 km"))
        assertEquals("≈ 480 kcal", Format.approx(Format.formatKcal(480.0)))
        assertEquals(dash, Format.approx(dash))
        assertEquals(dash, Format.approx(Format.formatKcal(null)))
    }

    @Test
    fun workoutLabelTranslatesEveryKnownType() {
        val expected = mapOf(
            "running" to "Beh", "trail_running" to "Trailový beh", "treadmill" to "Bežecký pás",
            "walking" to "Chôdza", "hiking" to "Turistika", "cycling" to "Bicykel",
            "mountain_biking" to "Horský bicykel", "indoor_cycling" to "Stacionárny bicykel",
            "swimming" to "Plávanie", "pool_swimming" to "Plávanie",
            "open_water_swimming" to "Plávanie vonku",
            "strength_training" to "Silový tréning", "cardio_training" to "Kardio", "yoga" to "Joga",
            "pilates" to "Pilates", "stretching" to "Strečing", "soccer" to "Futbal",
            "basketball" to "Basketbal", "volleyball" to "Volejbal", "tennis" to "Tenis",
            "badminton" to "Bedminton", "table_tennis" to "Stolný tenis",
            "hockey" to "Hokej", "floorball" to "Florbal", "rowing" to "Veslovanie", "dance" to "Tanec",
            "alpine_skiing" to "Lyžovanie", "downhill_skiing" to "Lyžovanie",
            "cross_country_skiing" to "Bežky", "snowboarding" to "Snowboard",
            "ice_skating" to "Korčuľovanie", "rock_climbing" to "Lezenie",
            "indoor_climbing" to "Lezenie", "bouldering" to "Lezenie",
            "generic" to "Tréning", "other" to "Tréning", "sport" to "Tréning",
        )
        for ((type, label) in expected) assertEquals(type, label, Format.workoutLabel(type))
    }

    @Test
    fun workoutLabelHumanizesUnknown() {
        assertEquals("Kite surfing", Format.workoutLabel("kite_surfing"))
        assertEquals("Padel", Format.workoutLabel("padel"))
        assertEquals("Constructor", Format.workoutLabel("constructor"))
        assertEquals("ToString", Format.workoutLabel("toString"))
    }

    @Test
    fun workoutLabelIgnoresCaseAndFallsBack() {
        assertEquals("Beh", Format.workoutLabel("RUNNING"))
        assertEquals("Tréning", Format.workoutLabel(""))
    }

    @Test
    fun stepsSourceLabelNamesSources() {
        assertEquals("Samsung Health", Format.stepsSourceLabel("samsung_health_total"))
        assertEquals("Samsung (hodinové)", Format.stepsSourceLabel("samsung_hourly"))
        assertEquals("Telefón", Format.stepsSourceLabel("phone"))
    }

    @Test
    fun stepsSourceLabelDashAndUnknown() {
        assertEquals(dash, Format.stepsSourceLabel(null))
        assertEquals(dash, Format.stepsSourceLabel(""))
        assertEquals("Garmin daily", Format.stepsSourceLabel("garmin_daily"))
    }
}
