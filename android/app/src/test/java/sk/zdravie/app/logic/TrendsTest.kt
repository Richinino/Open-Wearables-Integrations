package sk.zdravie.app.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import sk.zdravie.app.logic.LogicFixtures.makeDay

class TrendsTest {
    private fun stepsDay(day: String, steps: Double?) = makeDay(day) { it.copy(steps = steps) }

    @Test
    fun averageIgnoresMissing() {
        val days = listOf(stepsDay("2026-06-08", 1000.0), stepsDay("2026-06-09", null), stepsDay("2026-06-10", 3000.0))
        val series = Trends.trendValues(days, "2026-06-10", TrendMetric.STEPS, 7)
        assertEquals(7, series.total)
        assertEquals(2, series.covered)
        assertEquals(2000.0, series.average!!, 0.001)
        assertNull(series.values[5])
    }

    @Test
    fun previousPeriodIsSameLength() {
        // Range 7 ending 06-14 covers 06-08..06-14; the previous one 06-01..06-07.
        val days = listOf(stepsDay("2026-06-01", 500.0), stepsDay("2026-06-07", 1500.0), stepsDay("2026-06-08", 9000.0))
        val series = Trends.trendValues(days, "2026-06-14", TrendMetric.STEPS, 7)
        assertEquals(1000.0, series.previousAverage!!, 0.001)
        assertEquals(9000.0, series.average!!, 0.001)
    }

    @Test
    fun yearUsesWeeklyMeans() {
        val days = (0 until 400).map { offset -> stepsDay(Dates.addDays("2025-06-01", offset), 1000.0 + offset) }
        val end = Dates.addDays("2025-06-01", 399)
        val series = Trends.trendValues(days, end, TrendMetric.STEPS, 365)
        assertEquals(52, series.values.size)
        assertTrue(series.values.all { it != null })
    }

    @Test
    fun restingHeartRateBestIsLowest() {
        val days = listOf(
            makeDay("2026-06-09") { it.copy(hrResting = 50.0, restingHr = LogicFixtures.selected(50.0, sk.zdravie.app.model.ValueSource.MEASURED)) },
            makeDay("2026-06-10") { it.copy(hrResting = 46.0, restingHr = LogicFixtures.selected(46.0, sk.zdravie.app.model.ValueSource.MEASURED)) },
        )
        val series = Trends.trendValues(days, "2026-06-10", TrendMetric.RESTING_HR, 7)
        assertEquals(46.0, series.best!!, 0.001)
        assertEquals(50.0, series.worst!!, 0.001)
    }
}
