package sk.zdravie.app.data

import org.json.JSONObject
import sk.zdravie.app.model.AppSession
import java.util.Base64
import sk.zdravie.app.data.Payloads.boolean
import sk.zdravie.app.data.Payloads.integer
import sk.zdravie.app.data.Payloads.string

internal object SessionCookies {
    const val NAME = "owi_session"
    private const val PERSISTENT_LIFETIME = 30L * 24 * 60 * 60 * 1000
    private const val SESSION_LIFETIME = 12L * 60 * 60 * 1000
    private const val CLOCK_SKEW_ALLOWANCE = 5L * 60 * 1000
    private val tokenPattern = Regex("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")

    internal data class Claims(val accountId: String, val role: String, val version: Long,
        val expiresAt: Long, val persistent: Boolean)

    fun validateExpiry(expiresAt: Long, persistent: Boolean, now: Long) {
        val lifetime = if (persistent) PERSISTENT_LIFETIME else SESSION_LIFETIME
        // A phone slightly behind the issuing server must still accept a fresh session.
        // The lower bound stays strict: this never extends an already expired credential.
        require(expiresAt > now && expiresAt <= now + lifetime + CLOCK_SKEW_ALLOWANCE)
    }

    /** Claims are only a consistency precondition; their signature is verified by the server. */
    fun checked(credential: SessionCredential, now: Long = System.currentTimeMillis()): Claims {
        require(credential.cookie.startsWith("$NAME="))
        val token = credential.cookie.removePrefix("$NAME=")
        require(token.length in 1..2048 && tokenPattern.matches(token))
        val (encoded, signature) = token.split('.')
        val decoder = Base64.getUrlDecoder()
        require(decoder.decode(signature).size == 32)
        val value = StrictJson.objectValue(decoder.decode(encoded))
        require(value.keys().asSequence().toSet() == setOf("a", "r", "v", "x", "p", "e"))
        val claims = Claims(value.string("a"), value.string("r"), value.integer("v"),
            value.integer("e"), value.boolean("p"))
        require(Payloads.ACCOUNT_ID.matches(claims.accountId))
        require(claims.role in setOf("user", "admin") && value.get("x") === JSONObject.NULL)
        validateExpiry(claims.expiresAt, claims.persistent, now)
        require(claims.expiresAt == credential.expiresAt && claims.persistent == credential.persistent)
        return claims
    }

    fun matches(claims: Claims, session: AppSession) {
        require(session.account.id == claims.accountId && session.account.role == claims.role)
        require(session.identity.actorId == claims.accountId && session.identity.dataAccountId == claims.accountId)
        require(!session.identity.viewOnly && session.identity.sessionVersion == claims.version)
        require(session.expiresAt == claims.expiresAt && session.persistent == claims.persistent)
    }
}
