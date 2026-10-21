package sk.zdravie.app.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import sk.zdravie.app.data.Payloads.integer
import sk.zdravie.app.data.Payloads.string

// Never expose a session token in a generated data-class string or exception message.
data class SessionCredential(val cookie: String, val expiresAt: Long, val persistent: Boolean) {
    override fun toString(): String = "SessionCredential(cookie=[redacted], expiresAt=$expiresAt, persistent=$persistent)"
}

interface CredentialStore { fun read(): SessionCredential?; fun write(value: SessionCredential?) }

/** Only the session cookie is stored; health data and passwords remain in memory. */
class KeystoreCredentialStore internal constructor(context: Context, private val alias: String) : CredentialStore {
    constructor(context: Context) : this(context, "zdravie_session_v1")

    private val file = AtomicFile(File(context.noBackupFilesDir, "session.enc"))
    private val aad = "sk.zdravie.app.session.v1".toByteArray(Charsets.UTF_8)

    private fun key(create: Boolean): SecretKey? {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        if (!create) return null
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }

    private fun clear() {
        // Destroy the decryption key as well: even a stale, undeletable ciphertext cannot restore logout.
        try {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(alias)
        } finally { file.delete() }
    }

    @Synchronized override fun read(): SessionCredential? {
        if (!file.baseFile.exists()) return null
        return try {
            require(file.baseFile.length() in 30L..8192L)
            val bytes = file.readFully()
            require(bytes.size in 30..8192 && bytes[0] == 1.toByte())
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, key(false) ?: error("Session key unavailable"),
                    GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
                updateAAD(aad)
            }
            val json = StrictJson.objectValue(cipher.doFinal(bytes.copyOfRange(13, bytes.size)))
            require(json.keys().asSequence().toSet() == setOf("cookie", "expiresAt"))
            SessionCredential(json.string("cookie"), json.integer("expiresAt"), true).also {
                SessionCookies.checked(it)
            }
        } catch (_: Exception) {
            try { clear() } catch (_: Exception) { /* Failed ciphertext never leaves this method. */ }
            null
        }
    }

    @Synchronized override fun write(value: SessionCredential?) {
        if (value == null || !value.persistent) { clear(); return }
        try {
            SessionCookies.checked(value)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.ENCRYPT_MODE, key(true))
                updateAAD(aad)
            }
            require(cipher.iv.size == 12)
            val json = JSONObject().put("cookie", value.cookie).put("expiresAt", value.expiresAt).toString()
            val bytes = byteArrayOf(1) + cipher.iv + cipher.doFinal(json.toByteArray(Charsets.UTF_8))
            require(bytes.size <= 8192)
            val stream = file.startWrite()
            try { stream.write(bytes); file.finishWrite(stream) }
            catch (error: Exception) { file.failWrite(stream); throw error }
        } catch (error: Exception) {
            try { clear() } catch (_: Exception) { /* Preserve the original storage failure. */ }
            throw error
        }
    }
}
