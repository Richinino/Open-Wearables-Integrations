package sk.zdravie.app.updates.core

import okhttp3.Authenticator
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import sk.zdravie.app.BuildConfig
import sk.zdravie.app.data.StrictJson
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import java.util.concurrent.TimeUnit

/**
 * Reads metadata for immutable APK releases from the configured public GitHub repository.
 * The injected client exists for TLS fixture tests; no cookies, interceptors, cache, or
 * authenticators from it are retained. The production trust manager/hostname checks remain
 * OkHttp defaults, and HTTP/foreign repository redirects are never accepted.
 */
class GithubUpdateSource(client: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(20, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
    .callTimeout(5, TimeUnit.MINUTES).build(), repository: String = BuildConfig.UPDATE_REPOSITORY) : UpdateSource {
    private val repositoryPath: String
    private val feedUrl: String

    init {
        require(repository.matches(Regex("[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}")))
        require(repository.substringAfter('/') !in setOf(".", ".."))
        repositoryPath = "/$repository"
        feedUrl = "https://github.com$repositoryPath/releases/latest/download/android-update.json"
    }

    private val transport = client.newBuilder().apply {
        followRedirects(false)
        followSslRedirects(false)
        cookieJar(CookieJar.NO_COOKIES)
        cache(null)
        authenticator(Authenticator.NONE)
        proxyAuthenticator(Authenticator.NONE)
        interceptors().clear()
        networkInterceptors().clear()
    }.build()

    override fun latest(installedVersionCode: Long): UpdateRelease? = safe {
        require(installedVersionCode >= 0)
        fetch(feedUrl.toHttpUrl(), Resource.MANIFEST) { response, redirectedTag ->
            if (response.code == 404) return@fetch null
            ensureSuccess(response)
            val body = response.body ?: invalid()
            if (body.contentLength() > MAX_MANIFEST_BYTES) invalid()
            val bytes = ByteArrayOutputStream().use { output ->
                body.byteStream().use { input ->
                    val buffer = ByteArray(4096)
                    var size = 0L
                    while (true) {
                        interrupted()
                        val count = input.read(buffer)
                        if (count == -1) break
                        size += count
                        if (size > MAX_MANIFEST_BYTES) invalid()
                        output.write(buffer, 0, count)
                    }
                }
                output.toByteArray()
            }
            val release = parse(StrictJson.objectValue(bytes))
            if (redirectedTag != null && redirectedTag != release.versionName) invalid()
            release.takeIf { it.versionCode > installedVersionCode }
        }
    }

    override fun download(release: UpdateRelease, destination: File,
        onProgress: (Long, Long) -> Unit): File = safe {
        // A caller cannot bypass metadata validation by constructing a release itself.
        validate(release)
        interrupted()
        val parent = destination.absoluteFile.parentFile?.canonicalFile ?: invalid()
        if ((!parent.isDirectory && !parent.mkdirs()) || !parent.isDirectory) {
            throw UpdateFailure("Aktualizáciu sa nepodarilo uložiť. Skontroluj voľné miesto.")
        }
        val target = File(parent, destination.name)
        if (target.isDirectory) invalid()
        val partial = File.createTempFile("zdravie-update-", ".part", parent)
        try {
            fetch(release.apkUrl.toHttpUrl(), Resource.APK) { response, _ ->
                ensureSuccess(response)
                val body = response.body ?: invalid()
                if (body.contentLength() != -1L && body.contentLength() != release.sizeBytes) invalid()
                val digest = MessageDigest.getInstance("SHA-256")
                var received = 0L
                onProgress(0L, release.sizeBytes)
                partial.outputStream().use { output ->
                    body.byteStream().use { input ->
                        val buffer = ByteArray(32 * 1024)
                        while (true) {
                            interrupted()
                            val count = input.read(buffer)
                            if (count == -1) break
                            received += count
                            if (received > release.sizeBytes || received > MAX_APK_BYTES) invalid()
                            output.write(buffer, 0, count)
                            digest.update(buffer, 0, count)
                            onProgress(received, release.sizeBytes)
                        }
                    }
                    output.fd.sync()
                }
                if (received != release.sizeBytes || !MessageDigest.isEqual(
                        digest.digest(), release.sha256.chunked(2).map { it.toInt(16).toByte() }.toByteArray())) {
                    throw UpdateFailure("Stiahnutá aktualizácia neprešla kontrolou. Skús ju stiahnuť znova.")
                }
                interrupted()
            }
            // Same-directory atomic replacement means failure never exposes a partial APK.
            interrupted()
            Files.move(partial.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING)
            target
        } finally {
            partial.delete()
        }
    }

    private enum class Resource { MANIFEST, APK }

    private fun <T> fetch(initial: HttpUrl, resource: Resource,
        read: (Response, String?) -> T): T {
        var url = initial
        var redirectedTag: String? = null
        var assetsOnly = false
        for (redirects in 0..MAX_REDIRECTS) {
            interrupted()
            val request = Request.Builder().url(url).get()
                .header("Accept", if (resource == Resource.MANIFEST) "application/json" else "application/vnd.android.package-archive")
                .header("Accept-Encoding", "identity").header("Cache-Control", "no-store").build()
            transport.newCall(request).execute().use { response ->
                if (response.code !in REDIRECTS) return read(response, redirectedTag)
                if (redirects == MAX_REDIRECTS) invalid()
                val locations = response.headers.values("Location")
                if (locations.size != 1 || locations.single().length > 8192) invalid()
                val next = url.resolve(locations.single()) ?: invalid()
                if (!next.isHttps || next.username.isNotEmpty() || next.password.isNotEmpty() ||
                    next.port != 443 || next.fragment != null) invalid()
                when (next.host) {
                    ASSET_HOST -> assetsOnly = true
                    "github.com" -> {
                        if (assetsOnly || next.query != null) invalid()
                        if (resource == Resource.APK) {
                            if (next.toString() != initial.toString()) invalid()
                        } else {
                            if (next.toString() != feedUrl) {
                                val path = next.encodedPath
                                val prefix = "$repositoryPath/releases/download/android-v"
                                if (!path.startsWith(prefix) || !path.endsWith("/android-update.json")) invalid()
                                val version = path.removePrefix(prefix).removeSuffix("/android-update.json")
                                if (!validVersion(version)) invalid()
                                if (next.toString() != "https://github.com$prefix$version/android-update.json") invalid()
                                if (redirectedTag != null && redirectedTag != version) invalid()
                                redirectedTag = version
                            }
                        }
                    }
                    else -> invalid()
                }
                url = next
            }
        }
        invalid()
    }

    private fun parse(json: JSONObject): UpdateRelease {
        if (json.keys().asSequence().toSet() != FIELDS || integer(json, "schemaVersion") != 1L ||
            string(json, "packageName") != PACKAGE_NAME) invalid()
        return UpdateRelease(integer(json, "versionCode"), string(json, "versionName"),
            string(json, "apkUrl"), string(json, "sha256"), integer(json, "sizeBytes"),
            string(json, "releaseNotes")).also(::validate)
    }

    private fun validate(release: UpdateRelease) {
        if (release.versionCode !in 1..Int.MAX_VALUE.toLong() || !validVersion(release.versionName) ||
            release.sizeBytes !in 1..MAX_APK_BYTES || !release.sha256.matches(Regex("[0-9a-f]{64}")) ||
            release.releaseNotes.length > 4000 || release.releaseNotes.any {
                (it < ' ' && it != '\n' && it != '\r' && it != '\t') || it == '\u007f'
            }) invalid()
        val expected = "https://github.com$repositoryPath/releases/download/android-v${release.versionName}/zdravie-${release.versionName}.apk"
        if (release.apkUrl != expected) invalid()
    }

    private fun string(json: JSONObject, field: String): String = json.get(field) as? String ?: invalid()
    private fun integer(json: JSONObject, field: String): Long = when (val value = json.get(field)) {
        is Int -> value.toLong()
        is Long -> value
        else -> invalid()
    }
    private fun validVersion(value: String) = value.length <= 64 && VERSION.matches(value)
    private fun ensureSuccess(response: Response) {
        when (response.code) {
            200 -> return
            429 -> throw UpdateFailure("Kontrola aktualizácií je dočasne obmedzená. Skús to neskôr.")
            in 500..599 -> throw UpdateFailure("Aktualizácie sú dočasne nedostupné. Skús to neskôr.")
            else -> invalid()
        }
    }
    private fun interrupted() {
        if (Thread.currentThread().isInterrupted) throw CancellationException("Update cancelled")
    }
    private inline fun <T> safe(action: () -> T): T = try { action() }
    catch (failure: UpdateFailure) { throw failure }
    catch (cancelled: CancellationException) { throw cancelled }
    catch (_: IOException) {
        interrupted()
        throw UpdateFailure("Aktualizáciu sa nepodarilo stiahnuť. Skontroluj pripojenie a skús znova.")
    }
    catch (_: Exception) {
        interrupted()
        invalid()
    }
    private fun invalid(): Nothing = throw UpdateFailure("Aktualizácia neposlala platné a bezpečné údaje. Skús to neskôr.")

    private companion object {
        const val PACKAGE_NAME = "sk.zdravie.app"
        const val ASSET_HOST = "release-assets.githubusercontent.com"
        const val MAX_MANIFEST_BYTES = 32L * 1024
        const val MAX_APK_BYTES = 100L * 1024 * 1024
        const val MAX_REDIRECTS = 5
        val REDIRECTS = setOf(301, 302, 303, 307, 308)
        val VERSION = Regex("(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?")
        val FIELDS = setOf("schemaVersion", "packageName", "versionCode", "versionName", "apkUrl", "sha256", "sizeBytes", "releaseNotes")
    }
}
