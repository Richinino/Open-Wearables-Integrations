package sk.zdravie.app

import android.content.Intent
import android.content.ActivityNotFoundException
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import java.time.Instant
import kotlinx.coroutines.delay
import sk.zdravie.app.ui.ZdravieApp
import sk.zdravie.app.updates.UpdateUi
import sk.zdravie.app.updates.UpdateViewModel

class MainActivity:ComponentActivity() {
    private lateinit var model: ZdravieViewModel
    private lateinit var updater: UpdateViewModel
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        model=ViewModelProvider(this)[ZdravieViewModel::class.java]
        updater=ViewModelProvider(this)[UpdateViewModel::class.java]
        setContent {
            val state by model.state.collectAsStateWithLifecycle()
            val updateState by updater.state.collectAsStateWithLifecycle()
            // "Dáta pred X" and the 15:00 switch to the evening layout follow the clock while the app stays open.
            val now by produceState(Instant.now()) { while (true) { delay(30_000); value = Instant.now() } }
            ZdravieApp(state,model::login,model::logout,model::refresh,::openWeb,
                onCheckForUpdates = { updater.check(manual = true) },
                overlay = {
                    UpdateUi(updateState, updater::download, updater::defer,
                        { updater.install(this) }, updater::dismissError, updater::cancelDownload,
                        { updater.check(manual = true) })
                },
                onLoadDaily = model::loadDaily,
                onSaveJournal = model::saveJournal,
                onAdoptConflict = model::adoptConflict,
                clock = { now })
        }
    }
    override fun onStart() {
        super.onStart()
        if(model.state.value.hasLoaded) model.refresh()
        updater.check()
    }
    override fun onResume() {
        super.onResume()
        updater.onResume(this)
    }
    private fun openWeb(value:String) {
        val base=Uri.parse(BuildConfig.API_BASE_URL)
        val uri=Uri.parse(if(value.startsWith('/')) BuildConfig.API_BASE_URL.trimEnd('/')+value else value)
        if(uri.scheme != "https" || uri.host != base.host || uri.port != -1 || uri.userInfo != null ||
            uri.query != null || uri.fragment != null || uri.path !in setOf("/registracia","/zabudnute-heslo","/ucet","/nastavenia","/admin")) return
        try { startActivity(Intent(Intent.ACTION_VIEW,uri)) }
        catch(_:ActivityNotFoundException) { /* No browser installed on this device. */ }
    }
}
