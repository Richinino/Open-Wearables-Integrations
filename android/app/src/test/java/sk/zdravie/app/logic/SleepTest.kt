package sk.zdravie.app.logic

import java.time.Instant
import java.time.OffsetDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import sk.zdravie.app.logic.Dates.addDays
import sk.zdravie.app.logic.Dates.dateRange
import sk.zdravie.app.logic.LogicFixtures.ZONE
import sk.zdravie.app.logic.LogicFixtures.makeDay
import sk.zdravie.app.logic.LogicFixtures.makeScore
import sk.zdravie.app.logic.LogicFixtures.makeScores
import sk.zdravie.app.model.Day
import sk.zdravie.app.model.SamsungAuto
import sk.zdravie.app.model.SleepInterval
import sk.zdravie.app.model.SleepStage

class SleepTest {
    private val end = "2026-10-15" // a Thursday; Bratislava is on UTC+2 until 25 October

    private fun at(text: String): Instant = Instant.parse(text)

    private fun night(day: String, bed: String, wake: String, change: (Day) -> Day = { it }): Day {
        val previous = addDays(day, -1)
        val start = if (bed >= "12:00") "${previous}T$bed:00+02:00" else "${day}T$bed:00+02:00"
        return makeDay(day) {
            change(
                it.copy(
                    sleepStart = OffsetDateTime.parse(start).toInstant(),
                    sleepEnd = OffsetDateTime.parse("${day}T$wake:00+02:00").toInstant(),
                    sleepMinutes = 420.0,
                ),
            )
        }
    }

    private fun interval(start: String, stage: SleepStage, endText: String) = SleepInterval(at(start), at(endText), stage)

    // --- sleep kinds ---

    @Test fun namesTheVendorAndTheScaleOfEachPart() {
        val kinds = Sleep.SLEEP_KINDS
        assertEquals("WHOOP", kinds.getValue(SleepKind.PERFORMANCE).vendor)
        assertEquals("Apple", kinds.getValue(SleepKind.APPLE).vendor)
        assertEquals(listOf(50, 30, 20), kinds.getValue(SleepKind.APPLE).parts.map { it.max })
        assertEquals(
            listOf("hours_vs_needed", "consistency", "efficiency"),
            kinds.getValue(SleepKind.PERFORMANCE).parts.map { it.key },
        )
    }

    @Test fun mapsTheThreeStoredAccountValues() {
        assertEquals(SleepKind.APPLE, SleepKind.fromAccount("apple"))
        assertEquals(SleepKind.PERFORMANCE, SleepKind.fromAccount("performance"))
        assertEquals(SleepKind.SAMSUNG, SleepKind.fromAccount("samsung"))
    }

    @Test fun marksOwisSamsungScoreAsAnEstimateWhosePartsOwiNames() {
        val samsung = Sleep.SLEEP_KINDS.getValue(SleepKind.SAMSUNG)
        assertEquals("Samsung", samsung.option)
        assertEquals("Samsung", samsung.vendor)
        assertTrue(samsung.estimate)
        assertTrue(samsung.onlyPresent)
        assertEquals(90, samsung.top)
        assertEquals("výborné", samsung.band(90.0)?.label)
        assertEquals("slabé", samsung.band(49.0)?.label)
    }

    @Test fun picksTheScoreOfTheChosenKind() {
        val day = makeDay(end) {
            it.copy(
                scores = makeScores(end) { s ->
                    s.copy(
                        sleepPerformance = makeScore(91.0), appleSleep = makeScore(77.0),
                        samsungSleep = makeScore(83.0),
                    )
                },
            )
        }
        assertEquals(91.0, Sleep.sleepScoreOf(day, SleepKind.PERFORMANCE)?.value)
        assertEquals(77.0, Sleep.sleepScoreOf(day, SleepKind.APPLE)?.value)
        assertEquals(83.0, Sleep.sleepScoreOf(day, SleepKind.SAMSUNG)?.value)
        assertNull(Sleep.sleepScoreOf(makeDay(end), SleepKind.APPLE))
        assertNull(Sleep.sleepScoreOf(null, SleepKind.APPLE))
        // Older responses have no Samsung score at all.
        assertNull(Sleep.sleepScoreOf(makeDay(end) { it.copy(scores = makeScores(end)) }, SleepKind.SAMSUNG))
    }

