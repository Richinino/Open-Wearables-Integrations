package sk.zdravie.app.updates

import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import sk.zdravie.app.updates.core.UpdateFailure
import sk.zdravie.app.updates.core.UpdateRelease
import sk.zdravie.app.updates.core.UpdateSource

enum class UpdateStage { IDLE, CHECKING, OFFER, DOWNLOADING, READY, PERMISSION, ERROR, CURRENT }

data class UpdateUiState(
    val stage: UpdateStage = UpdateStage.IDLE,
    val visible: Boolean = false,
    val release: UpdateRelease? = null,
    val downloadedBytes: Long = 0,
    val error: String? = null,
)

/** Only public release metadata is persisted. This store never receives an account or cookie. */
interface UpdatePreferences {
    var lastCheckedAt: Long
    var deferredVersion: Long
    var deferredUntil: Long
}

fun interface UpdateArtifactValidator { fun validate(file: File, release: UpdateRelease) }

/** Independent from SessionController: an unavailable release server cannot change health or login state. */
class UpdateController(
    private val source: UpdateSource,
    private val installedVersion: Long,
    private val preferences: UpdatePreferences,
    private val directory: File,
    private val validator: UpdateArtifactValidator,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val mutable = MutableStateFlow(UpdateUiState())
    val state = mutable.asStateFlow()
    private var job: Job? = null
    @Volatile private var revision = 0L
    private var suppressedOfferRevision = -1L
    private var downloaded: File? = null
    private var downloadedRelease: UpdateRelease? = null

    fun check(manual: Boolean = false) {
        if (job?.isActive == true) {
            if (manual) {
                suppressedOfferRevision = -1L
                mutable.value = mutable.value.copy(visible = true)
            }
            return
        }
        if (downloaded?.isFile == false) { downloaded = null; downloadedRelease = null }
        val cachedFile = downloaded
        val cachedRelease = downloadedRelease
        val wasVisible = mutable.value.visible
        val time = now()
        val last = preferences.lastCheckedAt
        if (!manual && last > 0 && time >= last && time - last < CHECK_INTERVAL) {
            if (cachedFile != null && cachedRelease != null && !isDeferred(cachedRelease)) {
                mutable.value = UpdateUiState(UpdateStage.READY, true, cachedRelease, cachedRelease.sizeBytes)
            }
            return
        }
        // Throttle attempted checks too, so a disconnected phone does not retry on every foreground.
        preferences.lastCheckedAt = time
        val token = ++revision
        mutable.value = UpdateUiState(stage = UpdateStage.CHECKING, visible = manual, release = cachedRelease)
        job = scope.launch {
            try {
                val release = runInterruptible(io) { source.latest(installedVersion) }
                if (token != revision) return@launch
                val deferred = release != null && !manual && !mutable.value.visible && isDeferred(release)
                val reuseCached = cachedFile != null && cachedFile.isFile && cachedRelease == release
                if (!reuseCached) {
                    cachedFile?.delete()
                    downloaded = null
                    downloadedRelease = null
                }
                mutable.value = when {
                    release == null -> UpdateUiState(stage = UpdateStage.CURRENT, visible = mutable.value.visible)
                    reuseCached -> UpdateUiState(UpdateStage.READY, !deferred && suppressedOfferRevision != token, release, release.sizeBytes)
                    deferred -> UpdateUiState()
                    else -> UpdateUiState(stage = UpdateStage.OFFER, visible = suppressedOfferRevision != token, release = release)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                if (token == revision) {
                    val message = safeError(failure, "Aktualizácie teraz nie je možné overiť. Skúste to neskôr.")
                    mutable.value = if (cachedFile != null && cachedFile.isFile && cachedRelease != null) {
                        val requested = mutable.value.visible
                        UpdateUiState(UpdateStage.READY, requested || (wasVisible && !isDeferred(cachedRelease) && suppressedOfferRevision != token), cachedRelease,
                            cachedRelease.sizeBytes, error = if (requested) message else null)
                    } else UpdateUiState(UpdateStage.ERROR, mutable.value.visible, error = message)
                }
            }
        }
    }

    fun download() {
        if (job?.isActive == true) return
        val release = mutable.value.release ?: return
        val token = ++revision
        mutable.value = UpdateUiState(UpdateStage.DOWNLOADING, true, release)
        val destination = File(directory, "update-${release.versionCode}-$token.apk")
        job = scope.launch {
            try {
                val result = runInterruptible(io) {
                    require(directory.mkdirs() || directory.isDirectory)
                    source.download(release, destination) { done, _ ->
                        mutable.update { current ->
                            if (token == revision && current.stage == UpdateStage.DOWNLOADING)
                                current.copy(downloadedBytes = done.coerceIn(0, release.sizeBytes)) else current
                        }
                    }.also { validator.validate(it, release) }
                }
                if (token != revision) return@launch
                downloaded = result
                downloadedRelease = release
                mutable.value = UpdateUiState(UpdateStage.READY, true, release, release.sizeBytes)
            } catch (cancelled: CancellationException) { destination.delete(); throw cancelled }
            catch (failure: Exception) {
                destination.delete()
                if (token == revision) mutable.value = UpdateUiState(
                    UpdateStage.ERROR, true, release,
                    error = safeError(failure, "Aktualizáciu sa nepodarilo stiahnuť alebo overiť. Vaša aplikácia zostáva nezmenená."),
                )
            }
        }
    }

    fun cancelDownload() {
        ++revision
        job?.cancel()
        job = null
        mutable.value = mutable.value.copy(stage = UpdateStage.OFFER, downloadedBytes = 0, error = null)
    }

    fun defer() {
        if (mutable.value.stage == UpdateStage.DOWNLOADING) cancelDownload()
        if (mutable.value.stage == UpdateStage.CHECKING) suppressedOfferRevision = revision
        mutable.value.release?.let {
            preferences.deferredVersion = it.versionCode
            preferences.deferredUntil = now() + DEFER_INTERVAL
        }
        mutable.value = mutable.value.copy(visible = false)
    }

    fun dismissError() {
        if (mutable.value.stage == UpdateStage.CHECKING) suppressedOfferRevision = revision
        mutable.value = mutable.value.copy(visible = false)
    }

    fun installCandidate(): Pair<File, UpdateRelease>? = downloaded?.let { file ->
        downloadedRelease?.let { release -> file to release }
    }

    fun awaitingPermission() { mutable.value = mutable.value.copy(stage = UpdateStage.PERMISSION, error = null) }
    fun installerOpened() { mutable.value = mutable.value.copy(stage = UpdateStage.READY, visible = false, error = null) }
    fun permissionReturned(granted: Boolean) {
        mutable.value = mutable.value.copy(stage = UpdateStage.READY, visible = true,
            error = if (granted) null else "Inštalácia nebola povolená. Môžete ju povoliť pri ďalšom pokuse alebo aktualizáciu odložiť.")
    }
    fun installFailed() {
        mutable.value = mutable.value.copy(stage = UpdateStage.READY, visible = true,
            error = "Inštalátor sa nepodarilo otvoriť alebo balík neprešiel overením. Aktualizáciu môžete stiahnuť znova.")
        downloaded?.delete()
        downloaded = null
        downloadedRelease = null
        mutable.value = mutable.value.copy(stage = UpdateStage.ERROR)
    }

    private fun safeError(failure: Exception, fallback: String): String =
        if (failure is UpdateFailure) failure.message.takeIf { it.length <= 300 } ?: fallback else fallback

    private fun isDeferred(release: UpdateRelease): Boolean {
        val remaining = preferences.deferredUntil - now()
        return preferences.deferredVersion == release.versionCode && remaining > 0 && remaining <= DEFER_INTERVAL
    }

    companion object {
        const val CHECK_INTERVAL = 6L * 60 * 60 * 1000
        const val DEFER_INTERVAL = 24L * 60 * 60 * 1000
    }
}
