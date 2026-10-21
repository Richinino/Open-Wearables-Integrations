package sk.zdravie.app.updates

import android.app.Activity
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import sk.zdravie.app.BuildConfig
import sk.zdravie.app.updates.core.GithubUpdateSource

class UpdateViewModel(application: Application) : AndroidViewModel(application) {
    private val installer = AndroidUpdateInstaller(application)
    private val controller = UpdateController(
        GithubUpdateSource(), BuildConfig.VERSION_CODE.toLong(), AndroidUpdatePreferences(application),
        UpdateCache.prepare(application.cacheDir), installer, viewModelScope,
    )
    val state = controller.state
    private var waitingForPermission = false
    private var installing = false
    private var installRevision = 0L

    fun check(manual: Boolean = false) = controller.check(manual)
    fun download() = controller.download()
    fun defer() { ++installRevision; waitingForPermission = false; controller.defer() }
    fun cancelDownload() = controller.cancelDownload()
    fun dismissError() = controller.dismissError()

    fun install(activity: Activity) {
        if (installing || activity.isFinishing || activity.isDestroyed) return
        val (file, release) = controller.installCandidate() ?: return
        installing = true
        val token = ++installRevision
        viewModelScope.launch {
            try {
                runInterruptible(Dispatchers.IO) { installer.validate(file, release) }
                if (token != installRevision || activity.isFinishing || activity.isDestroyed) return@launch
                if (controller.installCandidate() != (file to release)) return@launch
                if (!installer.permitted()) {
                    waitingForPermission = true
                    controller.awaitingPermission()
                    installer.requestPermission(activity)
                } else {
                    waitingForPermission = false
                    installer.launch(activity, file)
                    controller.installerOpened()
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { waitingForPermission = false; controller.installFailed() }
            finally { installing = false }
        }
    }

    fun onResume(activity: Activity) {
        if (!waitingForPermission) return
        waitingForPermission = false
        val granted = installer.permitted()
        controller.permissionReturned(granted)
        if (granted) install(activity)
    }
}

private class AndroidUpdatePreferences(application: Application) : UpdatePreferences {
    private val store = application.getSharedPreferences("public_updates", Application.MODE_PRIVATE)
    override var lastCheckedAt: Long
        get() = store.getLong("last_checked", 0)
        set(value) { store.edit().putLong("last_checked", value).apply() }
    override var deferredVersion: Long
        get() = store.getLong("deferred_version", 0)
        set(value) { store.edit().putLong("deferred_version", value).apply() }
    override var deferredUntil: Long
        get() = store.getLong("deferred_until", 0)
        set(value) { store.edit().putLong("deferred_until", value).apply() }
}