    @Test fun showsSamsungsOwnSleepScoreWhenItSentOneElseOwisEstimate() {
        val scores = makeScores(end) {
            it.copy(
                sleepPerformance = makeScore(91.0),
                samsungSleep = makeScore(83.0, mapOf("deep" to 70.0), "estimate"),
            )
        }
        val sent = makeDay(end) { it.copy(scores = scores, samsungAuto = SamsungAuto(null, null, 88.0)) }
        val estimated = makeDay(end) { it.copy(scores = scores) }
        val learning = makeDay(end) {
            it.copy(
                scores = makeScores(end) { s ->
                    s.copy(samsungSleep = makeScore(null, mapOf("entries" to 4.0, "needed" to 10.0), "learning"))
                },
            )
        }

        assertEquals(
            NightScore(88.0, estimate = false, fromSamsung = true, score = scores.samsungSleep),
            Sleep.nightScore(sent, SleepKind.SAMSUNG),
        )
        assertEquals(83.0, Sleep.nightScore(sent, SleepKind.SAMSUNG).score?.value)
        val est = Sleep.nightScore(estimated, SleepKind.SAMSUNG)
        assertEquals(83.0, est.value)
        assertTrue(est.estimate)
        assertFalse(est.fromSamsung)
        val learn = Sleep.nightScore(learning, SleepKind.SAMSUNG)
        assertNull(learn.value)
        assertFalse(learn.estimate)
        assertFalse(learn.fromSamsung)
        assertEquals("learning", learn.score?.note)
        // Samsung's number belongs only to its own kind.
        val performance = Sleep.nightScore(sent, SleepKind.PERFORMANCE)
        assertEquals(91.0, performance.value)
        assertFalse(performance.estimate)
        assertFalse(performance.fromSamsung)
        assertEquals(
            NightScore(null, estimate = false, fromSamsung = false, score = null),
            Sleep.nightScore(null, SleepKind.SAMSUNG),
        )
    }

    @Test fun samsungLearningShowsLearningText() {
        val day = makeDay(end) {
            it.copy(
                scores = makeScores(end) { s ->
                    s.copy(samsungSleep = makeScore(null, mapOf("entries" to 4.0, "needed" to 10.0), "learning"))
                },
                samsungAuto = null,
            )
        }
        val night = Sleep.nightScore(day, SleepKind.SAMSUNG)
        assertNull(night.value)
        assertEquals("učí sa, chýba ešte 6 zápisov", Samsung.learningText(night.score))
    }

    // --- lastNight ---

    @Test fun takesTheLatestDayUpToTheDateThatHasAMainSleep() {
        val days = listOf(
            night("2026-10-13", "23:00", "07:00"),
            makeDay("2026-10-14"),
            makeDay(end) { it.copy(steps = 100.0) },
        )
        assertEquals("2026-10-13", Sleep.lastNight(days, end)?.day)
        assertNull(Sleep.lastNight(days, "2026-10-12"))
    }

    // --- stageTotals ---

    @Test fun givesSharesOfTheSleepForTheThreeSleepStagesAndNoneForAwake() {
        val totals = Sleep.stageTotals(
            makeDay(end) {
                it.copy(
                    sleepMinutes = 400.0, sleepDeepMin = 80.0, sleepRemMin = 100.0, sleepLightMin = 220.0,
                    sleepAwakeMin = 15.0,
                )
            },
        )
        assertEquals(listOf(SleepStage.DEEP, SleepStage.REM, SleepStage.LIGHT, SleepStage.AWAKE), totals.map { it.stage })
        assertEquals(0.2, totals[0].share!!, 1e-9)
        assertEquals(0.25, totals[1].share!!, 1e-9)
        assertEquals(StageTotal(SleepStage.AWAKE, 15.0, null), totals[3])
    }

