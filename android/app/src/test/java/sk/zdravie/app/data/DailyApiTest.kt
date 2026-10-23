package sk.zdravie.app.data

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import sk.zdravie.app.model.*
import java.util.concurrent.TimeUnit

class DailyApiTest {
    private lateinit var server: MockWebServer
    private lateinit var client: OkHttpClient
    private lateinit var api: ZdravieApi
    private lateinit var session: AppSession
    private lateinit var credential: SessionCredential
    private val day = "2026-10-22"

    @Before fun setUp() {
        val certificate = HeldCertificate.Builder().commonName("localhost")
            .addSubjectAlternativeName("localhost").addSubjectAlternativeName("127.0.0.1")
            .addSubjectAlternativeName("::1").build()
        val serverCertificates = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val trusted = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        server = MockWebServer().apply { useHttps(serverCertificates.sslSocketFactory(), false); start() }
        client = OkHttpClient.Builder().sslSocketFactory(trusted.sslSocketFactory(), trusted.trustManager)
            .callTimeout(5, TimeUnit.SECONDS).build()
        api = ZdravieApi(server.url("/"), client)
        session = Payloads.session(DataFixtures.sessionJson())
        credential = DataFixtures.credential(session)
    }

    @After fun tearDown() { server.shutdown() }

    private fun ok(body: JSONObject, status: Int = 200, identity: String? = Payloads.identityJson(session.identity)) =
        MockResponse().setResponseCode(status).setHeader("Content-Type", "application/json").setBody(body.toString())
            .also { if (identity != null) it.setHeader("x-zdravie-identity", identity) }
    private fun failure(status: Int, action: () -> Unit): ApiFailure {
        val error = assertThrows(ApiFailure::class.java, action)
        assertEquals(status, error.status)
        return error
    }
    private fun item(key: String = "sleep_duration", delta: Double? = -60.0) = JSONObject()
        .put("id", "$day:$key").put("rule_id", key).put("rule_version", "1").put("message_key", key)
        .put("kind", "observation").put("evidence", JSONObject().put("metric", "sleep_minutes")
            .put("unit", "min").put("current", 390).put("reference", 450).also { if (delta != null) it.put("delta", delta) })
    private fun insights(vararg items: JSONObject, status: String = "ready") = JSONObject().put("schema_version", 1)
        .put("day", day).put("status", status).put("items", JSONArray(items.toList()))
    private fun entry(energy: Any? = 4, travel: Any? = false, note: Any? = "Ukážkový zápis") = JSONObject()
        .put("day", day).put("morning_energy", energy ?: JSONObject.NULL).put("sleep_quality", JSONObject.NULL)
        .put("evening_stress", JSONObject.NULL).put("muscle_soreness", 2)
        .put("context", JSONObject().put("travel", travel ?: JSONObject.NULL).put("unusual_schedule", JSONObject.NULL)
            .put("late_meal", true).put("late_caffeine", JSONObject.NULL))
        .put("note", note ?: JSONObject.NULL).put("revision", 3)
    private fun journal(entry: JSONObject?, revision: Int) = JSONObject().put("schema_version", 1)
        .put("entry", entry ?: JSONObject.NULL).put("revision", revision)

    @Test fun insightsOk() {
        server.enqueue(ok(insights(item(), item("resting_hr_trend", 2.5), item("future_rule", null))))
        val result = api.insights(credential, session, day) as DailyResult.Ok
        assertEquals("ready", result.value.status)
        assertEquals(3, result.value.items.size)
        val first = result.value.items[0]
        assertEquals("$day:sleep_duration", first.id)
        assertEquals("sleep_duration", first.ruleId)
        assertEquals("observation", first.kind)
        assertEquals(-60.0, (first.evidence["delta"] as Number).toDouble(), 0.0)
        assertEquals("Spánok bol o 60 minút kratší než medián tvojich predchádzajúcich nocí.", first.text)
        assertEquals("Medián pokojového tepu za posledný týždeň je o 2,5 bpm vyšší než počas predchádzajúcich troch týždňov.",
            result.value.items[1].text)
        assertEquals("Nový postreh je dostupný v novšej verzii klienta.", result.value.items[2].text)
        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/api/insights?day=$day", request.path)
        assertEquals(credential.cookie, request.getHeader("Cookie"))
        assertEquals(session.identity, Payloads.identity(JSONObject(request.getHeader("x-zdravie-identity")!!)))
    }

