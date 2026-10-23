package sk.zdravie.app.model

/** Keys of the Balík 1 journal contract, in display order. */
object JournalKeys {
    val RATINGS = listOf("morning_energy", "sleep_quality", "evening_stress", "muscle_soreness")
    val CONTEXT = listOf("travel", "unusual_schedule", "late_meal", "late_caffeine")
    const val NOTE_LIMIT = 500
}

data class Insight(val id: String, val ruleId: String, val messageKey: String, val kind: String,
    val evidence: Map<String, Any?>, val text: String)
data class InsightsResult(val status: String, val items: List<Insight>)
data class JournalEntry(val ratings: Map<String, Int?>, val context: Map<String, Boolean?>, val note: String?)
/** `entry == null` with any revision is an empty day; the revision must be used as returned. */
data class JournalState(val entry: JournalEntry?, val revision: Long)

sealed interface DailyResult<out T> {
    data class Ok<T>(val value: T) : DailyResult<T>
    /** The server has no such endpoint (yet): the block is hidden. */
    object Unsupported : DailyResult<Nothing>
    /** Temporary failure: the block is quietly unavailable. */
    object Unavailable : DailyResult<Nothing>
    /** Somebody else saved first; [current] is what the server holds now. */
    data class Conflict(val current: JournalState) : DailyResult<Nothing>
}

/** `null` means not loaded yet. [conflict] holds the server's newer journal after a rejected save. */
data class DailyUiState(val day: String, val insights: DailyResult<InsightsResult>? = null,
    val journal: DailyResult<JournalState>? = null, val saving: Boolean = false, val saveError: String? = null,
    val conflict: JournalState? = null)