    @Test fun keepsMissingStagesNullInsteadOfZero() {
        val totals = Sleep.stageTotals(makeDay(end) { it.copy(sleepMinutes = 400.0) })
        assertTrue(totals.all { it.minutes == null && it.share == null })
        assertTrue(Sleep.stageTotals(null).all { it.minutes == null })
    }

    // --- splitTimeline ---

    private val timelineDay = makeDay(end) {
        it.copy(
            sleepStart = at("2026-10-14T21:00:00Z"),
            sleepEnd = at("2026-10-15T05:00:00Z"),
            sleepTimeline = listOf(
                interval("2026-10-14T21:00:00Z", SleepStage.LIGHT, "2026-10-14T22:00:00Z"),
                interval("2026-10-14T22:00:00Z", SleepStage.DEEP, "2026-10-14T23:00:00Z"),
                interval("2026-10-14T23:00:00Z", SleepStage.DEEP, "2026-10-14T23:30:00Z"),
                interval("2026-10-15T02:00:00Z", SleepStage.AWAKE, "2026-10-15T02:10:00Z"),
                interval("2026-10-15T02:10:00Z", SleepStage.REM, "2026-10-15T05:00:00Z"),
                // Two naps in the afternoon: 12:00-12:20 and 12:40-12:50 belong together, 15:00 apart.
                interval("2026-10-15T12:00:00Z", SleepStage.LIGHT, "2026-10-15T12:20:00Z"),
                interval("2026-10-15T12:40:00Z", SleepStage.LIGHT, "2026-10-15T12:50:00Z"),
                interval("2026-10-15T15:00:00Z", SleepStage.ASLEEP, "2026-10-15T15:25:00Z"),
                // Broken entry (end before start) is dropped. An entry whose time is not a time
                // cannot reach the model: it is dropped when the dataset is read.
                interval("2026-10-15T16:00:00Z", SleepStage.LIGHT, "2026-10-15T15:00:00Z"),
            ),
        )
    }

    @Test fun keepsTheMainSleepApartAndMergesTouchingStretchesOfOneStage() {
        val main = Sleep.splitTimeline(timelineDay).main
        assertNotNull(main)
        assertEquals(
            listOf(SleepStage.LIGHT, SleepStage.DEEP, SleepStage.AWAKE, SleepStage.REM),
            main!!.blocks.map { it.stage },
        )
        assertEquals(90.0, main.stageMinutes[SleepStage.DEEP]!!, 0.0)
        assertEquals((60 + 90 + 170).toDouble(), main.asleepMinutes, 0.0)
        assertEquals(at("2026-10-14T21:00:00Z").toEpochMilli(), main.start)
        assertEquals(at("2026-10-15T05:00:00Z").toEpochMilli(), main.end)
    }

    @Test fun groupsNapsLessThan30MinutesApart() {
        val naps = Sleep.splitTimeline(timelineDay).naps
        assertEquals(2, naps.size)
        assertEquals(30.0, naps[0].asleepMinutes, 0.0)
        assertEquals(at("2026-10-15T12:50:00Z").toEpochMilli(), naps[0].end)
        assertEquals(25.0, naps[1].asleepMinutes, 0.0)
    }

    @Test fun treatsEverythingAsNapsWithoutAMainSleepAndHandlesNoTimeline() {
        val napOnly = makeDay(end) { it.copy(sleepTimeline = timelineDay.sleepTimeline.drop(5)) }
        assertNull(Sleep.splitTimeline(napOnly).main)
        assertEquals(2, Sleep.splitTimeline(napOnly).naps.size)
        assertEquals(SplitTimeline(null, emptyList()), Sleep.splitTimeline(makeDay(end)))
        assertEquals(SplitTimeline(null, emptyList()), Sleep.splitTimeline(null))
    }

