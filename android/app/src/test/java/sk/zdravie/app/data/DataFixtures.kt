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

    /** Every field of web/src/lib/types.ts Day, synthetic values. */
    fun fullDay(date: String = "2026-10-20"): JSONObject = JSONObject(FULL_DAY.replace("DATE", date))

    private const val FULL_DAY = """{
      "day":"DATE","timezone":"Europe/Prague","complete":true,"steps":9100,"steps_source":"samsung_hourly",
      "distance_m_est":6800.0,"active_minutes_est":41.0,"activity_kcal_est":520.0,"basal_kcal":1650.0,"total_kcal_est":2170.0,
      "distance_m":9600.0,"distance_m_source":"measured","active_kcal":500.0,"active_kcal_source":"derived",
      "total_kcal":2150.0,"total_kcal_source":"estimated","resting_hr":52.0,"resting_hr_source":"measured",
      "hrv_ms":64.0,"hrv_kind":"rmssd","hrv_ms_source":"measured",
      "hr_resting":53.0,"hr_avg":71.0,"hr_max":162.0,"hr_min":44.0,
      "zone_light_min":120.0,"zone_moderate_min":30.0,"zone_vigorous_min":12.0,
      "sleep_start":"2026-10-19T21:40:00Z","sleep_end":"2026-10-20T05:30:00Z","sleep_minutes":430.0,
      "sleep_deep_min":70.0,"sleep_rem_min":95.0,"sleep_light_min":240.0,"sleep_awake_min":25.0,"nap_minutes":0.0,
      "workouts":[{"id":"w1","day":"DATE","type":"running","start":"2026-10-20T16:00:00Z","end":"2026-10-20T16:45:00Z",
        "duration_s":2700.0,"source":"samsung","hr_avg":150.0,"hr_max":175.0,"hr_min":110.0,
        "zone_light_min":5.0,"zone_moderate_min":20.0,"zone_vigorous_min":15.0,"distance_m":7200.0,"kcal_est":480.0,"strain":11.4}],
      "sleep_timeline":[
        {"start":"2026-10-19T21:40:00Z","end":"2026-10-19T22:30:00Z","stage":"light"},
        {"start":"2026-10-19T22:30:00Z","end":"2026-10-19T23:30:00Z","stage":"deep"},
        {"start":"2026-10-19T23:30:00Z","end":"2026-10-20T00:30:00Z","stage":"rem"},
        {"start":"2026-10-20T00:30:00Z","end":"2026-10-20T00:40:00Z","stage":"awake"},
        {"start":"2026-10-20T00:40:00Z","end":"2026-10-20T05:30:00Z","stage":"in_bed"}],
      "scores":{"day":"DATE","strain":10.5,
        "cardio_load":{"strain_7d":9.0,"tolerance_28d":8.0,"ratio":1.1,"status":"productive"},
        "sleep_need_minutes":480.0,
        "sleep_performance":{"value":80.0,"components":{"duration":0.9,"debt":-0.2},"note":null},
        "apple_sleep":{"value":81.0,"components":{},"note":null},
        "sleep_regularity":88.0,
        "readiness":{"value":77.0,"components":{"hrv":1.5},"note":"estimate"},
        "activity":{"value":74.0,"components":{},"note":null},
        "night_signal":{"level":"green","night_hr":50.0,"baseline":51.0,"delta":-1.0},
        "day_score":77.0,"vo2max":48.0,"vo2max_uth":47.0,
        "whoop_age":{"value":25.0,"components":{"vo2max":-2.0},"note":null},
        "samsung_sleep":{"value":82.0,"components":{},"note":null},
        "energy_score":{"value":null,"components":{"entries":2,"needed":7},"note":"learning"}},
      "samsung_auto":{"steps":9000.0,"active_kcal":490.0,"sleep_score":83.0}
    }"""
}
