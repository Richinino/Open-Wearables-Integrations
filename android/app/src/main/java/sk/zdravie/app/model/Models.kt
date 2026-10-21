package sk.zdravie.app.model

data class Account(val id: String, val firstName: String, val lastName: String?, val email: String,
    val role: String, val status: String, val paired: Boolean, val hasSamsung: Boolean, val theme: String,
    val sleepScore: String = "performance")
data class AccountIdentity(val actorId: String, val dataAccountId: String, val viewOnly: Boolean, val sessionVersion: Long)
data class AppSession(val account: Account, val identity: AccountIdentity, val expiresAt: Long, val persistent: Boolean)
data class DaySummary(val day: String, val complete: Boolean, val steps: Long?, val distanceMeters: Double?,
    val activeMinutes: Double?, val sleepMinutes: Double?, val sleepScore: Double?, val readiness: Double?,
    val activityScore: Double?, val restingHr: Double?, val hrvMs: Double?, val hrvKind: String?, val workouts: List<WorkoutSummary>,
    val distanceSource: String? = null, val restingHrSource: String? = null,
    val sleepScoreEstimated: Boolean = false, val timezone: String? = null)
data class WorkoutSummary(val id: String, val type: String, val start: String, val durationSeconds: Double?,
    val distanceMeters: Double?, val averageHr: Double?)
data class AppUiState(val loading: Boolean = false, val session: AppSession? = null,
    val days: List<DaySummary> = emptyList(), val syncedAt: String? = null, val error: String? = null,
    val refreshing: Boolean = false, val hasLoaded: Boolean = false)