    // --- hourTicks ---

    @Test fun putsTicksOnWholeLocalHoursInsideTheSpan() {
        // 23:12 to 06:56 local time.
        val ticks = Sleep.hourTicks(
            at("2026-10-14T21:12:00Z").toEpochMilli(), at("2026-10-15T04:56:00Z").toEpochMilli(), ZONE,
        )
        assertEquals(listOf("00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00"), ticks.map { it.label })
        assertEquals(at("2026-10-14T22:00:00Z").toEpochMilli(), ticks[0].at)
    }

    @Test fun canStepByTwoHoursAndIncludesAnExactStart() {
        val ticks = Sleep.hourTicks(
            at("2026-10-14T20:00:00Z").toEpochMilli(), at("2026-10-15T04:00:00Z").toEpochMilli(), ZONE, 120,
        )
        assertEquals(listOf("22:00", "00:00", "02:00", "04:00", "06:00"), ticks.map { it.label })
    }

    @Test fun returnsNothingForAnEmptyOrReversedSpan() {
        assertEquals(emptyList<HourTick>(), Sleep.hourTicks(10, 10, ZONE))
        assertEquals(emptyList<HourTick>(), Sleep.hourTicks(20, 10, ZONE))
    }

    // --- needTonight ---

    @Test fun suggestsABedtimeFromTheNeedAndTheUsualWakeUpOfThatKindOfDay() {
        // Four school-day nights waking at 06:30; the 16th is a Friday, a school day.
        val days = ArrayList(
            listOf("2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14").map { night(it, "22:30", "06:30") },
        )
        days.add(
            makeDay(end) {
                it.copy(
                    complete = false,
                    scores = makeScores(end) { s -> s.copy(sleepNeedMinutes = 510.0, strain = 9.4) },
                )
            },
        )
        val plan = Sleep.needTonight(days, ZONE, end)
        assertEquals(510.0, plan.need!!, 0.0)
        assertEquals((6 * 60 + 30).toDouble(), plan.wake!!, 0.0)
        // 06:30 - 8 h 30 min - 15 min to fall asleep = 21:45.
        assertEquals((21 * 60 + 45).toDouble(), plan.bedtime!!, 0.0)
        assertEquals(9.4, plan.strain!!, 0.0)
        assertTrue(plan.partial)
    }

    @Test fun staysEmptyWithoutANeed() {
        val plan = Sleep.needTonight(listOf(makeDay(end)), ZONE, end)
        assertNull(plan.need)
        assertNull(plan.bedtime)
        assertNull(plan.strain)
        assertFalse(plan.partial)
    }

    // --- sleepHistory and needCoverage ---

    private val historyDays = dateRange("2026-10-10", end).mapIndexed { index, day ->
        makeDay(day) {
            it.copy(
                sleepMinutes = if (index == 2) null else (420 + index * 10).toDouble(),
                scores = makeScores(day) { s ->
                    s.copy(
                        sleepNeedMinutes = 480.0,
                        sleepPerformance = makeScore(
                            if (index == 2) null else (80 + index).toDouble(), emptyMap(),
                            if (index == 2) "no sleep recorded" else null,
                        ),
                        appleSleep = makeScore(70.0),
                        sleepRegularity = 82.0,
                    )
                },
            )
        }
    }

    @Test fun listsEveryNightOfTheWindowWithTheNeedSetTheEveningBefore() {
        val points = Sleep.sleepHistory(historyDays, end, 7, SleepKind.PERFORMANCE)
        assertEquals(dateRange("2026-10-09", end), points.map { it.day })
        assertNull(points[0].data)
        assertNull(points[0].minutes)
        assertNull(points[0].need)
        assertNull(points[0].score)
        assertEquals(420.0, points[1].minutes!!, 0.0)
        assertNull(points[1].need)
        assertEquals(80.0, points[1].score!!, 0.0)
        assertEquals(430.0, points[2].minutes!!, 0.0)
        assertEquals(480.0, points[2].need!!, 0.0)
        assertEquals(81.0, points[2].score!!, 0.0)
        assertNull(points[3].minutes)
        assertNull(points[3].score)
        assertEquals("no sleep recorded", points[3].scoreNote)
        assertTrue(points.none { it.estimate })
        assertEquals(70.0, Sleep.sleepHistory(historyDays, end, 7, SleepKind.APPLE)[2].score!!, 0.0)
        assertEquals(82.0, points[2].regularity!!, 0.0)
    }

