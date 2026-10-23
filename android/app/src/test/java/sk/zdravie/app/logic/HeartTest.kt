package sk.zdravie.app.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import sk.zdravie.app.logic.Dates.addDays
import sk.zdravie.app.logic.Dates.dateRange
import sk.zdravie.app.logic.LogicFixtures.makeDay
import sk.zdravie.app.logic.LogicFixtures.makeScore
import sk.zdravie.app.logic.LogicFixtures.makeScores
import sk.zdravie.app.model.Day
import sk.zdravie.app.model.NightSignal

class HeartTest {
    private val end = "2026-10-15"

    private fun plain(text: String) = text.replace(' ', ' ').replace(' ', ' ')

    private fun signal(level: String?, nightHr: Double?, baseline: Double?, delta: Double?) =
        NightSignal(level, nightHr, baseline, delta)

    @Test fun readinessPartsCoverTheSevenPartsWithTheDocumentedWeights() {
        val parts = Heart.READINESS_PARTS
        assertEquals(7, parts.size)
        assertEquals(0.97, parts.sumOf { it.weight }, 1e-5)
        assertEquals("sleep", parts[0].key)
        assertTrue(parts.all { it.explain.length > 10 })
    }

    private val baselineDays = dateRange(addDays(end, -20), end).mapIndexed { index, day ->
        makeDay(day) { it.copy(hrResting = if (index % 2 == 1) 52.0 else 54.0) }
    }

    @Test fun restingBaselineAveragesTheDaysBeforeTheDateNotTheDateItself() {
        val withSpike = baselineDays.map { if (it.day == end) it.copy(hrResting = 90.0) else it }
        val baseline = Heart.restingBaseline(withSpike, end, 60)!!
        assertEquals(53.0, baseline.mean, 0.5)
        assertEquals(20, baseline.days)
        assertEquals(1.0, baseline.sd, 0.5)
    }

    @Test fun restingBaselineNeedsAWeekOfValues() {
        assertNull(Heart.restingBaseline(baselineDays.takeLast(5), end))
        assertNull(Heart.restingBaseline(emptyList(), end))
    }

    @Test fun restingBaselineNeverReportsASpreadUnder1Bpm() {
        val flat = baselineDays.map { it.copy(hrResting = 50.0) }
        assertEquals(1.0, Heart.restingBaseline(flat, end)!!.sd, 0.0)
    }

    private val baseline = Baseline(mean = 53.0, sd = 2.0, days = 40)

    @Test fun restingComparisonSaysHowFarTheValueIsFromTheUsualAndWhetherThatIsOrdinary() {
        assertEquals(
            "O 1 bpm nižší než tvoj priemer 53 bpm za 40 dní. To je v rámci bežného kolísania.",
            plain(Heart.restingComparison(52.0, baseline)),
        )
        assertTrue(Heart.restingComparison(49.0, baseline).contains("dobré zotavenie"))
        assertTrue(Heart.restingComparison(58.0, baseline).contains("vyšší"))
        assertTrue(Heart.restingComparison(53.2, baseline).contains("Rovnaký"))
    }

    @Test fun restingComparisonExplainsAMissingValueOrBaseline() {
        assertTrue(Heart.restingComparison(null, baseline).contains("chýba"))
        assertTrue(Heart.restingComparison(52.0, null).contains("málo dní"))
    }

    @Test fun signalStatusWordsAGreenNightAndAMissingOne() {
        val green = Heart.signalStatus(signal("green", 58.2, 57.9, 0.3))
        assertEquals("green", green.level)
        assertEquals("Nočný tep je v norme", green.title)
        assertTrue(plain(green.text).contains("Nočný tep 58 bpm, tvoj normál 58 bpm"))
        assertNull(Heart.signalStatus(null).level)
        assertNull(Heart.signalStatus(signal(null, null, null, null)).level)
    }

    @Test fun signalStatusUsesTheOverviewsWarningWordsForYellowAndRed() {
        assertEquals("red", Heart.signalStatus(signal("red", 63.0, 58.0, 5.0)).level)
        assertEquals("Nočný tep bol vyšší než zvyčajne", Heart.signalStatus(signal("yellow", 61.0, 58.0, 3.0)).title)
    }

