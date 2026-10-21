package sk.zdravie.app.data

import sk.zdravie.app.model.AppSession

interface MobileApi {
    fun login(email: String, password: String, remember: Boolean): LoginResult
    fun session(credential: SessionCredential): AppSession
    fun logout(credential: SessionCredential)
    fun data(credential: SessionCredential, session: AppSession): DatasetResult
}
