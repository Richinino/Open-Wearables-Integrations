package sk.zdravie.app.controller

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
                mutableState.value = if (mutableState.value.session?.identity != fresh.identity)
                    AppUiState(session = fresh, refreshing = true)
                else mutableState.value.copy(session = fresh, loading = false)
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
        if (ticket == revision) mutableState.value = AppUiState(session = session, days = result.days, syncedAt = result.syncedAt, hasLoaded = true)
    }
    fun logout() {
        ++revision
        operation?.cancel()
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
            clearCredential()
            mutableState.value = AppUiState(error = message)
        } else mutableState.value = mutableState.value.copy(loading = false, refreshing = false, error = message)
    }
}
