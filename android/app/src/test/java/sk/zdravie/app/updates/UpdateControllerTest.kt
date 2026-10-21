package sk.zdravie.app.updates

import java.io.File
import java.io.IOException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import sk.zdravie.app.updates.core.UpdateFailure
import sk.zdravie.app.updates.core.UpdateRelease
import sk.zdravie.app.updates.core.UpdateSource

@OptIn(ExperimentalCoroutinesApi::class)
class UpdateControllerTest {
    @get:Rule val files = TemporaryFolder()
    private val release = UpdateRelease(2, "0.1.1", "https://example.invalid/synthetic.apk", "0".repeat(64), 3, "Synthetic release")
    private class MemoryPreferences : UpdatePreferences {
        override var lastCheckedAt = 0L
        override var deferredVersion = 0L
        override var deferredUntil = 0L
    }
    private inner class Source : UpdateSource {
        var checks = 0
        var downloads = 0
        var latest: UpdateRelease? = release
        var failure: Exception? = null
        var duringDownload: (() -> Unit)? = null
        override fun latest(installedVersionCode: Long): UpdateRelease? {
            checks++
            failure?.let { throw it }
            return latest
        }
        override fun download(release: UpdateRelease, destination: File, onProgress: (Long, Long) -> Unit): File {
            downloads++
            failure?.let { throw it }
            onProgress(1, 3)
            duringDownload?.invoke()
            destination.writeBytes(byteArrayOf(1, 2, 3))
            onProgress(3, 3)
            return destination
        }
    }

    @Test fun `foreground checks throttle for six hours and manual bypasses`() = runTest {
        val prefs = MemoryPreferences(); val source = Source(); var time = 1_000L
        val updater = UpdateController(source, 1, prefs, files.newFolder(), { _, _ -> }, this, StandardTestDispatcher(testScheduler), { time })
        updater.check(); advanceUntilIdle()
        assertEquals(UpdateStage.OFFER, updater.state.value.stage)
        updater.check(); advanceUntilIdle(); assertEquals(1, source.checks)
        updater.check(manual = true); advanceUntilIdle(); assertEquals(2, source.checks)
        time += UpdateController.CHECK_INTERVAL
        updater.check(); advanceUntilIdle(); assertEquals(3, source.checks)
    }

    @Test fun `deferred release stays hidden for a day but manual check reopens it`() = runTest {
        val prefs = MemoryPreferences(); val source = Source(); var time = 1_000L
        val updater = UpdateController(source, 1, prefs, files.newFolder(), { _, _ -> }, this, StandardTestDispatcher(testScheduler), { time })
        updater.check(); advanceUntilIdle(); updater.defer()
        assertFalse(updater.state.value.visible)
        assertEquals(2L, prefs.deferredVersion)
        time += UpdateController.CHECK_INTERVAL
        updater.check(); advanceUntilIdle(); assertFalse(updater.state.value.visible)
        updater.check(true); advanceUntilIdle(); assertTrue(updater.state.value.visible)
        updater.defer(); time += UpdateController.DEFER_INTERVAL
        updater.check(); advanceUntilIdle(); assertTrue(updater.state.value.visible)
    }

    @Test fun `a newer release is not hidden by a previous deferral`() = runTest {
        val prefs = MemoryPreferences(); val source = Source(); var time = 1_000L
        val updater = UpdateController(source, 1, prefs, files.newFolder(), { _, _ -> }, this, StandardTestDispatcher(testScheduler), { time })
        updater.check(); advanceUntilIdle(); updater.defer()
        source.latest = release.copy(versionCode = 3)
        time += UpdateController.CHECK_INTERVAL
        updater.check(); advanceUntilIdle()
        assertTrue(updater.state.value.visible)
        assertEquals(3L, updater.state.value.release?.versionCode)
    }

    @Test fun `failed background check is silent throttled and sanitized`() = runTest {
        val source = Source().apply { failure = IOException("secret account cookie must not reach UI") }
        val updater = UpdateController(source, 1, MemoryPreferences(), files.newFolder(), { _, _ -> }, this, StandardTestDispatcher(testScheduler), { 1_000L })
        updater.check(); advanceUntilIdle()
        assertEquals(UpdateStage.ERROR, updater.state.value.stage)
        assertFalse(updater.state.value.visible)
        assertFalse(updater.state.value.error!!.contains("secret"))
        updater.check(); advanceUntilIdle(); assertEquals(1, source.checks)
        updater.check(true); advanceUntilIdle(); assertTrue(updater.state.value.visible)
    }

