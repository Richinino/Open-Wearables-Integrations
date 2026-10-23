package sk.zdravie.app.data

import org.json.JSONArray
import org.json.JSONObject
import sk.zdravie.app.logic.InsightText
import sk.zdravie.app.model.*

/** Strict parsing of the Balík 1 payloads (docs/balik-1-api.md). Throws on malformed input. */
internal object DailyParser {
    private val STATUSES = setOf("ready", "partial", "insufficient_data")

    fun insights(json: JSONObject): InsightsResult {
        val status = json.get("status") as? String
        require(status in STATUSES)
        val array = json.get("items") as? JSONArray ?: throw IllegalArgumentException("items")
        // One broken item must not hide the rest of the day.
        val items = (0 until array.length()).mapNotNull { runCatching { insight(array.getJSONObject(it)) }.getOrNull() }
        return InsightsResult(status!!, items)
    }

    private fun insight(json: JSONObject): Insight {
        val evidence = plain(json.getJSONObject("evidence")) as Map<*, *>
        @Suppress("UNCHECKED_CAST") val map = evidence as Map<String, Any?>
        val key = text(json, "message_key")
        return Insight(text(json, "id"), text(json, "rule_id"), key, text(json, "kind"), map, InsightText.of(key, map))
    }

    private fun text(json: JSONObject, key: String): String = (json.get(key) as? String)?.takeIf { it.isNotEmpty() }
        ?: throw IllegalArgumentException(key)

    private fun plain(value: Any?): Any? = when (value) {
        null, JSONObject.NULL -> null
        is JSONObject -> value.keys().asSequence().associateWith { plain(value.get(it)) }
        is JSONArray -> (0 until value.length()).map { plain(value.get(it)) }
        is String, is Boolean, is Number -> value
        else -> throw IllegalArgumentException("evidence")
    }

    /** `{entry, revision}`: used for GET, PATCH and the `revision_conflict` body. */
    fun journal(json: JSONObject): JournalState {
        val revision = json.get("revision")
        require((revision is Int || revision is Long) && (revision as Number).toLong() >= 0)
        val entry = json.get("entry")
        return JournalState(if (entry === JSONObject.NULL) null else entry(entry as? JSONObject ?: throw IllegalArgumentException("entry")),
            revision.toLong())
    }

    private fun entry(json: JSONObject): JournalEntry {
        val context = json.opt("context").takeIf { it != null && it !== JSONObject.NULL } as? JSONObject ?: JSONObject()
        val note = json.opt("note") ?: JSONObject.NULL
        require(note === JSONObject.NULL || (note is String && note.length <= JournalKeys.NOTE_LIMIT))
        return JournalEntry(
            JournalKeys.RATINGS.associateWith { key ->
                val value = json.opt(key)
                when {
                    value == null || value === JSONObject.NULL -> null
                    value is Int && value in 1..5 -> value
                    else -> throw IllegalArgumentException(key)
                }
            },
            JournalKeys.CONTEXT.associateWith { key ->
                val value = context.opt(key)
                when (value) {
                    null, JSONObject.NULL -> null
                    is Boolean -> value
                    else -> throw IllegalArgumentException(key)
                }
            },
            note as? String)
    }
}
