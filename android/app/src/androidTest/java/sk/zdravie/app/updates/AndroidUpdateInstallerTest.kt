package sk.zdravie.app.updates

import androidx.core.content.FileProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import sk.zdravie.app.BuildConfig
import sk.zdravie.app.updates.core.UpdateRelease

@RunWith(AndroidJUnit4::class)
class AndroidUpdateInstallerTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun metadata(file: File) = UpdateRelease(
        BuildConfig.VERSION_CODE.toLong() + 1, "synthetic-next", "https://example.invalid/synthetic.apk",
        MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it.toInt() and 255) }, file.length(), "",
    )

    @Test fun actualPackageManagerRejectsCurrentApkDisguisedAsNewVersion() {
        val directory = File(context.cacheDir, "updates").apply { mkdirs() }
        val copy = File(directory, "test-current.apk")
        try {
            File(context.applicationInfo.sourceDir).copyTo(copy, overwrite = true)
            assertThrows(IllegalArgumentException::class.java) { AndroidUpdateInstaller(context).validate(copy, metadata(copy)) }
        } finally { copy.delete() }
    }

    @Test fun privateFileProviderOnlyExposesUpdatesDirectory() {
        val directory = File(context.cacheDir, "updates").apply { mkdirs() }
        val allowed = File(directory, "test-package.apk").apply { writeText("synthetic") }
        val outside = File(context.cacheDir, "test-private.txt").apply { writeText("synthetic private") }
        try {
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", allowed)
            assertEquals("content", uri.scheme)
            assertThrows(IllegalArgumentException::class.java) { FileProvider.getUriForFile(context, "${context.packageName}.updates", outside) }
            assertThrows(IllegalArgumentException::class.java) { AndroidUpdateInstaller(context).validate(outside, metadata(outside)) }
        } finally { allowed.delete(); outside.delete() }
    }
}