    private val levels = listOf("green", "yellow", "green", "red", "red", null, "green")
    private val signalDays: List<Day> = levels.mapIndexed { index, level ->
        val day = addDays(end, index - (levels.size - 1))
        makeDay(day) {
            it.copy(
                scores = makeScores(day) { s ->
                    s.copy(nightSignal = signal(level, 60.0 + index, 57.0, if (level == "green") 1.0 else 4.0))
                },
            )
        }
    }

    @Test fun signalNightsListsYellowAndRedNightsInTheWindowNewestFirst() {
        val old = makeDay("2026-01-01") {
            it.copy(scores = makeScores("2026-01-01") { s -> s.copy(nightSignal = signal("red", 70.0, 57.0, 13.0)) })
        }
        val nights = Heart.signalNights(signalDays + old, end, 90)
        assertEquals(
            listOf("2026-10-13" to "red", "2026-10-12" to "red", "2026-10-10" to "yellow"),
            nights.map { it.day to it.level },
        )
    }

    @Test fun signalNightTextDescribesANightInOneLine() {
        val red = Heart.signalNights(signalDays, end).first()
        assertEquals(
            "Nočný tep 64 bpm, o 4 bpm nad normálom (57 bpm), druhá zvýšená noc po sebe.",
            plain(Heart.signalNightText(red)),
        )
        assertEquals(
            "Nočný tep nad normálom.",
            Heart.signalNightText(SignalNight(end, "yellow", null, null, null)),
        )
    }

    @Test fun nightHeartSeriesGivesTheNightHeartRateAndBaselineForEveryDayOfAWindow() {
        val series = Heart.nightHeartSeries(signalDays, end, 8)
        assertEquals(8, series.size)
        assertEquals(NightHeartPoint(addDays(end, -7), null, null, null), series[0])
        assertEquals(66.0, series[7].nightHr!!, 0.0)
        assertEquals(57.0, series[7].baseline!!, 0.0)
        assertEquals("green", series[7].level)
    }

    @Test fun restingTrendComparesTheLastWeekWithTheSameWeekAPeriodEarlier() {
        val days = dateRange(addDays(end, -40), end).map { day ->
            makeDay(day) { it.copy(hrResting = if (day > addDays(end, -7)) 50.0 else 54.0) }
        }
        val trend = Heart.restingTrend(days, end, 30)
        assertEquals(50.0, trend.recent!!, 0.0)
        assertEquals(54.0, trend.before!!, 0.0)
        assertEquals(-4.0, trend.change!!, 0.0)
        assertNull(Heart.restingTrend(emptyList(), end, 30).change)
    }

    private fun scored(day: String, value: Double?): Day = makeDay(day) {
        it.copy(
            scores = makeScores(day) { s ->
                s.copy(readiness = makeScore(value, emptyMap(), if (value == null) "no sleep recorded" else "estimate"))
            },
        )
    }

    @Test fun readinessDayTakesTheFocusDayWhenItHasAReadinessValue() {
        val days = listOf(scored("2026-10-13", 60.0), scored("2026-10-14", 70.0))
        assertEquals("2026-10-14", Heart.readinessDay(days, "2026-10-14")?.day)
    }

    @Test fun readinessDayFallsBackToTheLatestDayWithAValueWhileTodayHasNone() {
        val days = listOf(scored("2026-10-13", 60.0), scored("2026-10-14", 70.0), scored(end, null))
        assertEquals("2026-10-14", Heart.readinessDay(days, end)?.day)
    }

    @Test fun readinessDayIgnoresDaysAfterTheFocusDay() {
        val days = listOf(scored("2026-10-13", 60.0), scored("2026-10-14", 70.0))
        assertEquals("2026-10-13", Heart.readinessDay(days, "2026-10-13")?.day)
    }

    @Test fun readinessDayKeepsTheFocusDayWhenNoDayHasAValue() {
        val days = listOf(makeDay("2026-10-14"), scored(end, null))
        assertEquals(end, Heart.readinessDay(days, end)?.day)
        assertNull(Heart.readinessDay(emptyList(), end))
        assertNotNull(Heart.readinessDay(days, "2026-10-14"))
    }
}
