package sk.zdravie.app.logic

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import sk.zdravie.app.logic.Format.DASH
import sk.zdravie.app.logic.LogicFixtures.ZONE
import sk.zdravie.app.logic.LogicFixtures.makeDay
import sk.zdravie.app.logic.LogicFixtures.makeScore
import sk.zdravie.app.logic.LogicFixtures.makeScores
import sk.zdravie.app.logic.LogicFixtures.makeWorkout
import sk.zdravie.app.model.DayScores
import sk.zdravie.app.model.NightSignal

class ScoresTest {
    // Spaces inside numbers are U+00A0; compare without them.
    private fun plain(text: String) = text.replace(' ', ' ').replace(' ', ' ')

    private fun at(text: String) = Instant.parse(text)

    @Test fun strainBandFollowsWhoopsFourBands() {
        assertEquals("light", Scores.strainBand(0.0)?.key)
        assertEquals("light", Scores.strainBand(9.9)?.key)
        assertEquals("moderate", Scores.strainBand(10.0)?.key)
        assertEquals("moderate", Scores.strainBand(13.9)?.key)
        assertEquals("high", Scores.strainBand(14.0)?.key)
        assertEquals("high", Scores.strainBand(17.9)?.key)
        assertEquals("max", Scores.strainBand(18.0)?.key)
        assertEquals("maximálna záťaž", Scores.strainBand(21.0)?.label)
    }

    @Test fun strainBandHasNoBandWithoutAValue() {
        assertNull(Scores.strainBand(null))
        assertNull(Scores.strainBand(Double.NaN))
    }

    @Test fun readinessIsCutAt85And70And60() {
        val keys = listOf(90.0, 85.0, 84.9, 70.0, 69.0, 60.0, 59.9).map { Scores.readinessBand(it)?.key }
        assertEquals(listOf("optimal", "optimal", "good", "good", "fair", "fair", "low"), keys)
    }

    @Test fun sleepPerformanceIsCutAt85And70() {
        val labels = listOf(100.0, 85.0, 84.0, 70.0, 69.0).map { Scores.sleepPerformanceBand(it)?.label }
        assertEquals(listOf("optimálny", "optimálny", "dostačujúci", "dostačujúci", "slabý"), labels)
    }

    @Test fun appleScoreIsCutAt96And81And61And41OnWholePoints() {
        val keys = listOf(100.0, 96.0, 95.0, 81.0, 80.6, 61.0, 60.0, 41.0, 40.0).map { Scores.appleSleepBand(it)?.key }
        assertEquals(
            listOf("very_high", "very_high", "high", "high", "high", "ok", "low", "low", "very_low"),
            keys,
        )
    }

    @Test fun activityIsCutAt85And70() {
        assertEquals(
            listOf("optimal", "good", "low"),
            listOf(85.0, 70.0, 69.9).map { Scores.activityBand(it)?.key },
        )
        assertNull(Scores.activityBand(null))
    }

    @Test fun samsungSleepIsCutAt90And70And50() {
        assertEquals(
            listOf("excellent", "good", "fair", "attention"),
            listOf(90.0, 70.0, 50.0, 49.0).map { Scores.samsungSleepBand(it)?.key },
        )
    }

    @Test fun namesTheDay() {
        assertEquals("výborný deň", Scores.dayScoreLabel(92.0))
        assertEquals("dobrý deň", Scores.dayScoreLabel(78.0))
        assertEquals("priemerný deň", Scores.dayScoreLabel(64.0))
        assertEquals("slabší deň", Scores.dayScoreLabel(40.0))
        assertEquals("skóre zatiaľ nie je", Scores.dayScoreLabel(null))
    }

    @Test fun namesTheCardioLoadStatus() {
        assertEquals("produktívna záťaž", Scores.cardioStatusLabel("productive"))
        assertEquals("preťaženie", Scores.cardioStatusLabel("overreaching"))
        assertEquals(DASH, Scores.cardioStatusLabel(null))
        assertEquals(DASH, Scores.cardioStatusLabel("unknown"))
    }

    @Test fun roundsToWholePointsAndMarksEstimates() {
        assertEquals("81", Scores.formatScore(makeScore(81.4)))
        assertEquals("≈ 82", Scores.formatScore(makeScore(81.6, note = "estimate")))
        assertEquals("≈ 70", Scores.formatScore(makeScore(70.0, note = "estimate; without sleep")))
        assertEquals(DASH, Scores.formatScore(makeScore(null, note = "estimate")))
        assertEquals(DASH, Scores.formatScore(null))
        assertFalse(Scores.isEstimate(makeScore(5.0, note = "without estimate_x")))
    }

