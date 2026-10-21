package sk.zdravie.app.data

import okhttp3.Authenticator
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.Headers
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import sk.zdravie.app.BuildConfig
import sk.zdravie.app.model.*
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

class ApiFailure(val status: Int, override val message: String) : Exception(message)
data class LoginResult(val session: AppSession, val credential: SessionCredential)
data class DatasetResult(val days: List<DaySummary>, val syncedAt: String?)

class ZdravieApi(
    private val base: HttpUrl = BuildConfig.API_BASE_URL.toHttpUrl(),
    client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(25, TimeUnit.SECONDS)
        .callTimeout(35, TimeUnit.SECONDS).build()
) : MobileApi {
    // There is no ambient cookie jar or disk cache, including with a supplied TLS test client.
    private val transport = client.newBuilder().followRedirects(false).followSslRedirects(false)
        .cookieJar(CookieJar.NO_COOKIES).cache(null).authenticator(Authenticator.NONE)
        .proxyAuthenticator(Authenticator.NONE).build()

    init {
        require(base.isHttps && base.username.isEmpty() && base.password.isEmpty())
        require(base.encodedPath == "/" && base.query == null && base.fragment == null)
    }

    override fun login(email: String, password: String, remember: Boolean): LoginResult = usable {
        val json = JSONObject().put("email", email.trim()).put("password", password).put("remember", remember)
        val result = call("api/mobile/login", body = json)
        val session = Payloads.session(result.json)
        require(session.persistent == remember)
        val candidates = result.headers.values("Set-Cookie").filter {
            it.substringBefore(';').substringBefore('=').trim() == SessionCookies.NAME
        }
        require(candidates.size == 1)
        val cookie = Cookie.parse(base, candidates.single()) ?: error("Missing session cookie")
        require(cookie.name == SessionCookies.NAME && cookie.secure && cookie.httpOnly && cookie.hostOnly)
        require(cookie.domain == base.host && cookie.path == "/" && cookie.matches(base))
        require(cookie.expiresAt > System.currentTimeMillis() && cookie.persistent == session.persistent)
        val credential = SessionCredential("${cookie.name}=${cookie.value}", session.expiresAt, session.persistent)
        SessionCookies.matches(SessionCookies.checked(credential), session)
        LoginResult(session, credential)
    }

    override fun session(credential: SessionCredential): AppSession = usable {
        val claims = validCredential(credential)
        val session = Payloads.session(call("api/mobile/session", credential).json)
        sameSession(claims, session)
        session
    }

    override fun logout(credential: SessionCredential) {
        validCredential(credential)
        call("api/mobile/logout", credential, JSONObject(), expectedStatus = 204)
    }

    override fun data(credential: SessionCredential, session: AppSession): DatasetResult = usable {
        sameSession(validCredential(credential), session)
        val result = call("api/data", credential, identity = session.identity)
        DatasetResult(Payloads.days(result.json, session.account.sleepScore), Payloads.syncedAt(result.json))
    }

    private fun validCredential(credential: SessionCredential): SessionCookies.Claims = try {
        SessionCookies.checked(credential)
    } catch (_: Exception) { throw ApiFailure(401, "Relácia vypršala. Prihlás sa znova.") }

    private fun sameSession(claims: SessionCookies.Claims, session: AppSession) {
        try { SessionCookies.matches(claims, session) }
        catch (_: Exception) { throw ApiFailure(409, "Relácia sa zmenila. Prihlás sa znova.") }
    }

    private data class ApiResult(val json: JSONObject, val headers: Headers)

    private fun call(path: String, credential: SessionCredential? = null, body: JSONObject? = null,
        identity: AccountIdentity? = null, expectedStatus: Int = 200): ApiResult = usable {
        val request = Request.Builder().url(requireNotNull(base.resolve(path)))
            .header("Accept", "application/json").header("Cache-Control", "no-store")
        credential?.let { request.header("Cookie", it.cookie) }
        identity?.let { request.header("x-zdravie-identity", Payloads.identityJson(it)) }
        body?.let { request.post(it.toString().toRequestBody("application/json; charset=utf-8".toMediaType())) }
        transport.newCall(request.build()).execute().use { response ->
            if (response.code != expectedStatus) throw ApiFailure(response.code, when (response.code) {
                400 -> "Skontroluj zadané údaje."
                401 -> if (path.endsWith("login")) "Nesprávny e-mail alebo heslo." else "Relácia vypršala. Prihlás sa znova."
                403 -> "Účet nemá prístup. Obráť sa na správcu."
                409 -> "Relácia sa zmenila. Prihlás sa znova."
                429 -> "Priveľa pokusov. Skús to znova neskôr."
                else -> "Server je dočasne nedostupný. Skús to znova."
            })
            if (identity != null) {
                val headers = response.headers.values("x-zdravie-identity")
                val actual = try {
                    require(headers.size == 1 && headers.single().length <= 1000)
                    Payloads.identity(StrictJson.objectValue(headers.single()))
                } catch (_: Exception) { null }
                if (actual != identity) throw ApiFailure(409, "Relácia sa zmenila. Prihlás sa znova.")
            }
            if (expectedStatus == 204) return@usable ApiResult(JSONObject(), response.headers)
            val contentTypes = response.headers.values("Content-Type")
            require(contentTypes.size == 1 && contentTypes.single().substringBefore(';').trim().equals("application/json", true))
            val bytes = response.body?.source()?.let { source ->
                if (source.request(10L * 1024 * 1024 + 1)) throw ApiFailure(503, "Odpoveď servera je príliš veľká.")
                source.readByteArray()
            } ?: error("Missing response body")
            ApiResult(StrictJson.objectValue(bytes), response.headers)
        }
    }

    private inline fun <T> usable(block: () -> T): T = try { block() }
    catch (error: ApiFailure) { throw error }
    catch (_: SSLException) { throw ApiFailure(0, "Zabezpečené spojenie zlyhalo. Skontroluj dátum telefónu, pripojenie a VPN.") }
    catch (_: IOException) { throw ApiFailure(0, "Server sa nepodarilo kontaktovať. Skontroluj pripojenie a skús znova.") }
    catch (_: Exception) { throw ApiFailure(503, "Server neposlal použiteľné dáta. Skús to znova.") }
}
