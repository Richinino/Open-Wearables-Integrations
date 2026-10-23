package sk.zdravie.app.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import sk.zdravie.app.logic.LogicFixtures.makeDay
import sk.zdravie.app.logic.LogicFixtures.makeScore
import sk.zdravie.app.logic.LogicFixtures.makeScores
import sk.zdravie.app.logic.LogicFixtures.makeWorkout

class LongTermTest {
    private val end = "2026-10-15" // a Thursday

    @Test fun averagesEachWeekAndDropsLeadingWeeksWithoutValues() {
        val days = listOf(
            makeDay("2026-09-28") { it.copy(hrResting = 50.0) },
            makeDay("2026-09-30") { it.copy(hrResting = 54.0) },
            makeDay("2026-10-13") { it.copy(hrResting = 49.0) },
        )
        assertEquals(
            listOf(
                WeekValue("2026-09-28", 52.0),
                WeekValue("2026-10-05", null),
                WeekValue("2026-10-12", 49.0),
            ),
            LongTerm.weeklyMeans(days, end, 8) { it.hrResting },
        )
    }

    @Test fun weeklyMeansIsEmptyWithoutValues() {
        assertEquals(emptyList<WeekValue>(), LongTerm.weeklyMeans(listOf(makeDay(end)), end) { it.hrResting })
    }

    @Test fun linesUpTheWatchAndTheEstimateOnTheSameWeeks() {
        val days = listOf(
            makeDay("2026-09-30") { it.copy(scores = makeScores("2026-09-30") { s -> s.copy(vo2maxUth = 56.0) }) },
            makeDay("2026-10-06") { it.copy(scores = makeScores("2026-10-06") { s -> s.copy(vo2max = 48.0, vo2maxUth = 58.0) }) },
            makeDay("2026-10-08") { it.copy(scores = makeScores("2026-10-08") { s -> s.copy(vo2max = 49.0) }) },
        )
        assertEquals(
            listOf(
                Vo2Week("2026-09-28", null, 56.0),
                Vo2Week("2026-10-05", 48.5, 58.0),
                Vo2Week("2026-10-12", null, null),
            ),
            LongTerm.vo2maxWeeks(days, end),
        )
    }

    @Test fun findsTheLatestValueOnOrBeforeTheEnd() {
        val days = listOf(
            makeDay("2026-10-10") { it.copy(scores = makeScores("2026-10-10") { s -> s.copy(vo2max = 47.0) }) },
            makeDay("2026-10-12") { it.copy(scores = makeScores("2026-10-12")) },
            makeDay("2026-10-16") { it.copy(scores = makeScores("2026-10-16") { s -> s.copy(vo2max = 50.0) }) },
        )
        assertEquals(LatestValue(47.0, "2026-10-10"), LongTerm.latestValue(days, end) { it.scores?.vo2max })
        assertNull(LongTerm.latestValue(emptyList(), end) { it.hrResting })
    }

    @Test fun comparesTheLastWeeksWithTheFirstOnes() {
        assertEquals(-4.0, LongTerm.seriesChange(listOf(56.0, 56.0, 55.0, 55.0, 53.0, 53.0, 52.0, 52.0), 2)!!, 0.0)
        assertNull(LongTerm.seriesChange(listOf(56.0, 55.0, 54.0), 2))
        assertNull(LongTerm.seriesChange(listOf(null, null, 50.0, 50.0), 2))
    }

    @Test fun wordsTheVo2maxForA17YearOldMale() {
        assertNull(LongTerm.vo2maxLevel(null))
        assertEquals("pod bežnou hodnotou", LongTerm.vo2maxLevel(42.0))
        assertEquals("bežná hodnota", LongTerm.vo2maxLevel(47.0))
        assertEquals("nad bežnou hodnotou", LongTerm.vo2maxLevel(52.0))
        assertEquals("výborná kondícia", LongTerm.vo2maxLevel(55.0))
    }

