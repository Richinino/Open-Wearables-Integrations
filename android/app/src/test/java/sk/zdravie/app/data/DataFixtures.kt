package sk.zdravie.app.data

import org.json.JSONArray
import org.json.JSONObject
import sk.zdravie.app.model.AppSession
import java.util.Base64

internal object DataFixtures {
    fun sessionJson(id: String = "account_a", expiresAt: Long = System.currentTimeMillis() + 6 * 60 * 60 * 1000,
        persistent: Boolean = false, version: Long = 2): JSONObject = JSONObject()
        .put("account", JSONObject().put("id", id).put("first_name", "Synthetic")
            .put("last_name", JSONObject.NULL).put("email", "$id@example.test").put("role", "user")
            .put("status", "active").put("paired", true).put("has_samsung", true)
            .put("settings", JSONObject().put("theme", "system").put("sleep_score", "performance"))
            .put("session_version", version))
        .put("identity", JSONObject().put("actorId", id).put("dataAccountId", id)
            .put("viewOnly", false).put("sessionVersion", version))
        .put("expiresAt", expiresAt).put("persistent", persistent)

    fun credential(session: AppSession, viewAs: String? = null): SessionCredential {
        val claims = JSONObject().put("a", session.account.id).put("r", session.account.role)
            .put("v", session.identity.sessionVersion).put("e", session.expiresAt)
            .put("p", session.persistent).put("x", viewAs ?: JSONObject.NULL)
        val encoder = Base64.getUrlEncoder().withoutPadding()
        val token = encoder.encodeToString(claims.toString().toByteArray()) + "." + encoder.encodeToString(ByteArray(32) { 7 })
        return SessionCredential("owi_session=$token", session.expiresAt, session.persistent)
    }

    fun day(date: String = "2026-10-20"): JSONObject = JSONObject().put("day", date)
        .put("complete", true).put("steps", 5200).put("distance_m_est", 3900.0)
        .put("active_minutes_est", 24.0).put("sleep_minutes", 430.0).put("hr_resting", 53.0)
        .put("workouts", JSONArray()).put("scores", JSONObject()
            .put("sleep_performance", JSONObject().put("value", 80.0))
            .put("apple_sleep", JSONObject().put("value", 81.0))
            .put("samsung_sleep", JSONObject().put("value", 82.0))
            .put("readiness", JSONObject().put("value", 77.0))
            .put("activity", JSONObject().put("value", 74.0)))

    fun dataset(vararg days: JSONObject): JSONObject = JSONObject()
        .put("timezone", "Europe/Bratislava").put("days", JSONArray(days.toList())).put("synced_at", "2026-10-20T08:30:00Z")
}