    @Test fun `manual up to date result is dismissible and future clock does not lock checks`() = runTest {
        val source = Source().apply { latest = null }
        val prefs = MemoryPreferences().apply { lastCheckedAt = 99_000L }
        val updater = UpdateController(source, 1, prefs, files.newFolder(), { _, _ -> }, this, StandardTestDispatcher(testScheduler), { 1_000L })
        updater.check(); advanceUntilIdle(); assertEquals(1, source.checks)
        assertFalse(updater.state.value.visible)
        updater.check(true); advanceUntilIdle(); assertEquals(UpdateStage.CURRENT, updater.state.value.stage)
        assertTrue(updater.state.value.visible); updater.dismissError(); assertFalse(updater.state.value.visible)
    }

    @Test fun `download becomes installable only after independent archive validation`() = runTest {
        val source = Source(); var validations = 0
        val updater = UpdateController(source, 1, MemoryPreferences(), files.newFolder(), { file, expected ->
            assertEquals(release, expected); assertEquals(3L, file.length()); validations++
        }, this, StandardTestDispatcher(testScheduler), { 1_000L })
        updater.check(); advanceUntilIdle(); updater.download()
        assertNull(updater.installCandidate()); advanceUntilIdle()
        assertEquals(1, validations); assertEquals(UpdateStage.READY, updater.state.value.stage)
        assertNotNull(updater.installCandidate()); assertEquals(3L, updater.state.value.downloadedBytes)
        updater.awaitingPermission(); assertEquals(UpdateStage.PERMISSION, updater.state.value.stage)
        updater.permissionReturned(false); assertEquals(UpdateStage.READY, updater.state.value.stage)
        assertNotNull(updater.state.value.error)
        updater.installerOpened(); assertFalse(updater.state.value.visible)
        updater.check(true); advanceUntilIdle(); assertTrue(updater.state.value.visible); assertEquals(2, source.checks)
    }

    @Test fun `invalid archive is deleted and retry can recover without an install candidate`() = runTest {
        val source = Source(); val directory = files.newFolder(); var reject = true
        val updater = UpdateController(source, 1, MemoryPreferences(), directory, { _, _ -> if (reject) error("private validation detail") }, this, StandardTestDispatcher(testScheduler), { 1_000L })
        updater.check(); advanceUntilIdle(); updater.download(); advanceUntilIdle()
        assertEquals(UpdateStage.ERROR, updater.state.value.stage); assertNull(updater.installCandidate())
        assertTrue(directory.listFiles()!!.isEmpty()); assertFalse(updater.state.value.error!!.contains("private"))
        reject = false; updater.download(); advanceUntilIdle()
        assertEquals(UpdateStage.READY, updater.state.value.stage)
    }

    @Test fun `cancelled download cannot restore ready state from stale progress or completion`() = runTest {
        val source = Source(); val directory = files.newFolder()
        val updater = UpdateController(source, 1, MemoryPreferences(), directory, { _, _ -> }, this, StandardTestDispatcher(testScheduler), { 1_000L })
        source.duringDownload = { updater.cancelDownload() }
        updater.check(); advanceUntilIdle(); updater.download(); advanceUntilIdle()
        assertEquals(UpdateStage.OFFER, updater.state.value.stage)
        assertEquals(0L, updater.state.value.downloadedBytes); assertNull(updater.installCandidate())
        assertTrue(directory.listFiles()!!.isEmpty())
    }

    @Test fun `checked transfer failure is readable and installer failure requires fresh download`() = runTest {
        val source = Source()
        val updater = UpdateController(source, 1, MemoryPreferences(), files.newFolder(), { _, _ -> }, this, StandardTestDispatcher(testScheduler), { 1_000L })
        updater.check(); advanceUntilIdle()
        source.failure = UpdateFailure("Spojenie s GitHubom nie je dostupné.")
        updater.download(); advanceUntilIdle(); assertEquals(source.failure!!.message, updater.state.value.error)
        source.failure = null; updater.download(); advanceUntilIdle(); updater.installFailed()
        assertNull(updater.installCandidate()); assertEquals(UpdateStage.ERROR, updater.state.value.stage)
    }

    @Test fun `downloaded update can be deferred and offered after a day without redownloading`() = runTest {
        val source = Source(); var time = 1_000L
        val updater = UpdateController(source, 1, MemoryPreferences(), files.newFolder(), { _, _ -> }, this, StandardTestDispatcher(testScheduler), { time })
        updater.check(); advanceUntilIdle(); updater.download(); advanceUntilIdle(); updater.defer()
        updater.check(); assertFalse(updater.state.value.visible)
        time += UpdateController.DEFER_INTERVAL
        updater.check(); advanceUntilIdle(); assertEquals(UpdateStage.READY, updater.state.value.stage)
        assertTrue(updater.state.value.visible); assertEquals(1, source.downloads)
    }

