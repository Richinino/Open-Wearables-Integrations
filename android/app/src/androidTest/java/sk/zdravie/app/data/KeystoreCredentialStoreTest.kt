package sk.zdravie.app.data

import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.KeyStore
import java.util.Base64
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class KeystoreCredentialStoreTest {
    private lateinit var directory: File
    private lateinit var alias: String
    private lateinit var store: KeystoreCredentialStore

    @Before fun setUp() {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val id = UUID.randomUUID().toString()
        directory = File(target.cacheDir, "synthetic-credential-$id").apply { mkdirs() }
        val isolated = object : ContextWrapper(target) {
            override fun getNoBackupFilesDir(): File = directory
        }
        alias = "synthetic_zdravie_session_$id"
        store = KeystoreCredentialStore(isolated, alias)
    }

    @After fun tearDown() {
        store.write(null)
        File(directory, "session.enc").delete()
        directory.delete()
    }

    private fun credential(persistent: Boolean = true): SessionCredential {
        val expiry = System.currentTimeMillis() + 60 * 60 * 1000
        val claims = JSONObject().put("a", "synthetic_account").put("r", "user").put("v", 0)
            .put("x", JSONObject.NULL).put("p", persistent).put("e", expiry)
        val encoder = Base64.getUrlEncoder().withoutPadding()
        val token = encoder.encodeToString(claims.toString().toByteArray()) + "." + encoder.encodeToString(ByteArray(32) { 7 })
        return SessionCredential("owi_session=$token", expiry, persistent)
    }

    private fun hasKey(): Boolean = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.containsAlias(alias)

    @Test fun rememberedCookieRoundTripsEncryptedAndClearDestroysTheKey() {
        val value = credential()
        store.write(value)
        assertEquals(value, store.read())
        val file = File(directory, "session.enc")
        val ciphertext = file.readBytes()
        assertFalse(String(ciphertext, Charsets.ISO_8859_1).contains(value.cookie))
        assertTrue(hasKey())
        store.write(null)
        assertNull(store.read())
        assertFalse(file.exists())
        assertFalse(hasKey())
        // A recovered stale encrypted file must not resurrect the cleared session.
        file.writeBytes(ciphertext)
        assertNull(store.read())
        assertFalse(file.exists())
    }

    @Test fun tamperingFailsClosedAndRemovesBothCiphertextAndKey() {
        store.write(credential())
        val file = File(directory, "session.enc")
        val bytes = file.readBytes()
        bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
        file.writeBytes(bytes)
        assertNull(store.read())
        assertFalse(file.exists())
        assertFalse(hasKey())
    }

    @Test fun ephemeralAndInvalidCredentialsCannotRemainOnDisk() {
        store.write(credential())
        store.write(credential(persistent = false))
        assertNull(store.read())
        assertFalse(hasKey())
        store.write(credential())
        assertThrows(Exception::class.java) { store.write(credential().copy(cookie = "owi_session=invalid; other=synthetic")) }
        assertNull(store.read())
        assertFalse(hasKey())
    }
}