    @Test fun keepsOneDecimalOfStrain() {
        assertEquals("13,4", Scores.formatStrain(13.42))
        assertEquals("4,0", Scores.formatStrain(4.0))
        assertEquals(DASH, Scores.formatStrain(null))
    }

    @Test fun translatesOwisNotesAndComponentNames() {
        assertEquals("odhad", Scores.noteText("estimate"))
        assertEquals("zatiaľ málo dát", Scores.noteText("too little history"))
        assertEquals(
            "bez: menej sedenia, pohyb každú hodinu",
            Scores.noteText("without stay_active, move_every_hour"),
        )
        assertEquals(
            "bez fáz spánku; bez: čas zaspatia",
            Scores.noteText("no sleep stages, no stage deductions; without bedtime"),
        )
        assertEquals("something new", Scores.noteText("something new"))
        assertNull(Scores.noteText(null))
        assertEquals("unknown part", Scores.componentLabel("unknown_part"))
        assertEquals("constructor", Scores.componentLabel("constructor"))
    }

    // Bratislava is two hours ahead of UTC in October 2026.
    @Test fun resolveModeIsMorningFrom0400To1459AndEveningFrom1500() {
        assertEquals(ModeResult(Mode.MORNING, "2026-10-15"), Scores.resolveMode(at("2026-10-15T02:00:00Z"), ZONE, null))
        assertEquals(ModeResult(Mode.MORNING, "2026-10-15"), Scores.resolveMode(at("2026-10-15T12:59:00Z"), ZONE, null))
        assertEquals(ModeResult(Mode.EVENING, "2026-10-15"), Scores.resolveMode(at("2026-10-15T13:00:00Z"), ZONE, null))
        assertEquals(ModeResult(Mode.EVENING, "2026-10-15"), Scores.resolveMode(at("2026-10-15T21:59:00Z"), ZONE, null))
    }

    @Test fun resolveModeKeepsTheEveningOfTheDayBeforeUntil0400() {
        assertEquals(ModeResult(Mode.EVENING, "2026-10-15"), Scores.resolveMode(at("2026-10-15T22:30:00Z"), ZONE, null))
        assertEquals(ModeResult(Mode.EVENING, "2026-10-15"), Scores.resolveMode(at("2026-10-16T01:59:00Z"), ZONE, null))
    }

    @Test fun resolveModeCanBeForcedWithRanoOrVecer() {
        val morning = at("2026-10-15T06:00:00Z")
        assertEquals(ModeResult(Mode.EVENING, "2026-10-15"), Scores.resolveMode(morning, ZONE, "vecer"))
        assertEquals(ModeResult(Mode.MORNING, "2026-10-15"), Scores.resolveMode(morning, ZONE, "rano"))
        assertEquals(ModeResult(Mode.MORNING, "2026-10-15"), Scores.resolveMode(morning, ZONE, "nonsense"))
        // At night a forced morning is about the new day.
        assertEquals(ModeResult(Mode.MORNING, "2026-10-16"), Scores.resolveMode(at("2026-10-16T00:30:00Z"), ZONE, "rano"))
        assertEquals(ModeResult(Mode.EVENING, "2026-10-15"), Scores.resolveMode(at("2026-10-16T00:30:00Z"), ZONE, "vecer"))
    }

    @Test fun eveningFrom15UntilFour() {
        assertEquals(900, Scores.EVENING_FROM_MINUTES)
        assertEquals(240, Scores.NIGHT_UNTIL_MINUTES)
        // 14:59 morning, 15:00 evening.
        assertEquals(ModeResult(Mode.MORNING, "2026-10-15"), Scores.resolveMode(at("2026-10-15T12:59:00Z"), ZONE, null))
        assertEquals(ModeResult(Mode.EVENING, "2026-10-15"), Scores.resolveMode(at("2026-10-15T13:00:00Z"), ZONE, null))
        // 03:59 is still the evening of the day before, 04:00 is morning.
        assertEquals(ModeResult(Mode.EVENING, "2026-10-15"), Scores.resolveMode(at("2026-10-16T01:59:00Z"), ZONE, null))
        assertEquals(ModeResult(Mode.MORNING, "2026-10-16"), Scores.resolveMode(at("2026-10-16T02:00:00Z"), ZONE, null))
    }

    @Test fun nightSignalAlertStaysQuietForGreenMissingOrUnknownLevels() {
        assertNull(Scores.nightSignalAlert(NightSignal("green", 58.0, 58.0, 0.0)))
        assertNull(Scores.nightSignalAlert(NightSignal(null, null, null, null)))
        assertNull(Scores.nightSignalAlert(null))
    }

