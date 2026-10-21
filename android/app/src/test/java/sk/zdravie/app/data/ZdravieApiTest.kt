package sk.zdravie.app.data

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import sk.zdravie.app.model.AppSession
import java.util.concurrent.TimeUnit

class ZdravieApiTest {
    private lateinit var server: MockWebServer
    private lateinit var client: OkHttpClient
    private lateinit var api: ZdravieApi
    private lateinit var session: AppSession
    private lateinit var credential: SessionCredential

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

    private fun json(value: JSONObject) = MockResponse().setHeader("Content-Type", "application/json").setBody(value.toString())
    private fun sessionJson(session: AppSession = this.session) = DataFixtures.sessionJson(
        session.account.id, session.expiresAt, session.persistent, session.identity.sessionVersion)
    private fun loginResponse(cookie: String = credential.cookie + "; Path=/; Secure; HttpOnly") =
        json(sessionJson()).addHeader("Set-Cookie", cookie)
    private fun dataResponse(body: JSONObject = DataFixtures.dataset(DataFixtures.day())) =
        json(body).addHeader("x-zdravie-identity", Payloads.identityJson(session.identity))
    private fun failure(status: Int, action: () -> Unit): ApiFailure {
        val error = assertThrows(ApiFailure::class.java, action)
        assertEquals(status, error.status)
        return error
    }

    @Test fun loginSessionDataAndLogoutUseTheContractAndOnlyTheUserCookie() {
        var jarReads = 0
        var jarWrites = 0
        val ambientJar = object : CookieJar {
            override fun loadForRequest(url: HttpUrl): List<Cookie> {
                jarReads++
                return listOf(Cookie.Builder().name("ambient").value("synthetic-secret").domain(url.host).build())
            }
            override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) { jarWrites++ }
        }
        api = ZdravieApi(server.url("/"), client.newBuilder().cookieJar(ambientJar).build())
        server.enqueue(loginResponse().addHeader("Set-Cookie", "analytics=synthetic; Path=/; Secure"))
        val result = api.login("  account_a@example.test  ", "synthetic-password", false)
        assertEquals(session, result.session)
        assertEquals(credential, result.credential)
        val login = server.takeRequest()
        assertEquals("/api/mobile/login", login.path)
        assertEquals("POST", login.method)
        assertNull(login.getHeader("Cookie"))
        assertNull(login.getHeader("Origin"))
        assertEquals("no-store", login.getHeader("Cache-Control"))
        val body = JSONObject(login.body.readUtf8())
        assertEquals(setOf("email", "password", "remember"), body.keys().asSequence().toSet())
        assertEquals("account_a@example.test", body.getString("email"))
        assertEquals("synthetic-password", body.getString("password"))
        assertFalse(body.getBoolean("remember"))

        server.enqueue(json(sessionJson()))
        assertEquals(session, api.session(result.credential))
        val check = server.takeRequest()
        assertEquals("GET", check.method)
        assertEquals("/api/mobile/session", check.path)
        assertEquals(credential.cookie, check.getHeader("Cookie"))

        server.enqueue(dataResponse())
        assertEquals(5200L, api.data(result.credential, result.session).days.single().steps)
        val data = server.takeRequest()
        assertEquals("/api/data", data.path)
        assertEquals(credential.cookie, data.getHeader("Cookie"))
        assertEquals(session.identity, Payloads.identity(JSONObject(data.getHeader("x-zdravie-identity")!!)))

