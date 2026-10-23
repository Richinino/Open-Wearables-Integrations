package sk.zdravie.app.logic

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import sk.zdravie.app.logic.LogicFixtures.ZONE
import sk.zdravie.app.logic.LogicFixtures.makeDay
import sk.zdravie.app.logic.LogicFixtures.makeWorkout
import sk.zdravie.app.model.Day

class MetricsTest {
    private fun i(s: String) = Instant.parse(s)

    private fun fortnight(): List<Day> = (0 until 14).map { n ->
        makeDay("2026-06-%02d".format(n + 1)) { it.copy(steps = (n + 1) * 1000.0) }
    }

    @Test fun indexByDayMapsEachDate() {
        val days = listOf(makeDay("2026-06-01"), makeDay("2026-06-03"))
        val index = Metrics.indexByDay(days)
        assertEquals(2, index.size)
        assertSame(days[1], index["2026-06-03"])
        assertNull(index["2026-06-02"])
        assertEquals(0, Metrics.indexByDay(emptyList()).size)
    }

    @Test fun windowEndingConsecutiveWithNullForAbsent() {
        val days = listOf(makeDay("2026-02-27"), makeDay("2026-03-01"), makeDay("2026-03-02"))
        val slots = Metrics.windowEnding(days, "2026-03-02", 5)
        assertEquals(listOf("2026-02-26", "2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"), slots.map { it.day })
        assertEquals(listOf(null, "2026-02-27", null, "2026-03-01", "2026-03-02"), slots.map { it.data?.day })
    }

    @Test fun windowEndingIgnoresDaysOutside() {
        val slots = Metrics.windowEnding(fortnight(), "2026-06-10", 3)
        assertEquals(listOf(8000.0, 9000.0, 10000.0), slots.map { it.data?.steps })
    }

    @Test fun windowEndingEmptyAndZeroLength() {
        assertEquals(
            listOf(DaySlot("2026-06-01", null), DaySlot("2026-06-02", null), DaySlot("2026-06-03", null)),
            Metrics.windowEnding(emptyList(), "2026-06-03", 3),
        )
        assertEquals(emptyList<DaySlot>(), Metrics.windowEnding(fortnight(), "2026-06-03", 0))
    }

    private val seriesDays = listOf(
        makeDay("2026-06-01") { it.copy(steps = 5000.0) },
        makeDay("2026-06-02") { it.copy(steps = null) },
        makeDay("2026-06-04") { it.copy(steps = 0.0) },
        makeDay("2026-06-05") { it.copy(steps = 1200.0, complete = false) },
    )
    private val seriesSlots = Metrics.windowEnding(seriesDays, "2026-06-05", 5)

    @Test fun seriesKeepsNullAndZero() {
        assertEquals(
            listOf(
                Point("2026-06-01", 5000.0), Point("2026-06-02", null), Point("2026-06-03", null),
                Point("2026-06-04", 0.0), Point("2026-06-05", 1200.0),
            ),
            Metrics.series(seriesSlots, DayKey.STEPS),
        )
    }

    @Test fun seriesIncompleteHandling() {
        assertEquals(1200.0, Metrics.series(seriesSlots, DayKey.STEPS).last().value)
        assertEquals(1200.0, Metrics.series(seriesSlots, DayKey.STEPS, includeIncomplete = true).last().value)
        val strict = Metrics.series(seriesSlots, DayKey.STEPS, includeIncomplete = false)
        assertEquals(Point("2026-06-05", null), strict.last())
        assertEquals(5000.0, strict[0].value)
    }

    @Test fun seriesReadsAnyNumericKey() {
        val night = listOf(makeDay("2026-06-01") { it.copy(sleepMinutes = 440.0, hrResting = 52.5) })
        val one = Metrics.windowEnding(night, "2026-06-01", 1)
        assertEquals(440.0, Metrics.series(one, DayKey.SLEEP_MINUTES)[0].value)
        assertEquals(52.5, Metrics.series(one, DayKey.HR_RESTING)[0].value)
        assertNull(Metrics.series(one, DayKey.NAP_MINUTES)[0].value)
    }

    @Test fun seriesNoSlots() {
        assertEquals(emptyList<Point>(), Metrics.series(emptyList(), DayKey.STEPS))
    }