    @Test fun nightSignalAlertWordsYellowAndRedPlainlyWithTheNumbers() {
        val yellow = Scores.nightSignalAlert(NightSignal("yellow", 62.4, 59.1, 3.3))
        assertEquals("yellow", yellow?.level)
        assertTrue(yellow!!.text.contains("o 3 bpm"))
        assertTrue(yellow.text.contains("bežne okolo 59 bpm"))

        val red = Scores.nightSignalAlert(NightSignal("red", 64.0, 59.0, 5.0))
        assertEquals("red", red?.level)
        assertTrue(red!!.title.contains("druhú noc po sebe"))
        assertTrue(red.text.contains("o 5 bpm"))
        assertTrue(red.text.contains("nie diagnóza"))
    }

    @Test fun nightSignalAlertCopesWithoutNumbers() {
        assertTrue(Scores.nightSignalAlert(NightSignal("red", null, null, null))!!.text.contains("citeľne"))
    }

    @Test fun componentExtremesFindsTheLowestAndHighestPresentComponent() {
        val score = makeScore(70.0, mapOf("sleep" to 90.0, "resting_hr" to 40.0, "sleep_balance" to null, "recovery_index" to 95.0))
        assertEquals(
            Extremes(weakest = "resting_hr" to 40.0, strongest = "recovery_index" to 95.0),
            Scores.componentExtremes(score),
        )
        assertEquals(Extremes(null, null), Scores.componentExtremes(makeScore(null, mapOf("sleep" to null))))
        assertEquals(Extremes(null, null), Scores.componentExtremes(null))
    }

    private val previous = makeDay("2026-10-14") {
        it.copy(scores = makeScores("2026-10-14") { s -> s.copy(sleepNeedMinutes = 500.0) })
    }

    @Test fun subScoresGiveAValueABandAndAReasonFromTheirParts() {
        val day = makeDay("2026-10-15") {
            it.copy(
                hrResting = 51.0, steps = 6480.0, sleepMinutes = 456.0,
                workouts = listOf(makeWorkout("w") { w -> w.copy(type = "running", durationS = 55 * 60.0) }),
                scores = makeScores("2026-10-15") { s ->
                    s.copy(
                        readiness = makeScore(81.2, mapOf("resting_hr" to 98.0, "sleep" to 80.0, "sleep_balance" to 52.0), "estimate"),
                        sleepPerformance = makeScore(86.0, mapOf("hours_vs_needed" to 91.0)),
                        activity = makeScore(64.0, mapOf("stay_active" to 40.0)),
                    )
                },
            )
        }
        val (readiness, sleep, activity) = Scores.subScores(day, previous)
        assertEquals("readiness", readiness.key)
        assertEquals("Pripravenosť", readiness.label)
        assertEquals(81.2, readiness.value!!, 0.0)
        assertEquals("≈ 81", readiness.display)
        assertEquals("good", readiness.band?.key)
        assertEquals("pokojový tep 51, pod tvojím priemerom · brzdí spánková bilancia", readiness.reason)
        assertEquals("Výkon spánku", sleep.label)
        assertEquals("7 h 36 min z potrebných 8 h 20 min", sleep.reason)
        assertEquals("Aktivita", activity.label)
        assertEquals("6 480 krokov · beh 55 min", plain(activity.reason))
    }

    @Test fun subScoresSayWhenTheNeedWasCoveredAndNameTheWeakestActivityPart() {
        val day = makeDay("2026-10-15") {
            it.copy(
                hrResting = 58.0, steps = 3000.0, sleepMinutes = 520.0,
                scores = makeScores("2026-10-15") { s ->
                    s.copy(
                        readiness = makeScore(60.0, mapOf("resting_hr" to 50.0, "sleep" to 90.0), "estimate"),
                        sleepPerformance = makeScore(100.0, emptyMap()),
                        activity = makeScore(50.0, mapOf("stay_active" to 40.0, "training_volume" to 70.0)),
                    )
                },
            )
        }
        val (readiness, sleep, activity) = Scores.subScores(day, previous)
        assertEquals("pokojový tep 58, nad tvojím priemerom", readiness.reason)
        assertEquals("8 h 40 min, potreba spánku pokrytá", sleep.reason)
        assertEquals("3 000 krokov · slabšie: menej sedenia", plain(activity.reason))
    }

