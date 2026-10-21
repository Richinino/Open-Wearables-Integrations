package sk.zdravie.app.updates

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.security.MessageDigest
import sk.zdravie.app.updates.core.UpdateRelease

/** Android independently checks APK identity in addition to the release feed's transport hash. */
class AndroidUpdateInstaller(private val context: Context) : UpdateArtifactValidator {
    @Suppress("DEPRECATION") // GET_SIGNATURES is required on the supported Android 8 devices.
    override fun validate(file: File, release: UpdateRelease) {
        val updateDirectory = File(context.cacheDir, "updates").canonicalFile
        require(file.canonicalFile.parentFile == updateDirectory && file.isFile)
        require(file.length() == release.sizeBytes)
        val hash = file.inputStream().use { input ->
            val digest = MessageDigest.getInstance("SHA-256")
            val buffer = ByteArray(64 * 1024)
            while (true) {
                if (Thread.currentThread().isInterrupted) throw InterruptedException()
                val read = input.read(buffer)
                if (read == -1) break
                digest.update(buffer, 0, read)
            }
            digest.digest().hex()
        }
        require(hash == release.sha256)
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val installed = context.packageManager.getPackageInfo(context.packageName, flags)
        val archive = context.packageManager.getPackageArchiveInfo(file.absolutePath, flags) ?: error("Invalid APK")
        validateApkIdentity(
            context.packageName, version(installed), certificates(installed),
            archive.packageName, version(archive), certificates(archive), release.versionCode,
        )
        require(archive.versionName == release.versionName)
    }

    fun permitted(): Boolean = context.packageManager.canRequestPackageInstalls()

    fun requestPermission(activity: Activity) {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
    }

    fun launch(activity: Activity, file: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            clipData = android.content.ClipData.newRawUri("Zdravie update", uri)
        }
        activity.startActivity(intent)
    }

    @Suppress("DEPRECATION")
    private fun version(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun certificates(info: PackageInfo): Set<String> {
        // Rotation deliberately requires a future explicit migration: exact current signers only.
        val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        return signatures?.map { MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).hex() }?.toSet().orEmpty()
    }
}

internal fun validateApkIdentity(
    installedPackage: String, installedVersion: Long, installedSigners: Set<String>,
    archivePackage: String, archiveVersion: Long, archiveSigners: Set<String>, expectedVersion: Long,
) {
    require(installedPackage == "sk.zdravie.app" && archivePackage == installedPackage)
    require(expectedVersion > installedVersion && archiveVersion == expectedVersion)
    require(installedSigners.isNotEmpty() && archiveSigners == installedSigners)
}

private fun ByteArray.hex(): String = joinToString("") { "%02x".format(it.toInt() and 255) }
