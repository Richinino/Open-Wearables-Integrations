package sk.zdravie.app.logic

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import sk.zdravie.app.logic.Dates.addDays
import sk.zdravie.app.logic.Dates.dateRange
import sk.zdravie.app.logic.Dates.weekdayIndex
import sk.zdravie.app.logic.LogicFixtures.ZONE
import sk.zdravie.app.logic.LogicFixtures.makeDay
import sk.zdravie.app.logic.LogicFixtures.makeScores
import sk.zdravie.app.logic.LogicFixtures.makeWorkout
import sk.zdravie.app.model.Day
import sk.zdravie.app.model.SleepInterval
import sk.zdravie.app.model.SleepStage

class OverviewTest {
    private val end = "2026-10-15" // a Thursday

    /** Intl groups digits with U+00A0; the web test folds every space to a plain one. */
    private fun plain(text: String) = text.replace(Regex("[\\s  ]"), " ")

    /** [count] days ending at [end], built by [values]. */
    private fun makeRun(count: Int, values: (String, Int) -> (Day) -> Day): List<Day> =
        dateRange(addDays(end, -(count - 1)), end).mapIndexed { index, day -> makeDay(day, values(day, index)) }

    private fun cell(map: Heatmap, day: String) = map.cells.first { it.day == day }

    // --- heatValue ---

    @Test fun leavesOutRunningTotalsOfAnUnfinishedDayButKeepsItsSleepAndHeartRate() {
        val running = makeDay(end) {
            it.copy(complete = false, steps = 3000.0, activeMinutesEst = 20.0, sleepMinutes = 400.0, hrResting = 50.0)
        }
        assertNull(Overview.heatValue(running, HeatMetric.STEPS))
        assertNull(Overview.heatValue(running, HeatMetric.ACTIVE))
        assertEquals(400.0, Overview.heatValue(running, HeatMetric.SLEEP)!!, 0.0)
        assertEquals(50.0, Overview.heatValue(running, HeatMetric.RESTING)!!, 0.0)
        assertNull(Overview.heatValue(null, HeatMetric.STEPS))
    }

    // --- heatmap ---

    private val stepDays = makeRun(84) { _, index -> { it.copy(steps = (index + 1) * 100.0) } }

    @Test fun laysOutWholeWeeksMondayFirstTheLastOneHoldingTheEndDay() {
        val map = Overview.heatmap(stepDays, end, HeatMetric.STEPS)
        assertEquals(84, map.cells.size)
        assertEquals("2026-07-27", map.first)
        assertEquals(0, weekdayIndex(map.first))
        assertEquals("2026-10-18", map.last)
        assertEquals(map.first, map.cells[0].day)
        assertEquals("2026-08-02", map.cells[6].day)
        assertEquals(map.last, map.cells[83].day)
    }

    @Test fun marksTheDaysAfterTheEndAsFutureAndEmpty() {
        val future = Overview.heatmap(stepDays, end, HeatMetric.STEPS).cells.filter { it.future }
        assertEquals(listOf("2026-10-16", "2026-10-17", "2026-10-18"), future.map { it.day })
        assertTrue(future.all { it.value == null && it.level == 0 })
    }

    @Test fun splitsTheWindowsValuesIntoQuartilesAndKeepsLevel0ForMissingDays() {
        val withGap = stepDays.filter { it.day != "2026-09-01" }
        val map = Overview.heatmap(withGap, end, HeatMetric.STEPS)
        val gap = cell(map, "2026-09-01")
        assertNull(gap.value)
        assertEquals(0, gap.level)
        assertFalse(gap.future)
        assertEquals(1, cell(map, "2026-07-27").level)
        assertEquals(4, cell(map, end).level)
        val levels = map.cells.filter { it.value != null }.map { it.level }
        for (level in 1..4) assertTrue(levels.count { it == level } > 15)
        assertEquals(
            withGap.filter { it.day >= map.first }.sumOf { it.steps!! } / 80,
            map.average!!,
            1e-5,
        )
    }

    @Test fun marksAnUnfinishedDayAsRunningForRunningTotalsOnly() {
        val withRunning = stepDays.dropLast(1) + stepDays.last().copy(complete = false, sleepMinutes = 400.0)
        val steps = cell(Overview.heatmap(withRunning, end, HeatMetric.STEPS), end)
        assertNull(steps.value)
        assertEquals(0, steps.level)
        assertTrue(steps.running)
        val sleep = cell(Overview.heatmap(withRunning, end, HeatMetric.SLEEP), end)
        assertEquals(400.0, sleep.value!!, 0.0)
        assertFalse(sleep.running)
    }

