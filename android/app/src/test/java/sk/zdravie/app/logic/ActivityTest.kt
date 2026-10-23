package sk.zdravie.app.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import sk.zdravie.app.logic.Dates.addDays
import sk.zdravie.app.logic.Dates.dateRange
import sk.zdravie.app.logic.LogicFixtures.makeDay
import sk.zdravie.app.logic.LogicFixtures.makeScores
import sk.zdravie.app.logic.LogicFixtures.selected
import sk.zdravie.app.model.CardioLoad
import sk.zdravie.app.model.Day
import sk.zdravie.app.model.ValueSource

class ActivityTest {
    private val end = "2026-10-15" // a Thursday

    @Test fun coversTheSixActivityPartsWithWeightsAddingUpToOne() {
        assertEquals(6, Activity.ACTIVITY_PARTS.size)
        assertEquals(1.0, Activity.ACTIVITY_PARTS.sumOf { it.weight }, 1e-5)
    }

    @Test fun splitsTheStrainScaleWithoutGaps() {
        val bands = Activity.STRAIN_BANDS
        assertEquals(0.0, bands.first().from, 0.0)
        assertEquals(21.0, bands.last().to, 0.0)
        assertEquals(21, Activity.STRAIN_MAX)
        bands.drop(1).forEachIndexed { index, band -> assertEquals(bands[index].to, band.from, 0.0) }
    }

    @Test fun cardioThresholdsMatchTheBandEdges() {
        assertEquals(listOf(0.8, 1.0, 1.3), Activity.CARDIO_THRESHOLDS)
        assertEquals(listOf(0.8, 1.0, 1.3), Activity.CARDIO_BANDS.drop(1).map { it.from })
        assertEquals(Double.POSITIVE_INFINITY, Activity.CARDIO_BANDS.last().to, 0.0)
    }

    @Test fun wordsEveryCardioStatusIncludingRecovering() {
        assertTrue(Activity.cardioText("productive")!!.contains("forma zlepšuje"))
        assertTrue(Activity.cardioText("recovering")!!.contains("zotavuje"))
        assertNull(Activity.cardioText(null))
    }

    private val cardioDays: List<Day> = dateRange(addDays(end, -20), end).mapIndexed { index, day ->
        makeDay(day) {
            it.copy(
                scores = makeScores(day) { s ->
                    s.copy(
                        cardioLoad = if (index == 20) CardioLoad(null, null, null, null)
                        else CardioLoad(100.0 + index, 100.0, 1 + index / 100.0, "productive"),
                    )
                },
            )
        }
    }

    @Test fun cardioTrendGivesOnePointPerDayMissingDaysAsNull() {
        val trend = Activity.cardioTrend(cardioDays, end, 28)
        assertEquals(28, trend.size)
        assertEquals(CardioPoint(addDays(end, -27), null, null, null, null), trend[0])
        assertEquals(1.19, trend[26].ratio!!, 0.0)
        assertEquals(119.0, trend[26].strain7!!, 0.0)
        assertEquals("productive", trend[26].status)
        assertNull(trend[27].ratio)
    }

    @Test fun cardioWeeksTakesTheLastKnownValueOfEachWeekNewestFirst() {
        val weeks = Activity.cardioWeeks(Activity.cardioTrend(cardioDays, end, 28))
        assertEquals(listOf(addDays(end, -1), addDays(end, -7), addDays(end, -14)), weeks.map { it.day })
    }

    @Test fun zoneTotalsAddsUpTheZonesOfTheWindowAndCountsDaysWithZoneData() {
        val days = listOf(
            makeDay(addDays(end, -8)) { it.copy(zoneLightMin = 500.0, zoneModerateMin = 500.0, zoneVigorousMin = 500.0) },
            makeDay(addDays(end, -1)) { it.copy(zoneLightMin = 40.0, zoneModerateMin = 10.0, zoneVigorousMin = 2.0) },
            makeDay(end) { it.copy(zoneLightMin = 20.0, zoneModerateMin = null, zoneVigorousMin = 5.0) },
            makeDay(addDays(end, -2)),
        )
        assertEquals(ZoneTotals(60.0, 10.0, 7.0, 2), Activity.zoneTotals(days, end, 7))
        assertNull(Activity.zoneTotals(listOf(makeDay(end)), end, 7))
    }