    @Test fun `manual checking during an in flight foreground check shares that request`() = runTest {
        val source = Source()
        val updater = UpdateController(source, 1, MemoryPreferences(), files.newFolder(), { _, _ -> }, this, StandardTestDispatcher(testScheduler), { 1_000L })
        updater.check(); updater.check(true); advanceUntilIdle()
        assertEquals(1, source.checks); assertTrue(updater.state.value.visible)
    }

    @Test fun `manual and due foreground discover v3 after downloading and deferring v2`() = runTest {
        for (manual in listOf(true, false)) {
            val source = Source(); var time = 1_000L
            val updater = UpdateController(source, 1, MemoryPreferences(), files.newFolder(), { _, _ -> }, this, StandardTestDispatcher(testScheduler), { time })
            updater.check(); advanceUntilIdle(); updater.download(); advanceUntilIdle(); updater.defer()
            val olderFile = updater.installCandidate()!!.first
            source.latest = release.copy(versionCode = 3, versionName = "0.1.2")
            if (!manual) time += UpdateController.CHECK_INTERVAL
            updater.check(manual); advanceUntilIdle()
            assertEquals(2, source.checks); assertEquals(UpdateStage.OFFER, updater.state.value.stage)
            assertTrue(updater.state.value.visible); assertEquals(3L, updater.state.value.release!!.versionCode)
            assertNull(updater.installCandidate()); assertFalse(olderFile.exists())
        }
    }

    @Test fun `unchanged metadata keeps the verified file after manual refresh`() = runTest {
        val source = Source()
        val updater = UpdateController(source, 1, MemoryPreferences(), files.newFolder(), { _, _ -> }, this, StandardTestDispatcher(testScheduler), { 1_000L })
        updater.check(); advanceUntilIdle(); updater.download(); advanceUntilIdle(); updater.defer()
        val candidate = updater.installCandidate()
        updater.check(true); advanceUntilIdle()
        assertEquals(2, source.checks); assertEquals(1, source.downloads)
        assertEquals(candidate, updater.installCandidate()); assertTrue(candidate!!.first.exists())
        assertEquals(UpdateStage.READY, updater.state.value.stage); assertTrue(updater.state.value.visible)
    }

    @Test fun `failed refresh retains verified candidate and stays silent in background`() = runTest {
        val source = Source(); var time = 1_000L
        val updater = UpdateController(source, 1, MemoryPreferences(), files.newFolder(), { _, _ -> }, this, StandardTestDispatcher(testScheduler), { time })
        updater.check(); advanceUntilIdle(); updater.download(); advanceUntilIdle(); updater.defer()
        val candidate = updater.installCandidate()
        source.failure = IOException("private network detail")
        time += UpdateController.CHECK_INTERVAL
        updater.check(); advanceUntilIdle()
        assertEquals(UpdateStage.READY, updater.state.value.stage); assertFalse(updater.state.value.visible)
        assertNull(updater.state.value.error); assertEquals(candidate, updater.installCandidate())
        updater.check(true); advanceUntilIdle()
        assertEquals(UpdateStage.READY, updater.state.value.stage); assertTrue(updater.state.value.visible)
        assertNotNull(updater.state.value.error); assertFalse(updater.state.value.error!!.contains("private"))
        assertEquals(candidate, updater.installCandidate()); assertTrue(candidate!!.first.exists())
    }

    @Test fun `changed artifact metadata for same version invalidates cached file`() = runTest {
        val source = Source()
        val updater = UpdateController(source, 1, MemoryPreferences(), files.newFolder(), { _, _ -> }, this, StandardTestDispatcher(testScheduler), { 1_000L })
        updater.check(); advanceUntilIdle(); updater.download(); advanceUntilIdle()
        val olderFile = updater.installCandidate()!!.first
        source.latest = release.copy(sha256 = "1".repeat(64))
        updater.check(true); advanceUntilIdle()
        assertNull(updater.installCandidate()); assertFalse(olderFile.exists())
        assertEquals(UpdateStage.OFFER, updater.state.value.stage)
    }

    @Test fun `removed release cannot remain installable from stale cache`() = runTest {
        val source = Source()
        val updater = UpdateController(source, 1, MemoryPreferences(), files.newFolder(), { _, _ -> }, this, StandardTestDispatcher(testScheduler), { 1_000L })
        updater.check(); advanceUntilIdle(); updater.download(); advanceUntilIdle()
        val olderFile = updater.installCandidate()!!.first
        source.latest = null; updater.check(true); advanceUntilIdle()
        assertNull(updater.installCandidate()); assertFalse(olderFile.exists())
        assertEquals(UpdateStage.CURRENT, updater.state.value.stage)
    }
}