    @Test fun aggregatesSkipNull() {
        val values = listOf(4.0, null, 10.0, null, 1.0)
        assertEquals(5.0, Metrics.average(values)!!, 0.0)
        assertEquals(15.0, Metrics.sum(values)!!, 0.0)
        assertEquals(1.0, Metrics.min(values)!!, 0.0)
        assertEquals(10.0, Metrics.max(values)!!, 0.0)
    }

    @Test fun aggregatesCountZero() {
        assertEquals(5.0, Metrics.average(listOf(0.0, 10.0))!!, 0.0)
        assertEquals(0.0, Metrics.sum(listOf(0.0))!!, 0.0)
        assertEquals(0.0, Metrics.min(listOf(0.0, 5.0))!!, 0.0)
        assertEquals(0.0, Metrics.max(listOf(0.0, -5.0))!!, 0.0)
    }

    @Test fun aggregatesNullWhenNothing() {
        val cases: List<List<Double?>> = listOf(emptyList(), listOf(null), listOf(null, null), listOf(Double.NaN))
        for (values in cases) {
            assertNull(Metrics.average(values))
            assertNull(Metrics.sum(values))
            assertNull(Metrics.min(values))
            assertNull(Metrics.max(values))
        }
    }

    @Test fun periodSummaryComparesWindows() {
        val s = Metrics.periodSummary(fortnight(), "2026-06-14", 7, DayKey.STEPS)
        assertEquals(11000.0, s.average!!, 0.0)
        assertEquals(77000.0, s.total!!, 0.0)
        assertEquals(7, s.count)
        assertEquals(4000.0, s.previousAverage!!, 0.0)
        assertEquals((11000.0 - 4000.0) / 4000.0, s.change!!, 1e-10)
    }

    @Test fun periodSummaryNegativeChange() {
        val days = listOf(makeDay("2026-06-01") { it.copy(hrResting = 60.0) }, makeDay("2026-06-02") { it.copy(hrResting = 54.0) })
        assertEquals(-0.1, Metrics.periodSummary(days, "2026-06-02", 1, DayKey.HR_RESTING).change!!, 1e-10)
    }

    @Test fun periodSummaryLeavesIncompleteOutByDefault() {
        val days = fortnight().toMutableList()
        days[13] = makeDay("2026-06-14") { it.copy(steps = 300.0, complete = false) }
        val strict = Metrics.periodSummary(days, "2026-06-14", 7, DayKey.STEPS)
        assertEquals(6, strict.count)
        assertEquals(8000.0 + 9000 + 10000 + 11000 + 12000 + 13000, strict.total!!, 0.0)
        assertEquals(10500.0, strict.average!!, 0.0)
        val loose = Metrics.periodSummary(days, "2026-06-14", 7, DayKey.STEPS, includeIncomplete = true)
        assertEquals(7, loose.count)
        assertEquals(63300.0, loose.total!!, 0.0)
    }

    @Test fun periodSummaryCountsContributingDays() {
        val days = listOf(
            makeDay("2026-06-01") { it.copy(steps = 4000.0) },
            makeDay("2026-06-02") { it.copy(steps = null) },
            makeDay("2026-06-04") { it.copy(steps = 8000.0) },
        )
        val s = Metrics.periodSummary(days, "2026-06-05", 5, DayKey.STEPS)
        assertEquals(2, s.count)
        assertEquals(6000.0, s.average!!, 0.0)
        assertEquals(12000.0, s.total!!, 0.0)
    }

    @Test fun periodSummaryNoUsablePrevious() {
        val noHistory = Metrics.periodSummary(fortnight().drop(7), "2026-06-14", 7, DayKey.STEPS)
        assertEquals(11000.0, noHistory.average!!, 0.0)
        assertNull(noHistory.previousAverage)
        assertNull(noHistory.change)

        val zeroBefore = listOf(makeDay("2026-06-01") { it.copy(steps = 0.0) }, makeDay("2026-06-02") { it.copy(steps = 500.0) })
        val fromZero = Metrics.periodSummary(zeroBefore, "2026-06-02", 1, DayKey.STEPS)
        assertEquals(0.0, fromZero.previousAverage!!, 0.0)
        assertNull(fromZero.change)

        val nothingNow = Metrics.periodSummary(fortnight(), "2026-06-21", 7, DayKey.STEPS)
        assertNull(nothingNow.average)
        assertNull(nothingNow.total)
        assertEquals(0, nothingNow.count)
        assertEquals(11000.0, nothingNow.previousAverage!!, 0.0)
        assertNull(nothingNow.change)
    }

