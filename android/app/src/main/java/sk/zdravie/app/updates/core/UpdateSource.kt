package sk.zdravie.app.updates.core

import java.io.File

data class UpdateRelease(
    val versionCode: Long,
    val versionName: String,
    val apkUrl: String,
    val sha256: String,
    val sizeBytes: Long,
    val releaseNotes: String,
)

/** Public update metadata never shares credentials or transport with the health API. */
interface UpdateSource {
    fun latest(installedVersionCode: Long): UpdateRelease?
    fun download(
        release: UpdateRelease,
        destination: File,
        onProgress: (Long, Long) -> Unit = { _, _ -> },
    ): File
}

/** Deliberately excludes upstream URLs, response bodies, and exception details. */
class UpdateFailure(override val message: String) : Exception(message)
