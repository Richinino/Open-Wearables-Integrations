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
import sk.zdravie.app.ui.ZdravieApp

class MainActivity:ComponentActivity() {
    private lateinit var model: ZdravieViewModel
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        model=ViewModelProvider(this)[ZdravieViewModel::class.java]
        setContent {
            val state by model.state.collectAsStateWithLifecycle()
            ZdravieApp(state,model::login,model::logout,model::refresh,::openWeb)
        }
    }
    override fun onStart() {
        super.onStart()
        if(model.state.value.hasLoaded) model.refresh()
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
