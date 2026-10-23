package sk.zdravie.app.data

import org.json.JSONObject
import sk.zdravie.app.model.*

interface MobileApi {
    fun login(email: String, password: String, remember: Boolean): LoginResult
    fun session(credential: SessionCredential): AppSession
    fun logout(credential: SessionCredential)
    fun data(credential: SessionCredential, session: AppSession): DatasetResult
    /** Balík 1: [DailyResult.Unsupported] when the server does not have the endpoint (yet). */
    fun insights(credential: SessionCredential, session: AppSession, day: String): DailyResult<InsightsResult>
    fun journal(credential: SessionCredential, session: AppSession, day: String): DailyResult<JournalState>
    /** [patch] carries only the changed fields; `null` clears a value. */
    fun saveJournal(credential: SessionCredential, session: AppSession, day: String, patch: JSONObject,
        expectedRevision: Long): DailyResult<JournalState>
}