    @Test fun periodSummaryEmptyInput() {
        assertEquals(PeriodSummary(null, null, 0, null, null), Metrics.periodSummary(emptyList(), "2026-06-14", 7, DayKey.STEPS))
    }

    @Test fun allWorkoutsNewestFirst() {
        val days = listOf(
            makeDay("2026-06-09") { it.copy(workouts = listOf(makeWorkout("a") { w -> w.copy(start = i("2026-06-09T06:00:00Z")) })) },
            makeDay("2026-06-10") {
                it.copy(
                    workouts = listOf(
                        makeWorkout("b") { w -> w.copy(start = i("2026-06-10T07:00:00Z")) },
                        makeWorkout("c") { w -> w.copy(start = i("2026-06-10T17:00:00Z")) },
                    ),
                )
            },
            makeDay("2026-06-11"),
        )
        assertEquals(listOf("c", "b", "a"), Metrics.allWorkouts(days).map { it.id })
        assertEquals(listOf("b", "c"), days[1].workouts.map { it.id })
    }

    @Test fun allWorkoutsEmpty() {
        assertEquals(emptyList<Any>(), Metrics.allWorkouts(emptyList()))
        assertEquals(emptyList<Any>(), Metrics.allWorkouts(listOf(makeDay("2026-06-09"))))
    }

    @Test fun workoutTotalsAddUp() {
        val t = Metrics.workoutTotals(
            listOf(
                makeWorkout("a") { it.copy(type = "running", durationS = 1800.0, distanceM = 5000.0, kcalEst = 400.0) },
                makeWorkout("b") { it.copy(type = "cycling", durationS = 3600.0, distanceM = 20000.0, kcalEst = null) },
                makeWorkout("c") { it.copy(type = "running", durationS = 2400.0, distanceM = null, kcalEst = 500.0) },
                makeWorkout("d") { it.copy(type = "strength_training", durationS = 3000.0) },
            ),
        )
        assertEquals(4, t.count)
        assertEquals(10800.0, t.seconds, 0.0)
        assertEquals(25000.0, t.distanceM!!, 0.0)
        assertEquals(900.0, t.kcal!!, 0.0)
        assertEquals(
            listOf(TypeTotal("running", 2, 4200.0), TypeTotal("cycling", 1, 3600.0), TypeTotal("strength_training", 1, 3000.0)),
            t.byType,
        )
    }

    @Test fun workoutTotalsNoDistanceOrKcal() {
        val t = Metrics.workoutTotals(listOf(makeWorkout("a"), makeWorkout("b")))
        assertNull(t.distanceM)
        assertNull(t.kcal)
        assertEquals(3600.0, t.seconds, 0.0)
    }

    @Test fun workoutTotalsOrderTypes() {
        val t = Metrics.workoutTotals(
            listOf("yoga", "soccer", "walking", "walking", "cycling").mapIndexed { n, type ->
                makeWorkout("w$n") { it.copy(type = type) }
            },
        )
        assertEquals(listOf("walking", "cycling", "soccer", "yoga"), t.byType.map { it.type })
    }

    @Test fun workoutTotalsEmpty() {
        assertEquals(WorkoutTotals(0, 0.0, null, null, emptyList()), Metrics.workoutTotals(emptyList()))
    }

    @Test fun sleepNightsFromNoon() {
        val days = listOf(
            makeDay("2026-07-15") {
                it.copy(
                    sleepStart = i("2026-07-14T20:30:00Z"), sleepEnd = i("2026-07-15T05:00:00Z"),
                    sleepMinutes = 480.0, sleepDeepMin = 90.0, sleepRemMin = 100.0, sleepLightMin = 290.0,
                    sleepAwakeMin = 30.0, napMinutes = 25.0,
                )
            },
        )
        assertEquals(
            listOf(
                SleepNight(
                    "2026-07-15", i("2026-07-14T20:30:00Z"), i("2026-07-15T05:00:00Z"), 480.0, 90.0, 100.0, 290.0,
                    30.0, 25.0, 630.0, 1140.0,
                ),
            ),
            Metrics.sleepNights(days, ZONE),
        )
    }

