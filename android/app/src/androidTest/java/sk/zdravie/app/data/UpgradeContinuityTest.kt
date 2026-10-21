package sk.zdravie.app.data

import android.os.Build
import android.os.Process
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.Base64
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Manual two-stage upgrade proof. These cases skip ordinary connected test runs.
 * Seed against the old app, install the new APK with `adb install -r`, then verify.
 * Only a synthetic locally encoded cookie is used; no Activity or network is started.
 * Deliberately references only the credential-store API already present in v0.1.0.
 */
@RunWith(AndroidJUnit4::class)
class UpgradeContinuityTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val target get() = instrumentation.targetContext
    private val arguments get() = InstrumentationRegistry.getArguments()
    private val preferences get() = target.getSharedPreferences("synthetic_upgrade_continuity", 0)
    private val marker get() = File(target.filesDir, "synthetic-upgrade-continuity.txt")

    @Test fun seedOldInstallation() {
        assumeTrue("Manual seed requires upgradeStage=seed", arguments.getString("upgradeStage") == "seed")
        assertEquals("sk.zdravie.app", target.packageName)
        assertEquals(arguments.getString("expectedSeedVersion", "1").toLong(), installedVersion())
        val expiry = System.currentTimeMillis() + 60L * 60 * 1000
        val claims = JSONObject().put("a", "upgrade_fixture").put("r", "user").put("v", 0)
            .put("x", JSONObject.NULL).put("p", true).put("e", expiry)
        val encoder = Base64.getUrlEncoder().withoutPadding()
        val cookie = "owi_session=" + encoder.encodeToString(claims.toString().toByteArray(Charsets.UTF_8)) +
            "." + encoder.encodeToString(ByteArray(32) { 7 })
        val value = SessionCredential(cookie, expiry, true)
        val store = KeystoreCredentialStore(target)
        store.write(value)
        assertEquals(value, store.read())
        marker.writeText(MARKER, Charsets.UTF_8)
        assertTrue(preferences.edit().putString("cookie", cookie).putLong("expiry", expiry)
            .putBoolean("persistent", true).putInt("uid", Process.myUid()).putString("marker", MARKER).commit())
        assertTrue(File(target.noBackupFilesDir, "session.enc").isFile)
    }

    @Test fun verifyNewInstallationPreservedEncryptedSessionAndPrivateData() {
        assumeTrue("Manual verification requires upgradeStage=verify", arguments.getString("upgradeStage") == "verify")
        assertEquals("sk.zdravie.app", target.packageName)
        assertEquals(arguments.getString("expectedVersion", "2").toLong(), installedVersion())
        listOf("cookie", "expiry", "persistent", "uid", "marker").forEach { assertTrue("Missing seeded preference: $it", preferences.contains(it)) }
        assertEquals(preferences.getInt("uid", -1), Process.myUid())
        assertEquals(MARKER, preferences.getString("marker", null))
        assertEquals(MARKER, marker.readText(Charsets.UTF_8))
        val expected = SessionCredential(preferences.getString("cookie", null)!!, preferences.getLong("expiry", 0), preferences.getBoolean("persistent", false))
        assertTrue(expected.expiresAt > System.currentTimeMillis())
        assertTrue(expected.persistent)
        val store = KeystoreCredentialStore(target)
        val restored = store.read()
        assertNotNull("Old encrypted session and Android Keystore key must survive the upgrade", restored)
        assertEquals(expected.cookie, restored!!.cookie)
        assertEquals(expected.expiresAt, restored.expiresAt)
        assertEquals(expected.persistent, restored.persistent)

        // Clear only after every preservation assertion; subsequent launches must not try fake auth.
        store.write(null)
        assertNull(store.read())
        assertTrue(preferences.edit().clear().commit())
        assertTrue(marker.delete())
    }

    @Suppress("DEPRECATION")
    private fun installedVersion(): Long {
        val info = target.packageManager.getPackageInfo(target.packageName, 0)
        return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    }

    private companion object { const val MARKER = "Synthetic upgrade continuity marker v1" }
}