    @Test fun subScoresExplainMissingScoresWithOwisNote() {
        val day = makeDay("2026-10-15") {
            it.copy(
                scores = makeScores("2026-10-15") { s ->
                    s.copy(
                        readiness = makeScore(null, emptyMap(), "too little history"),
                        sleepPerformance = makeScore(null, emptyMap(), "no sleep recorded"),
                        activity = makeScore(null, emptyMap(), null),
                    )
                },
            )
        }
        val (readiness, sleep, activity) = Scores.subScores(day, null)
        assertNull(readiness.value)
        assertEquals(DASH, readiness.display)
        assertNull(readiness.band)
        assertEquals("zatiaľ málo dát", readiness.reason)
        assertEquals("spánok sa nezaznamenal", sleep.reason)
        assertEquals("zatiaľ sa nedá spočítať", activity.reason)
    }

    @Test fun subScoresWorkOnADayTheApiHasNotScoredYet() {
        val result = Scores.subScores(makeDay("2026-10-15"), null)
        assertEquals(listOf(DASH, DASH, DASH), result.map { it.display })
    }

    // Wake-ups at 06:40 local on school days and 08:30 on weekends, in UTC+2.
    private val wakeDays = listOf("2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11")
        .mapIndexed { index, day ->
            makeDay(day) {
                it.copy(
                    sleepStart = at("${day}T00:00:00Z"),
                    sleepEnd = at(if (index >= 5) "${day}T06:30:00Z" else "${day}T04:${if (index == 2) "50" else "40"}:00Z"),
                )
            }
        }

    @Test fun typicalWakeTakesTheMedianWakeUpOfTheSameKindOfDay() {
        assertEquals(6 * 60 + 40.0, Scores.typicalWake(wakeDays, ZONE, "2026-10-12")!!, 0.0)
        assertEquals(8 * 60 + 30.0, Scores.typicalWake(wakeDays, ZONE, "2026-10-17")!!, 0.0)
        assertNull(Scores.typicalWake(emptyList(), ZONE, "2026-10-12"))
    }

    @Test fun bedtimeForCountsBackTheNeedAndAShortTimeToFallAsleepOnFiveMinutes() {
        assertEquals(21 * 60 + 45.0, Scores.bedtimeFor(520.0, 6 * 60 + 40.0)!!, 0.0)
        assertEquals(20 * 60 + 45.0, Scores.bedtimeFor(480.0, 5 * 60.0)!!, 0.0)
        assertNull(Scores.bedtimeFor(null, 400.0))
        assertNull(Scores.bedtimeFor(500.0, null))
    }

    private val good: DayScores = makeScores("2026-10-15") {
        it.copy(
            readiness = makeScore(88.0), sleepPerformance = makeScore(90.0),
            strain = 13.4, sleepNeedMinutes = 520.0,
        )
    }

    @Test fun morningIsReadFromReadinessAndSleep() {
        assertTrue(Scores.morningSummary(good).contains("oddýchnuté"))
        assertTrue(Scores.morningSummary(good.copy(sleepPerformance = makeScore(60.0))).contains("Spal si menej"))
        assertTrue(Scores.morningSummary(good.copy(readiness = makeScore(65.0))).contains("zotavuje"))
        assertTrue(
            Scores.morningSummary(good.copy(readiness = makeScore(75.0), sleepPerformance = makeScore(80.0)))
                .contains("v poriadku"),
        )
        assertTrue(
            Scores.morningSummary(good.copy(nightSignal = NightSignal("red", 64.0, 59.0, 5.0))).contains("Nočný tep"),
        )
        assertTrue(
            Scores.morningSummary(good.copy(readiness = makeScore(null), sleepPerformance = makeScore(null)))
                .contains("chýbajú"),
        )
        assertTrue(Scores.morningSummary(null).contains("ešte nie je"))
    }

    @Test fun morningSentenceExact() {
        val scores = good.copy(readiness = makeScore(81.0), sleepPerformance = makeScore(86.0))
        assertEquals(
            "Noc bola v poriadku a pripravenosť je dobrá. Bežný deň by mal sedieť.",
            Scores.morningSummary(scores),
        )
    }

    @Test fun eveningIsReadFromStrainAndSleepNeed() {
        assertEquals(
            "Dnešný strain je 13,4, stredná záťaž. Na dnešnú noc potrebuješ asi 8 h 40 min spánku, takže je dobré zaspať okolo 22:05.",
            Scores.eveningSummary(good, 22 * 60 + 5.0),
        )
        assertEquals(
            "Na dnešnú noc potrebuješ asi 8 h 40 min spánku.",
            Scores.eveningSummary(good.copy(strain = null), null),
        )
        assertTrue(Scores.eveningSummary(makeScores("2026-10-15"), null).contains("chýbajú"))
        assertNotNull(Scores.eveningSummary(null, null))
    }
}
