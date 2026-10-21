package sk.zdravie.app.data

import org.json.JSONArray
import org.json.JSONObject
import sk.zdravie.app.model.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

object Payloads {
    internal const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
    internal val ACCOUNT_ID = Regex("[a-zA-Z0-9_-]{1,128}")
    private val valueSources = setOf("measured", "derived", "estimated")

    fun identity(value: JSONObject): AccountIdentity {
        require(value.keys().asSequence().toSet() == setOf("actorId", "dataAccountId", "viewOnly", "sessionVersion"))
        return AccountIdentity(value.string("actorId"), value.string("dataAccountId"),
            value.boolean("viewOnly"), value.integer("sessionVersion")).also {
            require(ACCOUNT_ID.matches(it.actorId) && ACCOUNT_ID.matches(it.dataAccountId))
        }
    }

    fun identityJson(value: AccountIdentity): String = JSONObject().put("actorId", value.actorId)
        .put("dataAccountId", value.dataAccountId).put("viewOnly", value.viewOnly)
        .put("sessionVersion", value.sessionVersion).toString()

    fun session(value: JSONObject, now: Long = System.currentTimeMillis()): AppSession {
        val raw = value.getJSONObject("account")
        val settings = raw.getJSONObject("settings")
        val account = Account(raw.string("id"), raw.string("first_name"), raw.text("last_name"),
            raw.string("email"), raw.string("role"), raw.string("status"), raw.boolean("paired"),
            raw.boolean("has_samsung"), settings.string("theme"), settings.string("sleep_score"))
        val identity = identity(value.getJSONObject("identity"))
        require(ACCOUNT_ID.matches(account.id))
        require(identity.actorId == account.id && identity.dataAccountId == account.id && !identity.viewOnly)
        require(identity.sessionVersion == raw.integer("session_version"))
        require(account.role in setOf("user", "admin") && account.status in setOf("active", "pending"))
        require(account.theme in setOf("system", "light", "dark"))
        require(account.sleepScore in setOf("performance", "apple", "samsung"))
        val persistent = value.boolean("persistent")
        val expiresAt = value.integer("expiresAt")
        SessionCookies.validateExpiry(expiresAt, persistent, now)
        return AppSession(account, identity, expiresAt, persistent)
    }

    fun days(value: JSONObject, sleepScore: String): List<DaySummary> {
        require(sleepScore in setOf("performance", "apple", "samsung"))
        val datasetTimezone = value.timezoneOrNull()
        val days = value.getJSONArray("days")
        return (0 until days.length()).map { index ->
            val day = days.getJSONObject(index)
            val timezone = day.timezoneOrNull() ?: datasetTimezone ?: error("Missing data timezone")
            val date = day.string("day")
            require(Regex("""\d{4}-\d{2}-\d{2}""").matches(date) && LocalDate.parse(date).toString() == date)
            val scores = day.objectOrNull("scores")
            val sleepKey = when (sleepScore) { "apple" -> "apple_sleep"; "samsung" -> "samsung_sleep"; else -> "sleep_performance" }
            val sentSleep = if (sleepScore == "samsung") day.objectOrNull("samsung_auto")?.score("sleep_score") else null
            val selectedSleep = sentSleep ?: scores?.objectOrNull(sleepKey)?.score("value")
            val workouts = day.arrayOrNull("workouts")
            val distance = if (day.has("distance_m")) day.number("distance_m") else day.number("distance_m_est")
            val selectedRhr = day.number("resting_hr")
            val restingHr = selectedRhr ?: day.number("hr_resting")
            val steps = day.number("steps")?.also { require(it <= MAX_SAFE_INTEGER && it == it.toLong().toDouble()) }?.toLong()
            val hrvKind = day.text("hrv_kind")?.also { require(it in setOf("rmssd", "sdnn")) }
            // Validate provenance even when its corresponding metric is missing.
            val distanceSource = day.source("distance_m_source")
            val restingHrSource = day.source("resting_hr_source")
            DaySummary(date, day.boolean("complete"), steps, distance,
                day.number("active_minutes_est"), day.number("sleep_minutes"),
                selectedSleep, scores?.objectOrNull("readiness")?.score("value"),
                scores?.objectOrNull("activity")?.score("value"), restingHr,
                day.number("hrv_ms"), hrvKind,
                if (workouts == null) emptyList() else (0 until workouts.length()).map { n ->
                    val workout = workouts.getJSONObject(n)
                    WorkoutSummary(workout.string("id"), workout.string("type"),
                        workout.timestamp("start") ?: error("Missing workout start"),
                        workout.number("duration_s"), workout.number("distance_m"), workout.number("hr_avg"))
                },
                if (distance == null) null else if (day.has("distance_m")) distanceSource else "estimated",
                if (restingHr == null) null else if (selectedRhr != null) restingHrSource else "derived",
                sleepScoreEstimated = sleepScore == "samsung" && sentSleep == null && selectedSleep != null,
                timezone = timezone)
        }.sortedBy { it.day }.also { result -> require(result.map { it.day }.distinct().size == result.size) }
    }

    fun syncedAt(value: JSONObject): String? {
        val computed = value.timestamp("last_compute_success_at")
        val synced = value.timestamp("synced_at")
        return computed ?: synced
    }

    internal fun JSONObject.integer(key: String): Long {
        val value = get(key)
        require(value is Number && value.toDouble().isFinite())
        val number = value.toDouble()
        require(number >= 0 && number <= MAX_SAFE_INTEGER && number == value.toLong().toDouble())
        return value.toLong()
    }

    internal fun JSONObject.string(key: String): String = (get(key) as? String) ?: error("Invalid string")
    internal fun JSONObject.boolean(key: String): Boolean = (get(key) as? Boolean) ?: error("Invalid boolean")

    fun JSONObject.number(key: String): Double? {
        if (!has(key) || isNull(key)) return null
        val value = get(key) as? Number ?: error("Invalid number")
        return value.toDouble().also { require(it.isFinite() && it >= 0) }
    }

    fun JSONObject.text(key: String): String? {
        if (!has(key) || isNull(key)) return null
        return string(key)
    }

    internal fun JSONObject.timestamp(key: String): String? = text(key)?.also {
        require(it.isNotBlank())
        Instant.parse(it)
    }

    private fun JSONObject.source(key: String): String? = text(key)?.also { require(it in valueSources) }
    private fun JSONObject.score(key: String): Double? = number(key)?.also { require(it <= 100) }
    private fun JSONObject.timezoneOrNull(): String? = text("timezone")?.also { ZoneId.of(it) }
    private fun JSONObject.objectOrNull(key: String): JSONObject? = if (!has(key) || isNull(key)) null else getJSONObject(key)
    private fun JSONObject.arrayOrNull(key: String): JSONArray? = if (!has(key) || isNull(key)) null else getJSONArray(key)
}