    @Test fun heatmapIsEmptyWithoutData() {
        val map = Overview.heatmap(emptyList(), end, HeatMetric.SLEEP)
        assertNull(map.average)
        assertNull(map.thresholds)
        assertTrue(map.cells.all { it.level == 0 })
        assertEquals("za 12 týždňov zatiaľ bez dát", Overview.heatmapNote(map))
    }

    @Test fun listsTheFourHeatMetricsInTheirOrder() {
        assertEquals(
            listOf("Kroky", "Spánok", "Aktívny čas", "Pokojový tep"),
            Overview.HEAT_METRICS.map { it.label },
        )
        assertEquals(
            listOf(HeatMetric.STEPS, HeatMetric.SLEEP, HeatMetric.ACTIVE, HeatMetric.RESTING),
            Overview.HEAT_METRICS.map { it.id },
        )
    }

    // --- heatmapNote ---

    @Test fun namesTheBusiestWeekdayForSteps() {
        val days = makeRun(84) { day, _ -> { it.copy(steps = if (weekdayIndex(day) == 5) 20000.0 else 8000.0) } }
        assertEquals(
            "krokov za deň · najviac bývajú soboty",
            Overview.heatmapNote(Overview.heatmap(days, end, HeatMetric.STEPS)),
        )
        assertEquals(
            "za 12 týždňov zatiaľ bez dát",
            Overview.heatmapNote(Overview.heatmap(days, end, HeatMetric.ACTIVE)),
        )
    }

    @Test fun namesTheShortestNightCountedFromTheEveningItStarts() {
        // Sleep that ends on Saturday morning is the night from Friday to Saturday.
        val days = makeRun(84) { day, _ -> { it.copy(sleepMinutes = if (weekdayIndex(day) == 5) 300.0 else 450.0) } }
        assertEquals(
            "za noc · najkratšie spíš v noci z piatka na sobotu",
            Overview.heatmapNote(Overview.heatmap(days, end, HeatMetric.SLEEP)),
        )
    }

    @Test fun saysHowTheRestingHeartRateMovedOverTheWeeks() {
        val falling = makeRun(84) { _, index -> { it.copy(hrResting = 58 - index / 14.0) } }
        assertTrue(
            Regex("^priemer · za 12 týždňov klesol o \\d bpm$")
                .matches(Overview.heatmapNote(Overview.heatmap(falling, end, HeatMetric.RESTING))),
        )
        val flat = makeRun(84) { _, _ -> { it.copy(hrResting = 52.0) } }
        assertEquals(
            "priemer · za 12 týždňov sa nezmenil",
            Overview.heatmapNote(Overview.heatmap(flat, end, HeatMetric.RESTING)),
        )
    }

    // --- records ---

    private val recordDays: List<Day> = makeRun(100) { day, index ->
        { d ->
            d.copy(
                steps = if (index == 5) 30000.0 else if (index == 50) 24000.0 else 9000.0,
                sleepMinutes = if (index == 60) 540.0 else 420.0,
                hrResting = if (index == 70) 46.0 else 52.0,
                scores = makeScores(day) { s -> s.copy(dayScore = if (index == 80) 92.0 else 70.0) },
                workouts = if (index == 90) {
                    listOf(makeWorkout("long") { w -> w.copy(day = day, type = "cycling", durationS = 9000.0) })
                } else {
                    listOf(makeWorkout("w$index") { w -> w.copy(day = day, durationS = 1800.0) })
                },
            )
        }
    }.let { list -> list.dropLast(1) + list.last().copy(complete = false, steps = 40000.0) }

    @Test fun findsTheBestsOfTheLast90Days() {
        val found = Overview.records(recordDays, end)
        assertEquals(listOf("steps", "sleep", "resting", "workout", "dayScore"), found.map { it.key })
        val byKey = found.associateBy { it.key }
        // Day 5 is older than 90 days and the unfinished day does not count for steps.
        assertEquals(RecordItem("steps", 24000.0, recordDays[50].day), byKey.getValue("steps"))
        assertEquals(recordDays[60].day, byKey.getValue("sleep").day)
        assertEquals(RecordItem("resting", 46.0, recordDays[70].day), byKey.getValue("resting"))
        assertEquals(RecordItem("workout", 9000.0, recordDays[90].day, "cycling"), byKey.getValue("workout"))
        assertEquals(92.0, byKey.getValue("dayScore").value, 0.0)
    }

