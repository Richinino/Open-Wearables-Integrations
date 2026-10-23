package sk.zdravie.app.data

import org.json.JSONArray
import org.json.JSONObject
import sk.zdravie.app.model.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Tolerant parser of the full dataset. Only a missing `days` array or dataset `timezone` fails the whole
 * parse; a bad value, enum or timestamp nulls just that field, and only an invalid `day` drops a day.
 */
object DatasetParser {
    private val DAY = Regex("""\d{4}-\d{2}-\d{2}""")
    private val CARDIO_STATUS = setOf("detraining", "recovering", "maintaining", "productive", "overreaching")
    private val NIGHT_LEVEL = setOf("green", "yellow", "red")

    fun dataset(value: JSONObject): Dataset {
        val timezone = value.zone("timezone") ?: error("Missing dataset timezone")
        val raw = value.getJSONArray("days")
        val parsed = (0 until raw.length()).mapNotNull { index ->
            (raw.opt(index) as? JSONObject)?.let { day(it, timezone) }
        }
        // Sorted by day; a duplicate day keeps its last occurrence.
        val days = parsed.associateBy { it.day }.values.sortedBy { it.day }
        return Dataset(timezone, value.day("first_day"), value.day("last_day"), value.instant("synced_at"),
            value.instant("latest_measurement_at"), value.instant("last_compute_success_at"), days)
    }

    private fun day(value: JSONObject, datasetZone: String): Day? {
        val date = value.day("day") ?: return null
        fun selected(key: String, sourceKey: String): Selected? =
            if (!value.has(key)) null else Selected(value.number(key), source(value.text(sourceKey)))
        return Day(date, value.zone("timezone") ?: datasetZone, (value.opt("complete") as? Boolean) ?: false,
            value.number("steps"), value.text("steps_source"), value.number("distance_m_est"),
            value.number("active_minutes_est"), value.number("activity_kcal_est"), value.number("basal_kcal"),
            value.number("total_kcal_est"),
            selected("distance_m", "distance_m_source"), selected("active_kcal", "active_kcal_source"),
            selected("total_kcal", "total_kcal_source"), selected("resting_hr", "resting_hr_source"),
            selected("hrv_ms", "hrv_ms_source"), value.text("hrv_kind"),
            value.number("hr_resting"), value.number("hr_avg"), value.number("hr_max"), value.number("hr_min"),
            value.number("zone_light_min"), value.number("zone_moderate_min"), value.number("zone_vigorous_min"),
            value.instant("sleep_start"), value.instant("sleep_end"), value.number("sleep_minutes"),
            value.number("sleep_deep_min"), value.number("sleep_rem_min"), value.number("sleep_light_min"),
            value.number("sleep_awake_min"), value.number("nap_minutes"),
            value.objects("workouts").mapNotNull { workout(it, date) },
            value.objects("sleep_timeline").mapNotNull { interval(it) },
            value.obj("scores")?.let { scores(it, date) },
            value.obj("samsung_auto")?.let {
                SamsungAuto(it.number("steps"), it.number("active_kcal"), it.number("sleep_score"))
            })
    }

    private fun workout(value: JSONObject, day: String): Workout? {
        val id = value.text("id") ?: return null
        val type = value.text("type") ?: return null
        val start = value.instant("start") ?: return null
        val end = value.instant("end") ?: return null
        return Workout(id, value.day("day") ?: day, type, start, end, value.number("duration_s"),
            value.text("source"), value.number("hr_avg"), value.number("hr_max"), value.number("hr_min"),
            value.number("zone_light_min"), value.number("zone_moderate_min"), value.number("zone_vigorous_min"),
            value.number("distance_m"), value.number("kcal_est"), value.number("strain"))
    }

    private fun interval(value: JSONObject): SleepInterval? {
        val start = value.instant("start") ?: return null
        val end = value.instant("end") ?: return null
        val stage = when (value.text("stage")) {
            "deep" -> SleepStage.DEEP
            "rem" -> SleepStage.REM
            "light" -> SleepStage.LIGHT
            "awake" -> SleepStage.AWAKE
            else -> SleepStage.ASLEEP
        }
        return SleepInterval(start, end, stage)
    }

    private fun scores(value: JSONObject, day: String): DayScores {
        val cardio = value.obj("cardio_load")
        val night = value.obj("night_signal")
        return DayScores(value.day("day") ?: day, value.number("strain"),
            CardioLoad(cardio?.number("strain_7d"), cardio?.number("tolerance_28d"), cardio?.number("ratio"),
                cardio?.text("status")?.takeIf { it in CARDIO_STATUS }),
            value.number("sleep_need_minutes"), value.score("sleep_performance"), value.score("apple_sleep"),
            value.number("sleep_regularity", signed = true), value.score("readiness"), value.score("activity"),
            NightSignal(night?.text("level")?.takeIf { it in NIGHT_LEVEL }, night?.number("night_hr"),
                night?.number("baseline"), night?.number("delta", signed = true)),
            value.number("day_score"), value.number("vo2max"), value.number("vo2max_uth"),
            value.score("whoop_age"), value.score("samsung_sleep"), value.score("energy_score"))
    }

    private fun JSONObject.score(key: String): Score? = obj(key)?.let { raw ->
        val components = LinkedHashMap<String, Double?>()
        raw.obj("components")?.let { parts -> parts.keys().forEach { components[it] = parts.number(it, signed = true) } }
        Score(raw.number("value"), components, raw.text("note"))
    }

    private fun source(value: String?): ValueSource? = when (value) {
        "measured" -> ValueSource.MEASURED
        "derived" -> ValueSource.DERIVED
        "estimated" -> ValueSource.ESTIMATED
        else -> null
    }

    private fun JSONObject.number(key: String, signed: Boolean = false): Double? {
        val number = (opt(key) as? Number)?.toDouble() ?: return null
        return number.takeIf { it.isFinite() && (signed || it >= 0) }
    }

    private fun JSONObject.text(key: String): String? = opt(key) as? String
    private fun JSONObject.obj(key: String): JSONObject? = opt(key) as? JSONObject
    private fun JSONObject.objects(key: String): List<JSONObject> =
        (opt(key) as? JSONArray)?.let { a -> (0 until a.length()).mapNotNull { a.opt(it) as? JSONObject } } ?: emptyList()
    private fun JSONObject.instant(key: String): Instant? = text(key)?.let { runCatching { Instant.parse(it) }.getOrNull() }
    private fun JSONObject.zone(key: String): String? = text(key)?.takeIf { runCatching { ZoneId.of(it) }.isSuccess }
    private fun JSONObject.day(key: String): String? = text(key)?.takeIf {
        DAY.matches(it) && runCatching { LocalDate.parse(it).toString() == it }.getOrDefault(false)
    }
}
