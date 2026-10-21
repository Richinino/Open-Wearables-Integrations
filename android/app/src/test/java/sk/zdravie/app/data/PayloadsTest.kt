package sk.zdravie.app.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PayloadsTest {
    private val now = 1_792_540_800_000L

    @Test fun selectedDistanceNullDoesNotFallBackButRestingHeartRateDoes() {
        val selected = DataFixtures.day("2026-10-18").put("distance_m", 1400.0)
            .put("distance_m_source", "measured").put("resting_hr", 63.0).put("resting_hr_source", "measured")
            .put("hrv_ms", 42.0).put("hrv_kind", "rmssd")
        val missing = DataFixtures.day("2026-10-19").put("distance_m", JSONObject.NULL)
            .put("distance_m_source", JSONObject.NULL).put("resting_hr", JSONObject.NULL).put("resting_hr_source", JSONObject.NULL)
        val legacy = DataFixtures.day("2026-10-20")
        val days = Payloads.days(DataFixtures.dataset(legacy, missing, selected), "performance")
        assertEquals(listOf("2026-10-18", "2026-10-19", "2026-10-20"), days.map { it.day })
        assertEquals(1400.0, days[0].distanceMeters!!, 0.0)
        assertEquals("measured", days[0].distanceSource)
        assertEquals(63.0, days[0].restingHr!!, 0.0)
        assertEquals("measured", days[0].restingHrSource)
        assertEquals("rmssd", days[0].hrvKind)
        assertNull(days[1].distanceMeters)
        assertNull(days[1].distanceSource)
        assertEquals(53.0, days[1].restingHr!!, 0.0)
        assertEquals("derived", days[1].restingHrSource)
        assertEquals(3900.0, days[2].distanceMeters!!, 0.0)
        assertEquals("estimated", days[2].distanceSource)
    }

    @Test fun sleepPreferenceUsesTheChosenScoreAndSamsungsOwnMeasurementFirst() {
        val day = DataFixtures.day().put("samsung_auto", JSONObject().put("sleep_score", 91.0))
        val body = DataFixtures.dataset(day)
        assertEquals(80.0, Payloads.days(body, "performance").single().sleepScore!!, 0.0)
        assertFalse(Payloads.days(body, "performance").single().sleepScoreEstimated)
        assertEquals(81.0, Payloads.days(body, "apple").single().sleepScore!!, 0.0)
        assertFalse(Payloads.days(body, "apple").single().sleepScoreEstimated)
        assertEquals(91.0, Payloads.days(body, "samsung").single().sleepScore!!, 0.0)
        assertFalse(Payloads.days(body, "samsung").single().sleepScoreEstimated)
        day.getJSONObject("samsung_auto").put("sleep_score", JSONObject.NULL)
        assertEquals(82.0, Payloads.days(body, "samsung").single().sleepScore!!, 0.0)
        assertTrue(Payloads.days(body, "samsung").single().sleepScoreEstimated)
        day.getJSONObject("scores").getJSONObject("samsung_sleep").put("value", JSONObject.NULL)
        assertNull(Payloads.days(body, "samsung").single().sleepScore)
        assertFalse(Payloads.days(body, "samsung").single().sleepScoreEstimated)
        day.getJSONObject("scores").getJSONObject("apple_sleep").put("value", JSONObject.NULL)
        assertNull(Payloads.days(body, "apple").single().sleepScore)
        assertThrows(IllegalArgumentException::class.java) { Payloads.days(body, "unknown") }
    }

    @Test fun nullAndMissingMeasurementsRemainMissingRatherThanZero() {
        val day = JSONObject().put("day", "2026-10-20").put("complete", false)
            .put("steps", JSONObject.NULL).put("sleep_minutes", JSONObject.NULL).put("hr_resting", JSONObject.NULL)
        val parsed = Payloads.days(DataFixtures.dataset(day), "performance").single()
        assertNull(parsed.steps)
        assertNull(parsed.distanceMeters)
        assertNull(parsed.restingHr)
        assertNull(parsed.sleepScore)
        assertNull(parsed.readiness)
        assertEquals(emptyList<Any>(), parsed.workouts)
        assertFalse(parsed.complete)
    }

    @Test fun duplicateDaysAndNonCanonicalDatesAreRejected() {
        assertThrows(IllegalArgumentException::class.java) {
            Payloads.days(DataFixtures.dataset(DataFixtures.day(), DataFixtures.day()), "performance")
        }
        listOf("2026-1-01", "2026-02-30", "2026-10-20T00:00:00Z").forEach {
            assertThrows(Exception::class.java) { Payloads.days(DataFixtures.dataset(DataFixtures.day(it)), "performance") }
        }
    }

    @Test fun sessionExpiryIsAFutureSafeIntegerWithinItsLifetime() {
        val valid = DataFixtures.sessionJson(expiresAt = now + 1000)
        assertEquals(now + 1000, Payloads.session(valid, now).expiresAt)
        listOf<Any>(now, now - 1, now + 12 * 60 * 60 * 1000 + 5 * 60 * 1000 + 1, "$now", now + 1.5, Long.MAX_VALUE).forEach { expiry ->
            assertThrows(Exception::class.java) { Payloads.session(DataFixtures.sessionJson().put("expiresAt", expiry), now) }
        }
        val persistent = DataFixtures.sessionJson(expiresAt = now + 30L * 24 * 60 * 60 * 1000, persistent = true)
        assertTrue(Payloads.session(persistent, now).persistent)
        persistent.put("expiresAt", now + 30L * 24 * 60 * 60 * 1000 + 5 * 60 * 1000 + 1)
        assertThrows(IllegalArgumentException::class.java) { Payloads.session(persistent, now) }
    }

    @Test fun ordinaryClockSkewIsAllowedOnlyAtTheUpperExpiryBound() {
        listOf(false, true).forEach { persistent ->
            val lifetime = if (persistent) 30L * 24 * 60 * 60 * 1000 else 12L * 60 * 60 * 1000
            listOf(60_000L, 300_000L).forEach { skew ->
                val session = Payloads.session(DataFixtures.sessionJson(expiresAt = now + lifetime + skew, persistent = persistent), now)
                val cookie = DataFixtures.credential(session)
                SessionCookies.matches(SessionCookies.checked(cookie, now), session)
                assertThrows(IllegalArgumentException::class.java) { SessionCookies.checked(cookie.copy(expiresAt = cookie.expiresAt + 1), now) }
            }
            val overlong = DataFixtures.credential(Payloads.session(DataFixtures.sessionJson(expiresAt = now + lifetime, persistent = persistent), now))
            assertThrows(IllegalArgumentException::class.java) { SessionCookies.checked(overlong, now - 300_001L) }
            assertThrows(IllegalArgumentException::class.java) { SessionCookies.checked(overlong, overlong.expiresAt) }
        }
    }

    @Test fun sourceTimezoneIsValidatedAndPreservesTheOriginalDayAndWorkoutInstant() {
        val workout = JSONObject().put("id", "synthetic-workout").put("type", "walk").put("start", "2026-10-20T23:30:00Z")
        val day = DataFixtures.day("2026-10-21").put("workouts", org.json.JSONArray().put(workout))
        val dataset = DataFixtures.dataset(day)
        val inherited = Payloads.days(dataset, "performance").single()
        assertEquals("Europe/Bratislava", inherited.timezone)
        assertEquals("2026-10-21", inherited.day)
        assertEquals("2026-10-20T23:30:00Z", inherited.workouts.single().start)
        day.put("timezone", "Europe/London")
        assertEquals("Europe/London", Payloads.days(dataset, "performance").single().timezone)
        dataset.remove("timezone")
        assertEquals("Europe/London", Payloads.days(dataset, "performance").single().timezone)
        day.remove("timezone")
        assertThrows(Exception::class.java) { Payloads.days(dataset, "performance") }
        listOf<Any>("Europe/Unknown", "", 42, true).forEach { invalid ->
            dataset.put("timezone", invalid)
            assertThrows(Exception::class.java) { Payloads.days(dataset, "performance") }
        }
        dataset.put("timezone", "Europe/Bratislava")
        day.put("timezone", "invalid")
        assertThrows(Exception::class.java) { Payloads.days(dataset, "performance") }
    }

    @Test fun sessionAndIdentityFieldsCannotBeCoercedOrUseUnknownSettings() {
        val mutations: List<(JSONObject) -> Unit> = listOf(
            { it.put("persistent", "false") },
            { it.getJSONObject("account").put("paired", "true") },
            { it.getJSONObject("account").put("role", "superuser") },
            { it.getJSONObject("account").put("status", "suspended") },
            { it.getJSONObject("account").getJSONObject("settings").put("theme", "unknown") },
            { it.getJSONObject("account").getJSONObject("settings").put("sleep_score", "unknown") },
            { it.getJSONObject("identity").put("sessionVersion", "2") },
            { it.getJSONObject("identity").put("sessionVersion", 2.5) },
            { it.getJSONObject("identity").put("viewOnly", "false") },
            { it.getJSONObject("identity").put("viewOnly", true) },
            { it.getJSONObject("identity").put("dataAccountId", "account_b") },
            { it.getJSONObject("identity").put("unexpected", true) }
        )
        mutations.forEach { mutate ->
            assertThrows(Exception::class.java) { Payloads.session(DataFixtures.sessionJson(expiresAt = now + 1000).also(mutate), now) }
        }
    }

    @Test fun synchronizedTimePrefersComputeSuccessAndRejectsMalformedAlternatives() {
        val body = DataFixtures.dataset().put("last_compute_success_at", "2026-10-20T09:00:00Z")
        assertEquals("2026-10-20T09:00:00Z", Payloads.syncedAt(body))
        body.put("last_compute_success_at", JSONObject.NULL)
        assertEquals("2026-10-20T08:30:00Z", Payloads.syncedAt(body))
        body.put("synced_at", JSONObject.NULL)
        assertNull(Payloads.syncedAt(body))
        body.put("synced_at", "invalid")
        assertThrows(Exception::class.java) { Payloads.syncedAt(body) }
    }
}