    @Test fun keepsTheEarlierDayOnATieAndSkipsWhatIsMissing() {
        val tie = makeRun(5) { _, _ -> { it.copy(steps = 5000.0) } }
        assertEquals(listOf(RecordItem("steps", 5000.0, tie[0].day)), Overview.records(tie, end))
        assertEquals(emptyList<RecordItem>(), Overview.records(emptyList(), end))
    }

    // --- weekCards ---

    @Test fun coversTheSevenDaysEndingAtTheEndDay() {
        val days = makeRun(40) { day, index ->
            { d ->
                d.copy(
                    steps = if (index == 39) 5000.0 else 10000.0,
                    sleepMinutes = 420.0,
                    scores = makeScores(day) { s -> s.copy(dayScore = 75.0) },
                    workouts = if (index == 38) {
                        listOf(
                            makeWorkout("a") { w -> w.copy(type = "walking", durationS = 1200.0) },
                            makeWorkout("b") { w -> w.copy(durationS = 3000.0) },
                        )
                    } else {
                        emptyList()
                    },
                )
            }
        }
        val cards = Overview.weekCards(days.filter { it.day != addDays(end, -3) }, end)
        assertEquals(dateRange(addDays(end, -6), end), cards.map { it.day })
        assertEquals(5000.0, cards[6].steps!!, 0.0)
        assertEquals(0.5, cards[6].stepsShare!!, 0.0)
        assertEquals(420.0, cards[6].sleepMinutes!!, 0.0)
        assertEquals(75.0, cards[6].dayScore!!, 0.0)
        assertNull(cards[6].workout)
        assertEquals(WeekWorkout("running", 50.0), cards[5].workout)
        assertEquals(1.0, cards[5].stepsShare!!, 0.0)
        assertNull(cards[3].data)
        assertNull(cards[3].steps)
        assertNull(cards[3].stepsShare)
        assertNull(cards[3].dayScore)
    }

    // --- sleepSegments ---

    private val nightValues = { d: Day ->
        d.copy(
            sleepStart = Instant.parse("2026-10-14T21:00:00Z"),
            sleepEnd = Instant.parse("2026-10-15T05:00:00Z"),
            sleepDeepMin = 90.0, sleepRemMin = 100.0, sleepLightMin = 270.0, sleepAwakeMin = 20.0,
        )
    }

    private fun interval(start: String, stage: SleepStage, endText: String) =
        SleepInterval(Instant.parse(start), Instant.parse(endText), stage)

    @Test fun followsTheTimelineMergesRepeatsAndDropsWhatLiesOutsideTheMainSleep() {
        val day = makeDay(end) {
            nightValues(it).copy(
                sleepTimeline = listOf(
                    interval("2026-10-14T13:00:00Z", SleepStage.ASLEEP, "2026-10-14T13:30:00Z"),
                    interval("2026-10-14T21:00:00Z", SleepStage.LIGHT, "2026-10-14T21:30:00Z"),
                    interval("2026-10-14T21:30:00Z", SleepStage.LIGHT, "2026-10-14T22:00:00Z"),
                    interval("2026-10-14T22:00:00Z", SleepStage.DEEP, "2026-10-14T23:00:00Z"),
                    interval("2026-10-14T23:00:00Z", SleepStage.AWAKE, "2026-10-14T23:05:00Z"),
                    interval("2026-10-14T23:05:00Z", SleepStage.REM, "2026-10-14T23:05:00Z"),
                ),
            )
        }
        assertEquals(
            listOf(
                StageSegment(SleepStage.LIGHT, 60.0),
                StageSegment(SleepStage.DEEP, 60.0),
                StageSegment(SleepStage.AWAKE, 5.0),
            ),
            Overview.sleepSegments(day),
        )
    }

