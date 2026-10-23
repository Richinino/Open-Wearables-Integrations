package sk.zdravie.app.controller

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import sk.zdravie.app.data.*
import sk.zdravie.app.model.*

/** Entry points run on the UI scope; each HTTP call receives immutable credentials. */
class SessionController(private val api: MobileApi, private val store: CredentialStore,
    private val scope: CoroutineScope, private val io: CoroutineDispatcher = Dispatchers.IO,
    private val now: () -> Long = System::currentTimeMillis) {
    private val mutableState = MutableStateFlow(AppUiState(loading = true))
    val state: StateFlow<AppUiState> = mutableState.asStateFlow()
    private var credential: SessionCredential? = null
    private var revision = 0L
    private var operation: Job? = null
    // Balík 1 state: [dailyEpoch] changes whenever the account scope does; [loadTicket] with every loadDaily.
    private var dailyEpoch = 0L
    private var loadTicket = 0L
    private var dailyJob: Job? = null

    fun restore() {
        val saved = runCatching { store.read() }.getOrNull()
        if (saved == null || saved.expiresAt <= now()) {
            clearCredential()
            mutableState.value = AppUiState()
        } else {
            credential = saved
            refresh()
        }
    }
    fun login(email: String, password: String, remember: Boolean) {
        val ticket = ++revision
        operation?.cancel()
        resetDaily()
        clearCredential()
        mutableState.value = AppUiState(loading = true)
        operation = scope.launch {
            try {
                val result = withContext(io) { api.login(email, password, remember) }
                if (ticket != revision) return@launch
                try { store.write(result.credential) }
                catch (_: Exception) {
                    clearCredential()
                    throw ApiFailure(503, "Reláciu sa nepodarilo bezpečne uložiť. Skús prihlásenie bez zapamätania.")
                }
                credential = result.credential
                mutableState.value = AppUiState(session = result.session, refreshing = true)
                loadData(ticket, result.session, result.credential)
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { fail(ticket, error) }
        }
    }
    fun refresh() {
        val saved = credential
        if (saved == null) { mutableState.value = AppUiState(); return }
        val ticket = ++revision
        operation?.cancel()
        mutableState.value = mutableState.value.copy(loading = mutableState.value.session == null, refreshing = true, error = null)
        operation = scope.launch {
            try {
                val fresh = withContext(io) { api.session(saved) }
                if (ticket != revision) return@launch
                mutableState.value = if (mutableState.value.session?.identity != fresh.identity) {
                    resetDaily()
                    AppUiState(session = fresh, refreshing = true)
                } else mutableState.value.copy(session = fresh, loading = false)
                loadData(ticket, fresh, saved)
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { fail(ticket, error) }
        }
    }
    private suspend fun loadData(ticket: Long, session: AppSession, saved: SessionCredential) {
        if (session.account.status != "active" || !session.account.paired) {
            if (ticket == revision) mutableState.value = AppUiState(session = session, hasLoaded = true)
            return
        }
        val result = withContext(io) { api.data(saved, session) }
        if (ticket == revision) {
            val daily = mutableState.value.daily.takeIf { mutableState.value.session?.identity == session.identity }
            mutableState.value = AppUiState(session = session, days = result.days, syncedAt = result.syncedAt, hasLoaded = true,
                dataset = result.dataset, daily = daily)
        }
    }
    fun logout() {
        ++revision
        operation?.cancel()
        resetDaily()
        val old = credential
        clearCredential()
        mutableState.value = AppUiState()
        if (old != null) scope.launch(io) { runCatching { api.logout(old) } }
    }
    private fun clearCredential() {
        credential = null
        runCatching { store.write(null) }
    }
    private fun fail(ticket: Long, error: Exception) {
        if (ticket != revision) return
        val message = if (error is ApiFailure) error.message else "Dáta sa nepodarilo načítať. Skús to znova."
        if (error is ApiFailure && error.status in setOf(401, 403, 409)) {
            resetDaily()
            clearCredential()
            mutableState.value = AppUiState(error = message)
        } else mutableState.value = mutableState.value.copy(loading = false, refreshing = false, error = message)
    }

    // ---- Balík 1: day insights and journal (optional on the server) ----

    private fun resetDaily() {
        ++dailyEpoch
        dailyJob?.cancel()
        dailyJob = null
    }

    /** Loads insights and journal of [day] in parallel; each block resolves on its own. */
    fun loadDaily(day: String) {
        val saved = credential
        val session = mutableState.value.session
        if (saved == null || session == null || session.account.status != "active") return
        val epoch = dailyEpoch
        val ticket = ++loadTicket
        dailyJob?.cancel()
        val previous = mutableState.value.daily?.takeIf { it.day == day }
        mutableState.value = mutableState.value.copy(daily = previous ?: DailyUiState(day))
        dailyJob = scope.launch {
            coroutineScope {
                launch {
                    fetchDaily(epoch) { api.insights(saved, session, day) }?.let { result ->
                        updateDaily(epoch, session.identity, ticket) { it.copy(insights = result) }
                    }
                }
                launch {
                    fetchDaily(epoch) { api.journal(saved, session, day) }?.let { result ->
                        updateDaily(epoch, session.identity, ticket) { it.copy(journal = result) }
                    }
                }
            }
        }
    }

    /** Sends only the fields that differ from the last loaded entry, guarded by its revision. */
    fun saveJournal(day: String, entry: JournalEntry) {
        val saved = credential
        val session = mutableState.value.session
        val daily = mutableState.value.daily
        if (saved == null || session == null || daily == null || daily.day != day || daily.saving) return
        val base = daily.journal as? DailyResult.Ok ?: return
        if ((entry.note?.length ?: 0) > JournalKeys.NOTE_LIMIT) {
            mutableState.value = mutableState.value.copy(daily = daily.copy(saveError = "Poznámka môže mať najviac ${JournalKeys.NOTE_LIMIT} znakov."))
            return
        }
        val patch = journalPatch(base.value.entry, entry)
        if (patch.length() == 0) return
        val epoch = dailyEpoch
        mutableState.value = mutableState.value.copy(daily = daily.copy(saving = true, saveError = null))
        scope.launch {
            val result = fetchDaily(epoch) { api.saveJournal(saved, session, day, patch, base.value.revision) } ?: return@launch
            updateDaily(epoch, session.identity, null, day) { current ->
                when (result) {
                    is DailyResult.Ok -> current.copy(saving = false, saveError = null, conflict = null, journal = result)
                    is DailyResult.Conflict -> current.copy(saving = false, conflict = result.current,
                        saveError = "Zápis sa medzitým zmenil. Tvoje úpravy ostali; môžeš načítať novšiu verziu.")
                    DailyResult.Unsupported -> current.copy(saving = false, journal = DailyResult.Unsupported)
                    DailyResult.Unavailable -> current.copy(saving = false, saveError = "Zápis sa nepodarilo uložiť. Skús to znova.")
                }
            }
        }
    }

    /** Replaces the loaded journal by the newer server version offered after a conflict. */
    fun adoptConflict(day: String) {
        val daily = mutableState.value.daily ?: return
        val newer = daily.conflict ?: return
        if (daily.day != day) return
        mutableState.value = mutableState.value.copy(daily = daily.copy(journal = DailyResult.Ok(newer), conflict = null, saveError = null))
    }

    private fun journalPatch(old: JournalEntry?, new: JournalEntry): JSONObject {
        fun value(v: Any?): Any = v ?: JSONObject.NULL
        val patch = JSONObject()
        for (key in JournalKeys.RATINGS) {
            val before = old?.ratings?.get(key)
            if (new.ratings[key] != before) patch.put(key, value(new.ratings[key]))
        }
        val context = JSONObject()
        for (key in JournalKeys.CONTEXT) {
            val before = old?.context?.get(key)
            if (new.context[key] != before) context.put(key, value(new.context[key]))
        }
        if (context.length() > 0) patch.put("context", context)
        if (new.note != old?.note) patch.put("note", value(new.note))
        return patch
    }

    /** Runs a daily call on IO. `null` means the call ended the session (or was superseded) and is already handled. */
    private suspend fun <T> fetchDaily(epoch: Long, call: () -> DailyResult<T>): DailyResult<T>? = try {
        withContext(io) { call() }
    } catch (error: CancellationException) { throw error }
    catch (error: ApiFailure) {
        if (error.status in AUTH_FAILURES) { failDaily(epoch, error); null } else DailyResult.Unavailable
    } catch (_: Exception) { DailyResult.Unavailable }

    private fun failDaily(epoch: Long, error: ApiFailure) {
        if (epoch != dailyEpoch) return
        ++revision
        operation?.cancel()
        resetDaily()
        clearCredential()
        mutableState.value = AppUiState(error = error.message)
    }

    private fun updateDaily(epoch: Long, identity: AccountIdentity, ticket: Long?, day: String? = null,
        change: (DailyUiState) -> DailyUiState) {
        val state = mutableState.value
        val current = state.daily ?: return
        if (epoch != dailyEpoch || state.session?.identity != identity) return
        if (ticket != null && ticket != loadTicket) return
        if (day != null && current.day != day) return
        mutableState.value = state.copy(daily = change(current))
    }

    private companion object { val AUTH_FAILURES = setOf(401, 403, 409) }
}
