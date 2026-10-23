package sk.zdravie.app.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import sk.zdravie.app.model.*
import java.time.Instant

class DatasetParserTest {
    private fun parse(vararg days: JSONObject) = DatasetParser.dataset(DataFixtures.dataset(*days))
    private fun one(day: JSONObject) = parse(day).days.single()

    @Test fun fullDayParses() {
        val day = one(DataFixtures.fullDay())
        assertEquals("2026-10-20", day.day)
        assertEquals("Europe/Prague", day.timezone)
        assertEquals("productive", day.scores!!.cardioLoad.status)
        assertEquals(5, day.sleepTimeline.size)
        assertEquals(SleepStage.ASLEEP, day.sleepTimeline.last().stage)
        assertEquals(SleepStage.AWAKE, day.sleepTimeline[3].stage)
        assertEquals(11.4, day.workouts[0].strain!!, 0.0)
        assertEquals(Selected(9600.0, ValueSource.MEASURED), day.distance)
        assertEquals(Selected(500.0, ValueSource.DERIVED), day.activeKcal)
        assertEquals(Selected(2150.0, ValueSource.ESTIMATED), day.totalKcal)
        assertEquals("rmssd", day.hrvKind)
        assertEquals(9100.0, day.steps!!, 0.0)
        assertEquals(Instant.parse("2026-10-19T21:40:00Z"), day.sleepStart)
        assertEquals(Instant.parse("2026-10-20T16:45:00Z"), day.workouts[0].end)
        assertEquals(-0.2, day.scores!!.sleepPerformance!!.components["debt"]!!, 0.0)
        assertEquals("learning", day.scores.energyScore!!.note)
        assertNull(day.scores.energyScore.value)
        assertEquals(83.0, day.samsungAuto!!.sleepScore!!, 0.0)
        assertEquals("Europe/Bratislava", parse(DataFixtures.fullDay()).timezone)
        assertEquals(Instant.parse("2026-10-20T08:30:00Z"), parse(DataFixtures.fullDay()).syncedAt)
    }

    @Test fun absentSelectedFieldIsNull() {
        val raw = DataFixtures.fullDay()
        raw.remove("distance_m")
        assertNull(one(raw).distance)
        raw.put("distance_m", JSONObject.NULL)
        assertEquals(Selected(null, ValueSource.MEASURED), one(raw).distance)
        raw.remove("distance_m_source")
        assertEquals(Selected(null, null), one(raw).distance)
    }

    @Test fun badValueDropsOnlyThatField() {
        val day = one(DataFixtures.fullDay().put("steps", "x"))
        assertNull(day.steps)
        assertEquals(53.0, day.hrResting!!, 0.0)
        assertEquals(1, day.workouts.size)
        assertNotNull(day.scores)
        assertNull(one(DataFixtures.fullDay().put("steps", -5)).steps)
        assertNull(one(DataFixtures.fullDay().put("sleep_start", "not a time")).sleepStart)
    }

    @Test fun unknownEnumsAreNull() {
        val raw = DataFixtures.fullDay()
        raw.getJSONObject("scores").getJSONObject("cardio_load").put("status", "zzz")
        raw.put("distance_m_source", "guess")
        val day = one(raw)
        assertNull(day.scores!!.cardioLoad.status)
        assertEquals(Selected(9600.0, null), day.distance)
    }

    @Test fun negativeAllowedWhereSigned() {
        val raw = DataFixtures.fullDay()
        raw.getJSONObject("scores").put("sleep_regularity", -12.5)
        raw.getJSONObject("scores").getJSONObject("night_signal").put("delta", -3.0)
        val scores = one(raw).scores!!
        assertEquals(-12.5, scores.sleepRegularity!!, 0.0)
        assertEquals(-3.0, scores.nightSignal.delta!!, 0.0)
        assertNull(one(DataFixtures.fullDay().put("hr_avg", -1)).hrAvg)
    }

    @Test fun invalidDayIsDropped() {
        val result = parse(DataFixtures.fullDay("2026-02-30"), DataFixtures.fullDay("2026-10-21"))
        assertEquals(listOf("2026-10-21"), result.days.map { it.day })
    }

    @Test fun missingDaysFails() {
        assertThrows(Exception::class.java) { DatasetParser.dataset(JSONObject().put("timezone", "Europe/Bratislava")) }
        assertThrows(Exception::class.java) { DatasetParser.dataset(JSONObject().put("days", JSONArray())) }
    }

    @Test fun olderDayWithoutOptionalPartsParses() {
        val day = one(DataFixtures.day())
        assertEquals("Europe/Bratislava", day.timezone)
        assertNull(day.distance)
        assertNull(day.samsungAuto)
        assertTrue(day.sleepTimeline.isEmpty())
        assertNull(day.scores!!.energyScore)
        assertNull(day.scores.whoopAge)
        assertNull(day.scores.cardioLoad.status)
        assertNull(day.scores.nightSignal.level)
        assertEquals(80.0, day.scores.sleepPerformance!!.value!!, 0.0)
        val minimal = one(JSONObject().put("day", "2026-10-20"))
        assertNull(minimal.scores)
        assertFalse(minimal.complete)
        assertTrue(minimal.workouts.isEmpty())
    }

    @Test fun badTimestampsDropOnlyThatIntervalOrWorkout() {
        val raw = DataFixtures.fullDay()
        raw.getJSONArray("sleep_timeline").getJSONObject(0).put("start", "bad")
        raw.getJSONArray("workouts").getJSONObject(0).put("end", "bad")
        val day = one(raw)
        assertEquals(4, day.sleepTimeline.size)
        assertTrue(day.workouts.isEmpty())
        assertEquals(53.0, day.hrResting!!, 0.0)
    }

    @Test fun timezoneFallsBackAndDaysAreSortedAndDeduplicated() {
        val duplicate = DataFixtures.fullDay("2026-10-21").put("steps", 1)
        val result = parse(duplicate, DataFixtures.fullDay("2026-10-20"), DataFixtures.fullDay("2026-10-21"))
        // Same day twice: the last occurrence in the array wins.
        assertEquals(listOf("2026-10-20", "2026-10-21"), result.days.map { it.day })
        assertEquals(9100.0, result.days[1].steps!!, 0.0)
        assertEquals("Europe/Bratislava", one(DataFixtures.fullDay().put("timezone", "Mars/Base")).timezone)
        assertEquals("Europe/Bratislava", one(DataFixtures.fullDay().apply { remove("timezone") }).timezone)
    }
}