    @Test fun fallsBackToOneBlockPerStageAndToNothing() {
        assertEquals(
            listOf(
                StageSegment(SleepStage.LIGHT, 270.0),
                StageSegment(SleepStage.DEEP, 90.0),
                StageSegment(SleepStage.REM, 100.0),
                StageSegment(SleepStage.AWAKE, 20.0),
            ),
            Overview.sleepSegments(makeDay(end, nightValues)),
        )
        assertEquals(emptyList<StageSegment>(), Overview.sleepSegments(makeDay(end)))
        assertEquals(emptyList<StageSegment>(), Overview.sleepSegments(null))
    }

    // --- sleepWindow ---

    @Test fun averagesBedtimeAndWakeUpOfRecentNightsWithTheBedtimeSpread() {
        // 23:00 and 23:40 local bedtimes (UTC+2), up at 07:00.
        val days = makeRun(4) { day, index ->
            { d ->
                d.copy(
                    sleepStart = Instant.parse("${addDays(day, -1)}T${if (index % 2 == 1) "21:40" else "21:00"}:00Z"),
                    sleepEnd = Instant.parse("${day}T05:00:00Z"),
                    sleepMinutes = 420.0,
                )
            }
        }
        assertEquals(
            SleepWindow(23 * 60.0 + 20, 7 * 60.0, 20.0, 4),
            Overview.sleepWindow(days, ZONE, end),
        )
        assertNull(Overview.sleepWindow(days.take(2), ZONE, end))
    }

    // --- nightWeekday ---

    @Test fun isTheWeekdayTheNightStartedOn() {
        assertEquals(4, Overview.nightWeekday("2026-10-17")) // Saturday morning: Friday's night
        assertEquals(6, Overview.nightWeekday("2026-10-12")) // Monday morning: Sunday's night
    }

    // --- insights ---

    private val insightDays = makeRun(40) { day, index ->
        val weekday = weekdayIndex(day)
        val change: (Day) -> Day = { d ->
            d.copy(
                steps = if (weekday >= 5) 16000.0 else 10000.0,
                // Saturday mornings end the short night from Friday.
                sleepMinutes = if (weekday == 5) 330.0 else 450.0,
                hrResting = 56 - index * 0.12,
            )
        }
        change
    }

    @Test fun comparesWeekendAndWeekdaySteps() {
        val found = Overview.insights(insightDays, end).first { it.key == "weekendSteps" }
        assertEquals("Cez víkendy prejdeš o 60 % viac než v pracovné dni.", found.text)
        assertEquals("16 000 oproti 10 000 krokom", plain(found.detail))
        assertEquals(listOf(false, false, false, false, false, true, true), found.bars.map { it.highlight })
        assertEquals("/kroky", found.href)
        assertEquals("accent", found.tone)
    }

    @Test fun namesTheShortestNight() {
        val found = Overview.insights(insightDays, end).first { it.key == "shortNight" }
        assertEquals("Najkratšie spíš v noci z piatka na sobotu, priemerne 5 h 30 min.", found.text)
        assertEquals("ostatné noci 7 h 30 min", found.detail)
        assertEquals(4, found.bars.indexOfFirst { it.highlight })
    }

    @Test fun followsTheRestingHeartRateOverAMonth() {
        val found = Overview.insights(insightDays, end).first { it.key == "restingTrend" }
        assertEquals("Pokojový tep ti za mesiac klesol o 4 bpm.", found.text)
        assertTrue(found.detail.startsWith("z 55 na 52 · "))
        assertEquals(8, found.bars.size)
        assertTrue(found.bars[7].highlight)
    }

    @Test fun saysWhenThingsAreEvenAndStaysSilentWithoutEnoughData() {
        val even = makeRun(40) { _, _ -> { it.copy(steps = 9000.0, sleepMinutes = 440.0, hrResting = 52.0) } }
        assertEquals(
            listOf(
                "Cez víkendy a v pracovné dni prejdeš zhruba rovnako.",
                "Spíš podobne dlho každú noc, okolo 7 h 20 min.",
                "Pokojový tep je za mesiac stabilný, okolo 52 bpm.",
            ),
            Overview.insights(even, end).map { it.text },
        )
        assertEquals(emptyList<Insight>(), Overview.insights(makeRun(5) { _, _ -> { it.copy(steps = 9000.0) } }, end))
    }

    @Test fun givesTheBarsACommonRange() {
        val bars = listOf(InsightBar("a", 3.0, false), InsightBar("b", null, false), InsightBar("c", 9.0, false))
        assertEquals(BarRange(3.0, 9.0), Overview.barRange(bars))
    }
}
