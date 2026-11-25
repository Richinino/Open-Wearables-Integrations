package sk.zdravie.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import sk.zdravie.app.controller.SessionController
import sk.zdravie.app.data.KeystoreCredentialStore
import sk.zdravie.app.data.ZdravieApi
import sk.zdravie.app.model.JournalEntry

class ZdravieViewModel(application: Application) : AndroidViewModel(application) {
    private val controller = SessionController(ZdravieApi(), KeystoreCredentialStore(application), viewModelScope)
    val state = controller.state
    init { controller.restore() }
    fun login(email: String, password: String, remember: Boolean) = controller.login(email, password, remember)
    fun refresh() = controller.refresh()
    fun logout() = controller.logout()
    fun loadDaily(day: String) = controller.loadDaily(day)
    fun saveJournal(day: String, entry: JournalEntry) = controller.saveJournal(day, entry)
    fun adoptConflict(day: String) = controller.adoptConflict(day)
}
