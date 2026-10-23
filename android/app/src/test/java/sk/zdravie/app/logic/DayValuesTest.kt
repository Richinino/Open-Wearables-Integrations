package sk.zdravie.app.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import sk.zdravie.app.logic.LogicFixtures.makeDay
import sk.zdravie.app.logic.LogicFixtures.selected
import sk.zdravie.app.model.Day
import sk.zdravie.app.model.ValueSource.DERIVED
import sk.zdravie.app.model.ValueSource.ESTIMATED
import sk.zdravie.app.model.ValueSource.MEASURED

class DayValuesTest {
    private fun legacy(day: String = "2026-01-01", change: (Day) -> Day = { it }): Day =
        makeDay(day) { change(it.copy(distanceMEst = 900.0, activityKcalEst = 100.0, totalKcalEst = 1900.0)) }

    private val int: (Double?) -> String = { Format.formatInt(it) }

    @Test fun measuredRestingHrWinsOverRollingMinute() {
        for (rolling in listOf(null, 49.0)) {
            val day = legacy { it.copy(restingHr = selected(63.0, MEASURED), hrResting = rolling) }
            assertEquals(63.0, DayValues.dayValue(day, DayMetric.RESTING_HR)!!, 0.0)
            assertEquals("63", DayValues.dayFigure(day, DayMetric.RESTING_HR, int))
            assertTrue(DayValues.restingHrDescription(day).contains("zo zariadenia"))
        }
    }

    @Test fun derivedRollingRestingHrWhenMeasuredNull() {
        val day = legacy { it.copy(restingHr = selected(null, null), hrResting = 51.0) }
        assertEquals(51.0, DayValues.dayValue(day, DayMetric.RESTING_HR)!!, 0.0)
        assertEquals(DERIVED, DayValues.dayValueSource(day, DayMetric.RESTING_HR))
        assertEquals("51", DayValues.dayFigure(day, DayMetric.RESTING_HR, int))
        assertTrue(DayValues.restingHrDescription(day).contains("30-minútový"))
        assertNull(DayValues.dayValue(day.copy(hrResting = null), DayMetric.RESTING_HR))
    }

    @Test fun estimatedRestingHrGetsApprox() {
        val day = legacy { it.copy(restingHr = selected(60.0, ESTIMATED)) }
        assertTrue(DayValues.dayFigure(day, DayMetric.RESTING_HR, int).contains("≈"))
        assertTrue(DayValues.restingHrDescription(day).contains("Odhad"))
    }

    @Test fun selectedDeviceValueKeepsCalibrationEstimate() {
        val day = legacy { it.copy(distance = selected(1200.0, MEASURED)) }
        assertEquals(1200.0, DayValues.dayValue(day, DayMetric.DISTANCE)!!, 0.0)
        assertFalse(DayValues.dayFigure(day, DayMetric.DISTANCE, int).contains("≈"))
        assertEquals(900.0, day.distanceMEst!!, 0.0)
    }

    @Test fun noEstimateForExplicitMissingSelection() {
        val day = legacy { it.copy(distance = selected(null, null)) }
        assertNull(DayValues.dayValue(day, DayMetric.DISTANCE))
        assertNull(DayValues.dayValueSource(day, DayMetric.DISTANCE))
    }

    @Test fun legacyPayloadsMarkInferredFigures() {
        val day = legacy()
        assertEquals(900.0, DayValues.dayValue(day, DayMetric.DISTANCE)!!, 0.0)
        assertTrue(DayValues.dayFigure(day, DayMetric.DISTANCE, int).contains("≈"))
        assertFalse(DayValues.dayFigure(null, DayMetric.DISTANCE, int).contains("≈"))
    }

    @Test fun olderResponseFallsBackToEstimate() {
        val day = makeDay("2026-01-01") { it.copy(distance = null, distanceMEst = 5400.0) }
        assertEquals(5400.0, DayValues.dayValue(day, DayMetric.DISTANCE)!!, 0.0)
        assertEquals(ESTIMATED, DayValues.dayValueSource(day, DayMetric.DISTANCE))
    }

    @Test fun measuredZeroAndExactSumsVsEstimates() {
        val day = legacy {
            it.copy(activeKcal = selected(0.0, MEASURED), totalKcal = selected(1800.0, DERIVED))
        }
        assertEquals(0.0, DayValues.dayValue(day, DayMetric.ACTIVE_ENERGY)!!, 0.0)
        assertEquals(DERIVED, DayValues.dayValueSource(day, DayMetric.TOTAL_ENERGY))
        assertFalse(DayValues.periodHasEstimate(listOf(day), DayMetric.TOTAL_ENERGY))
        assertTrue(DayValues.periodHasEstimate(listOf(day, legacy()), DayMetric.TOTAL_ENERGY))
    }

    @Test fun periodSummariesUseSelectedValues() {
        val days = listOf(
            legacy("2026-01-01") { it.copy(distance = selected(1200.0, MEASURED)) },
            legacy("2026-01-02") { it.copy(distance = selected(1800.0, DERIVED)) },
        )
        val result = Metrics.periodSummary(days, "2026-01-02", 2, DayKey.DISTANCE_M)
        assertEquals(1500.0, result.average!!, 0.0)
        assertEquals(900.0, Metrics.periodSummary(days, "2026-01-02", 2, DayKey.DISTANCE_M_EST).average!!, 0.0)
        assertFalse(DayValues.periodFigure(days, "2026-01-02", 2, DayMetric.DISTANCE, result.average, int).contains("≈"))
    }
}