    @Test fun sleepNightsAfterMidnight() {
        val night = Metrics.sleepNights(
            listOf(makeDay("2026-01-10") { it.copy(sleepStart = i("2026-01-09T23:15:00Z"), sleepEnd = i("2026-01-10T06:45:00Z")) }),
            ZONE,
        ).single()
        assertEquals(735.0, night.bedMinutes, 0.0)
        assertEquals(735.0 + 450, night.wakeMinutes, 0.0)
        assertNull(night.minutes)
        assertNull(night.nap)
    }

    @Test fun sleepNightsEdges() {
        fun at(start: String) = Metrics.sleepNights(
            listOf(makeDay("2026-01-10") { it.copy(sleepStart = i(start), sleepEnd = i("2026-01-10T07:00:00Z")) }),
            ZONE,
        )[0].bedMinutes
        assertEquals(0.0, at("2026-01-09T11:00:00Z"), 0.0)
        assertEquals(1439.0, at("2026-01-09T10:59:00Z"), 0.0)
        assertEquals(720.0, at("2026-01-09T23:00:00Z"), 0.0)
    }

    @Test fun sleepNightsClocksGoBack() {
        val night = Metrics.sleepNights(
            listOf(makeDay("2026-10-25") { it.copy(sleepStart = i("2026-10-24T20:30:00Z"), sleepEnd = i("2026-10-25T05:00:00Z")) }),
            ZONE,
        ).single()
        assertEquals(630.0, night.bedMinutes, 0.0)
        assertEquals(630.0 + 510, night.wakeMinutes, 0.0)
    }

    @Test fun sleepNightsSkipIncompleteAndSort() {
        val days = listOf(
            makeDay("2026-07-16") { it.copy(sleepStart = i("2026-07-15T21:00:00Z"), sleepEnd = i("2026-07-16T05:00:00Z")) },
            makeDay("2026-07-13") { it.copy(sleepStart = i("2026-07-12T21:00:00Z"), sleepEnd = null) },
            makeDay("2026-07-14") { it.copy(sleepStart = null, sleepEnd = i("2026-07-14T05:00:00Z")) },
            makeDay("2026-07-15") { it.copy(sleepMinutes = 400.0) },
            makeDay("2026-07-12") { it.copy(sleepStart = i("2026-07-11T21:00:00Z"), sleepEnd = i("2026-07-12T05:00:00Z")) },
        )
        assertEquals(listOf("2026-07-12", "2026-07-16"), Metrics.sleepNights(days, ZONE).map { it.day })
        assertEquals(emptyList<SleepNight>(), Metrics.sleepNights(emptyList(), ZONE))
    }

    @Test fun averageClockAroundMidnight() {
        assertEquals(720.0, Metrics.averageClock(listOf(690.0, 750.0))!!, 0.0)
        assertEquals(682.5, Metrics.averageClock(listOf(630.0, 735.0))!!, 0.0)
        assertEquals(1140.0, Metrics.averageClock(listOf(1140.0))!!, 0.0)
        assertNull(Metrics.averageClock(emptyList()))
    }

    private val now = i("2026-10-13T12:00:00Z")

    @Test fun isStaleMissing() {
        assertTrue(Metrics.isStale(null, now))
    }

    @Test fun isStaleDefaultNinety() {
        assertFalse(Metrics.isStale(i("2026-10-13T11:53:00Z"), now))
        assertFalse(Metrics.isStale(i("2026-10-13T10:31:00Z"), now))
        assertFalse(Metrics.isStale(i("2026-10-13T10:30:00Z"), now))
        assertTrue(Metrics.isStale(i("2026-10-13T10:29:59Z"), now))
        assertTrue(Metrics.isStale(i("2026-10-12T12:00:00Z"), now))
    }

    @Test fun isStaleOtherThreshold() {
        assertTrue(Metrics.isStale(i("2026-10-13T11:49:00Z"), now, 10))
        assertFalse(Metrics.isStale(i("2026-10-13T11:51:00Z"), now, 10))
    }

    @Test fun isStaleFutureNotStale() {
        assertFalse(Metrics.isStale(i("2026-10-13T12:05:00Z"), now))
    }
}
