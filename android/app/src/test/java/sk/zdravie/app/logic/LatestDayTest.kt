package sk.zdravie.app.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import sk.zdravie.app.logic.LogicFixtures.makeDay
import sk.zdravie.app.logic.LogicFixtures.makeWorkout
import sk.zdravie.app.logic.LogicFixtures.selected
import sk.zdravie.app.model.ValueSource.MEASURED

class LatestDayTest {
    private val today = "2026-10-15"
    private val yesterday = makeDay("2026-10-14") { it.copy(steps = 9000.0, sleepMinutes = 430.0) }

    @Test fun deviceRestingHrIsFreshData() {
        val measured = makeDay(today) { it.copy(restingHr = selected(62.0, MEASURED), hrResting = null) }
        val older = makeDay("2026-10-14") { it.copy(steps = 9000.0) }
        assertTrue(LatestDays.hasDayData(measured))
        val r = LatestDays.latestDay(listOf(older, measured), today, today)
        assertSame(measured, r.day)
        assertFalse(r.fallback)
        assertFalse(LatestDays.hasDayData(makeDay(today) { it.copy(restingHr = null, hrResting = 51.0) }))
    }

    @Test fun needsStepsSleepOrWorkout() {
        assertFalse(LatestDays.hasDayData(null))
        assertFalse(LatestDays.hasDayData(makeDay(today)))
        assertFalse(LatestDays.hasDayData(makeDay(today) { it.copy(steps = 0.0, sleepMinutes = null, hrResting = 52.0) }))
        assertTrue(LatestDays.hasDayData(makeDay(today) { it.copy(steps = 14.0) }))
        assertTrue(LatestDays.hasDayData(makeDay(today) { it.copy(sleepMinutes = 420.0) }))
        assertTrue(LatestDays.hasDayData(makeDay(today) { it.copy(workouts = listOf(makeWorkout("w"))) }))
    }

    @Test fun keepsTodayWhenItHasOwnData() {
        val t = makeDay(today) { it.copy(complete = false, steps = 800.0) }
        assertEquals(LatestDay(t, today, false, null), LatestDays.latestDay(listOf(yesterday, t), today, today))
        val slept = makeDay(today) { it.copy(complete = false, steps = 0.0, sleepMinutes = 400.0) }
        assertSame(slept, LatestDays.latestDay(listOf(yesterday, slept), today, today).day)
    }

    @Test fun fallsBackToYesterdayWhileTodayEmpty() {
        val empty = makeDay(today) { it.copy(complete = false, steps = 0.0, hrResting = 51.0) }
        assertEquals(
            LatestDay(yesterday, "2026-10-14", true, "posledné dáta: včera"),
            LatestDays.latestDay(listOf(yesterday, empty), today, today),
        )
    }

    @Test fun fallsBackWhenTodayMissing() {
        val r = LatestDays.latestDay(listOf(yesterday), today, today)
        assertEquals("2026-10-14", r.date)
        assertTrue(r.fallback)
    }

    @Test fun skipsEmptyDaysAndWordsOlderByDate() {
        val older = makeDay("2026-10-11") { it.copy(steps = 5000.0) }
        val r = LatestDays.latestDay(listOf(older, makeDay("2026-10-13"), makeDay(today)), today, today)
        assertEquals("2026-10-11", r.date)
        assertTrue(r.fallback)
        assertEquals("posledné dáta: ne 11. 10.", r.label)
    }

    @Test fun neverLooksPastFocus() {
        val later = makeDay("2026-10-16") { it.copy(steps = 100.0) }
        val r = LatestDays.latestDay(listOf(yesterday, later), "2026-10-14", today)
        assertEquals("2026-10-14", r.date)
        assertFalse(r.fallback)
    }

    @Test fun keepsEmptyFocusWhenNothingEarlier() {
        val empty = makeDay(today)
        assertEquals(LatestDay(empty, today, false, null), LatestDays.latestDay(listOf(empty), today, today))
        assertEquals(LatestDay(null, today, false, null), LatestDays.latestDay(emptyList(), today, today))
        assertNull(LatestDays.latestDay(emptyList(), today, today).label)
    }

    @Test fun ageLabelWordsAge() {
        assertEquals("dnes", LatestDays.ageLabel(today, today))
        assertEquals("včera", LatestDays.ageLabel("2026-10-14", today))
        assertEquals("predvčerom", LatestDays.ageLabel("2026-10-13", today))
        assertEquals("po 12. 10.", LatestDays.ageLabel("2026-10-12", today))
    }
}