    private val stepDays: List<Day> = dateRange(addDays(end, -13), end).mapIndexed { index, day ->
        makeDay(day) {
            it.copy(
                steps = if (index == 3) null else 5000.0 + index * 500,
                distanceMEst = if (index == 3) null else (5000.0 + index * 500) * 0.7,
                complete = day != end,
            )
        }
    }

    @Test fun placesADayAmongTudorLockesCategories() {
        assertEquals("sedavý", Activity.stepsCategory(4000.0)?.label)
        assertEquals("čiastočne aktívny", Activity.stepsCategory(7500.0)?.label)
        assertEquals("veľmi aktívny", Activity.stepsCategory(12_500.0)?.label)
        assertNull(Activity.stepsCategory(null))
    }

    @Test fun leavesOutTheRunningDayAndMissingSteps() {
        assertNull(Activity.finishedSteps(stepDays.last()))
        assertNull(Activity.finishedSteps(stepDays[3]))
        assertEquals(5000.0, Activity.finishedSteps(stepDays[0])!!, 0.0)
        assertNull(Activity.finishedSteps(null))
        val stats = Activity.stepsStats(stepDays, end, 14)
        // Finished days with steps: indexes 0-12 without 3.
        assertEquals(12, stats.days)
        val expected = listOf(0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12).map { 5000.0 + it * 500 }
        assertEquals(expected.sum() / 12, stats.average!!, 1e-6)
        assertEquals(expected.sum() * 0.7, stats.distance!!, 1e-6)
    }

    @Test fun ranksTheBestFinishedDaysEarlierFirstOnATie() {
        val extra = makeDay(addDays(end, -20)) { it.copy(steps = 11000.0) }
        val best = Activity.bestStepDays(stepDays + extra, end, 30, 3)
        assertEquals(
            listOf(addDays(end, -20) to 11000.0, addDays(end, -1) to 11000.0, addDays(end, -2) to 10500.0),
            best.map { it.day to it.steps },
        )
    }

    @Test fun averagesEachWeekdayAndComparesTheWeekendWithWorkingDays() {
        val pattern = Activity.weekdaySteps(stepDays, end, 14)
        assertEquals(7, pattern.size)
        assertTrue(pattern.all { it.days <= 2 })
        // Monday 5 Oct has no steps, so Mondays rest on 12 Oct alone.
        assertEquals(WeekdaySteps(0, 10000.0, 1), pattern[0])
        assertNotNull(Activity.weekendShare(pattern))
        assertNull(Activity.weekendShare(pattern.map { it.copy(average = null) }))
    }

    private val measured = makeDay(end) {
        it.copy(distance = selected(2400.0, ValueSource.MEASURED), distanceMEst = 9999.0, steps = null)
    }

    @Test fun includesCompletedMeasuredDistanceOnlyDaysWithoutChangingStepStatistics() {
        assertEquals(StepsStats(null, 0, null, 2400.0, 2400.0), Activity.stepsStats(listOf(measured), end, 7))
    }

    @Test fun combinesMeasuredAndEstimatedDistancesInSevenAndThirtyDayWindows() {
        for (length in listOf(7, 30)) {
            val days = listOf(
                measured,
                makeDay(addDays(end, -1)) { it.copy(steps = 5000.0, distanceMEst = 3500.0) },
                makeDay(addDays(end, -2)) {
                    it.copy(steps = 6000.0, distance = selected(4100.0, ValueSource.MEASURED), distanceMEst = 9999.0)
                },
                makeDay(addDays(end, -3)) { it.copy(complete = false, distance = selected(9000.0, ValueSource.MEASURED)) },
                makeDay(addDays(end, -length)) { it.copy(distance = selected(9999.0, ValueSource.MEASURED)) },
                makeDay(addDays(end, 1)) { it.copy(distance = selected(9999.0, ValueSource.MEASURED)) },
            )
            assertEquals(
                StepsStats(5500.0, 2, 11000.0, 10000.0, 10000.0 / 3),
                Activity.stepsStats(days, end, length),
            )
        }
    }
}