    @Test fun marksTheNightsWhereSamsungsScoreIsOwisEstimate() {
        val samsungDays = dateRange("2026-10-13", end).mapIndexed { index, day ->
            makeDay(day) {
                it.copy(
                    scores = makeScores(day) { s ->
                        s.copy(samsungSleep = makeScore((80 + index).toDouble(), emptyMap(), "estimate"))
                    },
                    samsungAuto = if (index == 1) SamsungAuto(9000.0, 400.0, 77.0) else null,
                )
            }
        }
        val points = Sleep.sleepHistory(samsungDays, end, 3, SleepKind.SAMSUNG)
        assertEquals(listOf(80.0 to true, 77.0 to false, 82.0 to true), points.map { it.score!! to it.estimate })
    }

    @Test fun countsCoveredNightsAndTheMeanShortfallOfTheRest() {
        val coverage = Sleep.needCoverage(Sleep.sleepHistory(historyDays, end, 7, SleepKind.PERFORMANCE))
        // Nights with a need: 11th (430), 13th (450), 14th (460), 15th (470): none reach 480.
        assertEquals(4, coverage.nights)
        assertEquals(0, coverage.covered)
        assertEquals((50.0 + 30 + 20 + 10) / 4, coverage.shortfall!!, 1e-9)
        assertEquals(480.0, coverage.averageNeed!!, 0.0)
    }

    // --- clockSummary ---

    @Test fun keepsBedtimesOnBothSidesOfMidnightTogether() {
        val days = listOf(
            night("2026-10-13", "23:30", "06:40"),
            night("2026-10-14", "00:30", "07:00"),
            night(end, "23:00", "06:20"),
        )
        val summary = Sleep.clockSummary(days, ZONE, end, 14)
        assertNotNull(summary)
        assertEquals(3, summary!!.nights)
        assertEquals(23 * 60.0, summary.bedEarliest, 0.0)
        assertEquals(30.0, summary.bedLatest, 0.0)
        assertEquals(23 * 60.0 + 40, summary.bedMean, 0.0)
        assertEquals(6 * 60.0 + 20, summary.wakeEarliest, 0.0)
        assertEquals(7 * 60.0, summary.wakeLatest, 0.0)
        assertEquals(6 * 60.0 + 40, summary.wakeMean, 0.0)
    }

    @Test fun clockSummaryIsNullWithoutNightsInTheWindow() {
        assertNull(Sleep.clockSummary(listOf(night("2026-09-01", "23:00", "07:00")), ZONE, end, 14))
    }

    // --- regularityBand ---

    @Test fun placesTheIndexAmongTheFifthsOfAdults() {
        assertEquals(5, Sleep.regularityBand(90.0)?.fifth)
        assertEquals(5, Sleep.regularityBand(87.3)?.fifth)
        assertEquals("pravidelný", Sleep.regularityBand(85.0)?.label)
        assertEquals(3, Sleep.regularityBand(81.0)?.fifth)
        assertEquals(2, Sleep.regularityBand(75.0)?.fifth)
        assertEquals("nepravidelný", Sleep.regularityBand(60.0)?.label)
        assertNull(Sleep.regularityBand(null))
        assertEquals(listOf(71.7, 78.6, 83.2, 87.3), Sleep.SRI_QUINTILES)
        assertEquals(81.0, Sleep.SRI_MEDIAN, 0.0)
    }
}