        server.enqueue(MockResponse().setResponseCode(204))
        api.logout(result.credential)
        val logout = server.takeRequest()
        assertEquals("POST", logout.method)
        assertEquals("/api/mobile/logout", logout.path)
        assertEquals("{}", logout.body.readUtf8())
        assertEquals(credential.cookie, logout.getHeader("Cookie"))
        assertEquals(0, jarReads)
        assertEquals(0, jarWrites)
        assertFalse(result.toString().contains(credential.cookie))
    }

    @Test fun rememberedSessionRequiresThePersistentCookieAndMatchingClaims() {
        session = Payloads.session(DataFixtures.sessionJson(persistent = true))
        credential = DataFixtures.credential(session)
        server.enqueue(loginResponse(credential.cookie + "; Path=/; Secure; HttpOnly; Max-Age=21600"))
        assertTrue(api.login("a@example.test", "synthetic", true).credential.persistent)
    }

    @Test fun freshLoginAcceptsAServerClockOneMinuteAheadOfThePhone() {
        session = Payloads.session(DataFixtures.sessionJson(expiresAt = System.currentTimeMillis() + 12L * 60 * 60 * 1000 + 60_000L))
        credential = DataFixtures.credential(session)
        server.enqueue(loginResponse())
        assertEquals(credential, api.login("a@example.test", "synthetic", false).credential)
    }

    @Test fun dataPreservesSelectedNullsAndChoosesTheAccountsSleepPreference() {
        val day = DataFixtures.day().put("distance_m", JSONObject.NULL).put("distance_m_source", JSONObject.NULL)
            .put("resting_hr", 63.0).put("resting_hr_source", "measured")
            .put("samsung_auto", JSONObject().put("sleep_score", 91.0))
        val samsungSession = session.copy(account = session.account.copy(sleepScore = "samsung"))
        server.enqueue(dataResponse(DataFixtures.dataset(day)))
        val result = api.data(credential, samsungSession).days.single()
        assertNull(result.distanceMeters)
        assertNull(result.distanceSource)
        assertEquals(63.0, result.restingHr!!, 0.0)
        assertEquals("measured", result.restingHrSource)
        assertEquals(91.0, result.sleepScore!!, 0.0)
        assertFalse(result.sleepScoreEstimated)
        assertEquals("Europe/Bratislava", result.timezone)
        day.put("resting_hr", JSONObject.NULL).put("resting_hr_source", JSONObject.NULL)
        day.getJSONObject("samsung_auto").put("sleep_score", JSONObject.NULL)
        server.enqueue(dataResponse(DataFixtures.dataset(day)))
        val estimate = api.data(credential, samsungSession).days.single()
        assertEquals(82.0, estimate.sleepScore!!, 0.0)
        assertTrue(estimate.sleepScoreEstimated)
        day.getJSONObject("scores").getJSONObject("samsung_sleep").put("value", JSONObject.NULL)
        server.enqueue(dataResponse(DataFixtures.dataset(day)))
        val missing = api.data(credential, samsungSession).days.single()
        assertEquals(53.0, missing.restingHr!!, 0.0)
        assertEquals("derived", missing.restingHrSource)
        assertNull(missing.sleepScore)
        assertFalse(missing.sleepScoreEstimated)
    }

    @Test fun loginRejectsUnsafeMissingAmbiguousAndWrongAccountCookies() {
        val wrong = DataFixtures.credential(Payloads.session(DataFixtures.sessionJson("account_b", session.expiresAt)))
        val invalidCookies = listOf(
            credential.cookie + "; Path=/; HttpOnly",
            credential.cookie + "; Path=/; Secure",
            credential.cookie + "; Path=/; Secure; HttpOnly; Domain=${server.url("/").host}",
            credential.cookie + "; Path=/api; Secure; HttpOnly",
            credential.cookie + "; Path=/; Secure; HttpOnly; Max-Age=0",
            credential.cookie + "; Path=/; Secure; HttpOnly; Max-Age=21600",
            "owi_session=not-a-token; Path=/; Secure; HttpOnly",
            wrong.cookie + "; Path=/; Secure; HttpOnly"
        )
        invalidCookies.forEach { server.enqueue(loginResponse(it)); failure(503) { api.login("a@example.test", "synthetic", false) } }
        server.enqueue(json(sessionJson()))
        failure(503) { api.login("a@example.test", "synthetic", false) }
        server.enqueue(loginResponse().addHeader("Set-Cookie", credential.cookie + "; Path=/; Secure; HttpOnly"))
        failure(503) { api.login("a@example.test", "synthetic", false) }
    }

    @Test fun sessionCannotSwitchTheCookieAccountVersionOrExpiry() {
        val changed = listOf(
            DataFixtures.sessionJson("account_b", session.expiresAt),
            DataFixtures.sessionJson(expiresAt = session.expiresAt, version = 3),
            DataFixtures.sessionJson(expiresAt = session.expiresAt + 1000)
        )
        changed.forEach { server.enqueue(json(it)); failure(409) { api.session(credential) } }
    }

    @Test fun invalidCredentialsAndWrongIdentityNeverReachTheServer() {
        val badCredentials = listOf(
            credential.copy(cookie = credential.cookie + "; other=synthetic"),
            credential.copy(cookie = "other=" + credential.cookie.removePrefix("owi_session=")),
            credential.copy(expiresAt = 0),
            credential.copy(persistent = true),
            DataFixtures.credential(session, viewAs = "account_b"),
            DataFixtures.credential(session.copy(expiresAt = System.currentTimeMillis() - 1)),
            DataFixtures.credential(session.copy(expiresAt = System.currentTimeMillis() + 13 * 60 * 60 * 1000))
        )
        badCredentials.forEach { failure(401) { api.session(it) } }
        failure(409) { api.data(credential, session.copy(identity = session.identity.copy(dataAccountId = "account_b"))) }
        failure(409) { api.data(credential, session.copy(identity = session.identity.copy(sessionVersion = 3))) }
        failure(409) { api.data(credential, session.copy(identity = session.identity.copy(viewOnly = true))) }
        assertEquals(0, server.requestCount)
    }

    @Test fun everyDataResponseMustHaveExactlyOneStrictMatchingIdentityHeader() {
        val expected = Payloads.identityJson(session.identity)
        val invalid = listOf<String?>(null, "{}", expected.replace("account_a", "account_b"),
            expected.replace("false", "true"), expected.replace(":2", ":3"),
            expected.replace("false", "\"false\""), expected.replace(":2", ":\"2\""),
            expected.dropLast(1) + ",\"sessionVersion\":2}", expected + "{}", "x".repeat(1001))
        invalid.forEach { header ->
            val response = json(DataFixtures.dataset(DataFixtures.day()))
            if (header != null) response.addHeader("x-zdravie-identity", header)
            server.enqueue(response)
            failure(409) { api.data(credential, session) }
        }
        server.enqueue(dataResponse().addHeader("x-zdravie-identity", expected))
        failure(409) { api.data(credential, session) }
    }

    @Test fun redirectsAreRejectedEvenIfTheSuppliedClientWouldFollowThem() {
        server.enqueue(MockResponse().setResponseCode(307).setHeader("Location", server.url("/redirected")))
        api = ZdravieApi(server.url("/"), client.newBuilder().followRedirects(true).followSslRedirects(true).build())
        failure(307) { api.login("a@example.test", "synthetic", false) }
        assertEquals(1, server.requestCount)
        assertEquals("/api/mobile/login", server.takeRequest().path)
    }

    @Test fun tlsRequiresATrustedCertificateAndHttpsOrigin() {
        api = ZdravieApi(server.url("/"), OkHttpClient.Builder().callTimeout(5, TimeUnit.SECONDS).build())
        val error = failure(0) { api.login("a@example.test", "synthetic", false) }
        assertTrue(error.message.contains("Zabezpečené"))
        assertEquals(0, server.requestCount)
        assertThrows(IllegalArgumentException::class.java) { ZdravieApi(server.url("/").newBuilder().scheme("http").build(), client) }
        assertThrows(IllegalArgumentException::class.java) { ZdravieApi(server.url("/other/"), client) }
    }

    @Test fun serverErrorsNeverExposeTheirResponseBody() {
        listOf(400, 401, 403, 409, 429, 503).forEach { code ->
            server.enqueue(MockResponse().setResponseCode(code).setBody("synthetic-private-backend-detail"))
            val error = failure(code) { api.session(credential) }
            assertFalse(error.message.contains("synthetic-private"))
            assertNull(error.cause)
        }
    }

    @Test fun malformedDataTypesEnumsAndTimestampsFailTheWholeResponseClosed() {
        val mutations: List<(JSONObject) -> Unit> = listOf(
            { it.put("steps", "5200") }, { it.put("steps", 1.5) }, { it.put("steps", -1) },
            { it.put("complete", "true") }, { it.put("day", "2026-02-30") },
            { it.put("distance_m_source", "unknown") }, { it.put("hrv_kind", "unknown") },
            { it.put("scores", "invalid") }, { it.put("workouts", "invalid") },
            { it.put("resting_hr", "broken") },
            { it.put("timezone", "unknown") },
            { it.getJSONObject("scores").getJSONObject("readiness").put("value", 101.0) },
            { it.put("workouts", JSONArray().put(JSONObject().put("id", "synthetic-workout").put("type", "walk").put("start", "yesterday"))) }
        )
        mutations.forEach { mutate ->
            val day = DataFixtures.day().also(mutate)
            server.enqueue(dataResponse(DataFixtures.dataset(day)))
            failure(503) { api.data(credential, session) }
        }
        server.enqueue(dataResponse(DataFixtures.dataset(DataFixtures.day()).put("synced_at", "yesterday")))
        failure(503) { api.data(credential, session) }
        server.enqueue(dataResponse(DataFixtures.dataset(DataFixtures.day()).put("last_compute_success_at", "invalid")))
        failure(503) { api.data(credential, session) }
    }

    @Test fun wireJsonMustBeUtf8AnObjectAndUnambiguousWithoutTrailingContent() {
        val malformed = listOf("{days: []}", "{\"days\":[]};", "{\"days\":[],\"days\":[]}",
            "{\"days\":[],}", "[]", "{\"days\":[],\"number\":NaN}", "{\"days\":[],\"number\":1e999}")
        malformed.forEach { body ->
            server.enqueue(dataResponse().setBody(body))
            failure(503) { api.data(credential, session) }
        }
        server.enqueue(dataResponse().setBody(okio.Buffer().writeUtf8("{\"days\":[],\"text\":\"").writeByte(0xff).writeUtf8("\"}")))
        failure(503) { api.data(credential, session) }
        server.enqueue(dataResponse().setHeader("Content-Type", "text/html"))
        failure(503) { api.data(credential, session) }
        server.enqueue(dataResponse().addHeader("Content-Type", "application/json"))
        failure(503) { api.data(credential, session) }
    }

    @Test fun responseBodyIsBounded() {
        server.enqueue(dataResponse().setBody(" ".repeat(10 * 1024 * 1024 + 1)))
        failure(503) { api.data(credential, session) }
    }
}