    @Test fun readyWithNoItemsIsNotInsufficientData() {
        server.enqueue(ok(insights()))
        assertEquals(emptyList<Insight>(), ((api.insights(credential, session, day)) as DailyResult.Ok).value.items)
        server.enqueue(ok(insights(status = "insufficient_data")))
        assertEquals("insufficient_data", (api.insights(credential, session, day) as DailyResult.Ok).value.status)
    }

    @Test fun oneMalformedInsightIsDroppedAndTheRestKept() {
        val broken = JSONObject().put("id", 5).put("message_key", "sleep_duration")
        server.enqueue(ok(insights(broken, item())))
        assertEquals(1, (api.insights(credential, session, day) as DailyResult.Ok).value.items.size)
    }

    @Test fun insights404IsUnsupportedAndCached() {
        server.enqueue(MockResponse().setResponseCode(404).setHeader("Content-Type", "text/html").setBody("<html>x</html>"))
        assertEquals(DailyResult.Unsupported, api.insights(credential, session, day))
        assertEquals(DailyResult.Unsupported, api.insights(credential, session, "2026-10-21"))
        assertEquals(1, server.requestCount)
        // The journal family is remembered independently.
        server.enqueue(ok(journal(null, 0)))
        assertEquals(DailyResult.Ok(JournalState(null, 0)), api.journal(credential, session, day))
        assertEquals(2, server.requestCount)
    }

    @Test fun insights501IsUnsupportedToo() {
        server.enqueue(MockResponse().setResponseCode(501))
        assertEquals(DailyResult.Unsupported, api.insights(credential, session, day))
    }

    @Test fun unsupportedIsForgottenForANewIdentity() {
        server.enqueue(MockResponse().setResponseCode(404))
        assertEquals(DailyResult.Unsupported, api.journal(credential, session, day))
        assertEquals(DailyResult.Unsupported, api.journal(credential, session, day))
        assertEquals(1, server.requestCount)
        val other = Payloads.session(DataFixtures.sessionJson(version = 3))
        server.enqueue(ok(journal(null, 0), identity = Payloads.identityJson(other.identity)))
        assertTrue(api.journal(DataFixtures.credential(other), other, day) is DailyResult.Ok)
        assertEquals(2, server.requestCount)
    }

    @Test fun insights503IsUnavailableAndNotCached() {
        server.enqueue(MockResponse().setResponseCode(503).setBody("{\"error\":\"unavailable\"}"))
        assertEquals(DailyResult.Unavailable, api.insights(credential, session, day))
        server.enqueue(ok(insights()))
        assertTrue(api.insights(credential, session, day) is DailyResult.Ok)
        api = ZdravieApi(server.url("/"), client.newBuilder().retryOnConnectionFailure(false).build())
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        assertEquals(DailyResult.Unavailable, api.insights(credential, session, day))
        server.enqueue(ok(insights()).setBody("not json"))
        assertEquals(DailyResult.Unavailable, api.insights(credential, session, day))
    }

    @Test fun journalGetParsesEntryAndTombstoneRevision() {
        server.enqueue(ok(journal(entry(), 3)))
        val state = (api.journal(credential, session, day) as DailyResult.Ok).value
        assertEquals(3L, state.revision)
        assertEquals(mapOf("morning_energy" to 4, "sleep_quality" to null, "evening_stress" to null, "muscle_soreness" to 2),
            state.entry!!.ratings)
        assertEquals(mapOf("travel" to false, "unusual_schedule" to null, "late_meal" to true, "late_caffeine" to null),
            state.entry!!.context)
        assertEquals("Ukážkový zápis", state.entry!!.note)
        assertEquals("/api/journal/$day", server.takeRequest().path)
        server.enqueue(ok(journal(null, 4)))
        assertEquals(DailyResult.Ok(JournalState(null, 4)), api.journal(credential, session, day))
    }

    @Test fun invalidJournalValuesAreUnavailableNotInvented() {
        listOf<Any>(6, 0, 4.5, "4", true).forEach { bad ->
            server.enqueue(ok(journal(entry(energy = bad), 3)))
            assertEquals(DailyResult.Unavailable, api.journal(credential, session, day))
        }
        server.enqueue(ok(journal(entry(travel = "no"), 3)))
        assertEquals(DailyResult.Unavailable, api.journal(credential, session, day))
        server.enqueue(ok(journal(entry(note = "x".repeat(501)), 3)))
        assertEquals(DailyResult.Unavailable, api.journal(credential, session, day))
        server.enqueue(ok(journal(entry(), -1)))
        assertEquals(DailyResult.Unavailable, api.journal(credential, session, day))
    }