    @Test fun readsTheAgeBackWithOwisOverlapFactorAndSortsYoungerFirst() {
        val components = linkedMapOf<String, Double?>(
            "steps" to -1.0, "vo2max" to -2.0, "resting_hr" to 1.0, "sleep_duration" to 0.5, "lean_mass" to null,
        )
        // 17 + 0.45 x (-1.5) = 16.325, rounded by owi to 16.3
        val result = LongTerm.bodyAge(makeScore(16.3, components, "estimate"))
        assertNotNull(result)
        assertEquals(17.0, result!!.realAge!!, 0.0)
        assertEquals(0.45, result.factor, 0.0)
        assertEquals(-0.7, result.difference!!, 1e-5)
        assertEquals(listOf("vo2max", "steps", "sleep_duration", "resting_hr"), result.contributions.map { it.key })
        assertEquals("VO2max", result.contributions[0].label)
        assertEquals(-2.0, result.contributions[0].raw, 0.0)
        assertEquals(2 / 4.5, result.contributions[0].share, 1e-5)
        assertEquals(-0.9, result.contributions[0].years, 1e-5)
        assertEquals(listOf("svalová hmota"), result.missing)
        assertEquals("odhad", result.note)
    }

    @Test fun fallsBackToFactor1ForScoresBuiltWithoutTheOverlapFactor() {
        val result = LongTerm.bodyAge(makeScore(15.8, mapOf("steps" to -0.7, "vo2max" to -0.5), "estimate"))
        assertEquals(17.0, result!!.realAge!!, 0.0)
        assertEquals(1.0, result.factor, 0.0)
        assertEquals(-0.7, result.contributions[0].years, 1e-5)
    }

    @Test fun keepsThePartsWhenTheValueIsMissing() {
        val result = LongTerm.bodyAge(makeScore(null, mapOf("steps" to 0.4, "vo2max" to null), "too little history"))!!
        assertNull(result.value)
        assertNull(result.realAge)
        assertNull(result.difference)
        assertEquals(listOf("VO2max"), result.missing)
        assertEquals("zatiaľ málo dát", result.note)
        assertEquals(1, result.contributions.size)
        assertEquals("chýba vek", LongTerm.bodyAge(makeScore(null, emptyMap(), "age missing"))?.note)
        assertNull(LongTerm.bodyAge(null))
    }

    @Test fun addsStrainWorkoutStrainDistanceActiveTimeAndVo2maxToTheOverviewRecords() {
        val days = listOf(
            makeDay("2026-10-01") {
                it.copy(
                    steps = 12000.0, activeMinutesEst = 140.0,
                    scores = makeScores("2026-10-01") { s -> s.copy(strain = 15.2, vo2max = 49.0) },
                    workouts = listOf(
                        makeWorkout("a") { w ->
                            w.copy(day = "2026-10-01", type = "cycling", durationS = 5400.0, strain = 13.1, distanceM = 32000.0)
                        },
                    ),
                )
            },
            makeDay("2026-10-15") {
                it.copy(
                    complete = false, steps = 30000.0, activeMinutesEst = 300.0,
                    scores = makeScores("2026-10-15") { s -> s.copy(strain = 18.0, vo2max = 50.0) },
                    workouts = listOf(
                        makeWorkout("b") { w ->
                            w.copy(day = "2026-10-15", type = "running", durationS = 1800.0, strain = 11.0, distanceM = 6000.0)
                        },
                    ),
                )
            },
        )
        val byKey = LongTerm.longRecords(days, end).associateBy { it.key }
        assertEquals(12000.0, byKey.getValue("steps").value, 0.0)
        assertEquals("2026-10-01", byKey.getValue("steps").day)
        assertEquals(15.2, byKey.getValue("strain").value, 0.0)
        assertEquals("2026-10-01", byKey.getValue("strain").day)
        assertEquals(140.0, byKey.getValue("active").value, 0.0)
        assertEquals(13.1, byKey.getValue("workoutStrain").value, 0.0)
        assertEquals("cycling", byKey.getValue("workoutStrain").type)
        assertEquals(32000.0, byKey.getValue("distance").value, 0.0)
        assertEquals("cycling", byKey.getValue("distance").type)
        assertEquals(50.0, byKey.getValue("vo2max").value, 0.0)
        assertEquals("2026-10-15", byKey.getValue("vo2max").day)
    }

    @Test fun leavesDaysOutsideTheWindowOut() {
        val days = listOf(makeDay("2026-07-01") { it.copy(steps = 50000.0) }, makeDay("2026-10-10") { it.copy(steps = 7000.0) })
        assertEquals(7000.0, LongTerm.longRecords(days, end).first { it.key == "steps" }.value, 0.0)
    }
}