    @Test fun journalPatchSendsOnlyChangedFields() {
        server.enqueue(ok(journal(entry(energy = 5), 4)))
        val patch = JSONObject().put("morning_energy", 5).put("sleep_quality", JSONObject.NULL)
            .put("context", JSONObject().put("travel", false)).put("note", "Ukážkový zápis")
        val result = api.saveJournal(credential, session, day, patch, 3) as DailyResult.Ok
        assertEquals(4L, result.value.revision)
        val request = server.takeRequest()
        assertEquals("PATCH", request.method)
        assertEquals("/api/journal/$day", request.path)
        assertTrue(request.getHeader("Content-Type")!!.startsWith("application/json"))
        assertEquals(credential.cookie, request.getHeader("Cookie"))
        assertEquals(session.identity, Payloads.identity(JSONObject(request.getHeader("x-zdravie-identity")!!)))
        val sent = JSONObject(request.body.readUtf8())
        assertEquals(setOf("expected_revision", "morning_energy", "sleep_quality", "context", "note"), sent.keys().asSequence().toSet())
        assertEquals(3, sent.getInt("expected_revision"))
        assertTrue(sent.isNull("sleep_quality"))
        assertEquals(setOf("travel"), sent.getJSONObject("context").keys().asSequence().toSet())
        assertEquals(5, sent.getInt("morning_energy"))
        assertFalse(sent.has("evening_stress"))
    }

    @Test fun revisionConflictKeepsCurrent() {
        val body = JSONObject().put("error", "revision_conflict").put("entry", entry(energy = 2)).put("revision", 3)
        server.enqueue(ok(body, status = 409))
        val conflict = api.saveJournal(credential, session, day, JSONObject().put("note", "x"), 2) as DailyResult.Conflict
        assertEquals(3L, conflict.current.revision)
        assertEquals(2, conflict.current.entry!!.ratings["morning_energy"])
        // A tombstone conflict: no entry, higher revision.
        server.enqueue(ok(JSONObject().put("error", "revision_conflict").put("entry", JSONObject.NULL).put("revision", 7), status = 409))
        assertEquals(JournalState(null, 7), (api.saveJournal(credential, session, day, JSONObject().put("note", "x"), 2) as DailyResult.Conflict).current)
    }

    @Test fun sessionChangedThrows409() {
        val body = JSONObject().put("error", "session_changed")
        server.enqueue(ok(body, status = 409, identity = null))
        failure(409) { api.journal(credential, session, day) }
        server.enqueue(ok(body, status = 409))
        failure(409) { api.insights(credential, session, day) }
        server.enqueue(MockResponse().setResponseCode(409).setHeader("Content-Type", "text/plain").setBody("x"))
        failure(409) { api.saveJournal(credential, session, day, JSONObject().put("note", "x"), 0) }
    }

    @Test fun identityHeaderRequired() {
        val expected = Payloads.identityJson(session.identity)
        val wrong = listOf<String?>(null, "{}", expected.replace("account_a", "account_b"), expected.replace(":2", ":3"),
            "x".repeat(1001))
        wrong.forEach { header ->
            server.enqueue(ok(insights(), identity = header))
            failure(409) { api.insights(credential, session, day) }
            server.enqueue(ok(journal(null, 0), identity = header))
            failure(409) { api.journal(credential, session, day) }
            server.enqueue(ok(JSONObject().put("error", "revision_conflict").put("entry", JSONObject.NULL).put("revision", 1), 409, header))
            failure(409) { api.saveJournal(credential, session, day, JSONObject().put("note", "x"), 0) }
        }
    }

    @Test fun otherFailuresKeepTheirStatusAndInvalidInputNeverReachesTheServer() {
        listOf(400, 401, 403, 429).forEach { code ->
            server.enqueue(MockResponse().setResponseCode(code).setBody("synthetic-private-backend-detail"))
            assertFalse(failure(code) { api.journal(credential, session, day) }.message.contains("synthetic-private"))
        }
        failure(400) { api.journal(credential, session, "../etc") }
        failure(400) { api.insights(credential, session, "2026-02-30") }
        failure(409) { api.journal(credential, session.copy(identity = session.identity.copy(dataAccountId = "account_b")), day) }
        failure(401) { api.insights(credential.copy(expiresAt = 0), session, day) }
        assertEquals(4, server.requestCount)
    }
}
