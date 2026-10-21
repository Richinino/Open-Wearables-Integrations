package sk.zdravie.app.updates.core

import okhttp3.Authenticator
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import okio.Buffer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.File
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.Socket
import java.net.SocketAddress
import java.nio.file.Files
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import java.util.concurrent.TimeUnit
import javax.net.SocketFactory

class GithubUpdateSourceTest {
    private lateinit var server: MockWebServer
    private lateinit var client: OkHttpClient
    private lateinit var source: GithubUpdateSource
    private lateinit var directory: File
    private val apk = ByteArray(96 * 1024) { (it % 251).toByte() }
    private val repository = "Richinino/Open-Wearables-Integrations"
    private val feed = "https://github.com/$repository/releases/latest/download/android-update.json"
    private val apkUrl = "https://github.com/$repository/releases/download/android-v0.1.1/zdravie-0.1.1.apk"

    @Before fun setUp() {
        val certificate = HeldCertificate.Builder().commonName("TLS update fixture")
            .addSubjectAlternativeName("github.com")
            .addSubjectAlternativeName("release-assets.githubusercontent.com").build()
        val serverCertificates = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val trusted = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        server = MockWebServer().apply { useHttps(serverCertificates.sslSocketFactory(), false); start() }
        // Keep real HTTPS hostnames/ports and normal hostname verification. Only the underlying
        // TCP connection is routed to the test TLS listener; production URL policy is unchanged.
        client = OkHttpClient.Builder().sslSocketFactory(trusted.sslSocketFactory(), trusted.trustManager)
            .dns(object : Dns {
                override fun lookup(hostname: String) = listOf(InetAddress.getByName("127.0.0.1"))
            })
            .socketFactory(FixtureSocketFactory { server.port }).proxy(Proxy.NO_PROXY)
            .callTimeout(3, TimeUnit.SECONDS).build()
        source = GithubUpdateSource(client, repository)
        directory = Files.createTempDirectory("zdravie-updater-test-").toFile()
    }

    @After fun tearDown() {
        Thread.interrupted()
        server.shutdown()
        directory.deleteRecursively()
    }

    private fun manifest(): JSONObject = JSONObject().put("schemaVersion", 1)
        .put("packageName", "sk.zdravie.app").put("versionCode", 2).put("versionName", "0.1.1")
        .put("apkUrl", apkUrl).put("sha256", hash(apk)).put("sizeBytes", apk.size)
        .put("releaseNotes", "Nové grafy a opravy.\nÚčet zostáva prihlásený.")
    private fun response(value: JSONObject = manifest()) = MockResponse()
        .setHeader("Content-Type", "application/octet-stream").setBody(value.toString())
    private fun release() = UpdateRelease(2, "0.1.1", apkUrl, hash(apk), apk.size.toLong(), "Nové grafy")
    private fun failure(action: () -> Unit): UpdateFailure = assertThrows(UpdateFailure::class.java, action)
    private fun assertNoPartials() = assertTrue(directory.listFiles().orEmpty().none { it.extension == "part" })
    private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    @Test fun newestValidReleaseIsReturnedUsingExactPublicFeed() {
        server.enqueue(response())
        val latest = source.latest(1)!!
        assertEquals(2, latest.versionCode)
        assertEquals("0.1.1", latest.versionName)
        assertEquals(apkUrl, latest.apkUrl)
        assertEquals(hash(apk), latest.sha256)
        val request = server.takeRequest()
        assertEquals("/Richinino/Open-Wearables-Integrations/releases/latest/download/android-update.json", request.path)
        assertEquals("github.com", request.getHeader(":authority") ?: request.getHeader("Host"))
        assertEquals("no-store", request.getHeader("Cache-Control"))
        assertNull(request.getHeader("Cookie"))
        assertNull(request.getHeader("Authorization"))
    }

    @Test fun equalAndOlderReleasesAreNeverOffered() {
        for (installed in listOf(2L, 3L, Int.MAX_VALUE.toLong())) {
            server.enqueue(response())
            assertNull(source.latest(installed))
        }
    }

    @Test fun missingFirstReleaseMeansNoUpdateButServerFailureIsAnError() {
        server.enqueue(MockResponse().setResponseCode(404).setBody("not a release"))
        assertNull(source.latest(1))
        for (status in listOf(401, 403, 429, 500, 503)) {
            server.enqueue(MockResponse().setResponseCode(status).setBody("upstream private debug trace"))
            assertFalse(failure { source.latest(1) }.message.contains("private debug"))
        }
    }

    @Test fun schemaPackageAndExactFieldTypesAreRequired() {
        val invalid = listOf(
            manifest().put("schemaVersion", 2), manifest().put("schemaVersion", "1"),
            manifest().put("packageName", "sk.unrelated.app"), manifest().put("extra", "field"),
            manifest().put("versionCode", "2"), manifest().put("versionCode", 2.5),
            manifest().put("versionCode", 0), manifest().put("versionCode", Int.MAX_VALUE.toLong() + 1),
            manifest().put("sizeBytes", "98304"), manifest().put("releaseNotes", JSONObject.NULL),
        )
        for (item in invalid) {
            server.enqueue(response(item))
            failure { source.latest(1) }
        }
    }

    @Test fun duplicatedKeysNonJsonAndInvalidUtf8AreRejected() {
        val duplicate = manifest().toString().replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"schemaVersion\":1")
        for (body in listOf(duplicate, "{schemaVersion:1}", manifest().toString() + "{}")) {
            server.enqueue(MockResponse().setBody(body))
            failure { source.latest(1) }
        }
        server.enqueue(MockResponse().setBody(Buffer().write(byteArrayOf(0xc3.toByte(), 0x28))))
        failure { source.latest(1) }
    }

    @Test fun manifestSizeIsBoundedWithAndWithoutContentLength() {
        val huge = manifest().toString() + " ".repeat(32 * 1024)
        server.enqueue(MockResponse().setBody(huge))
        failure { source.latest(1) }
        server.enqueue(MockResponse().setChunkedBody(huge, 1024))
        failure { source.latest(1) }
    }

    @Test fun manifestLimitsHashFormatAndVersionSyntaxAreChecked() {
        val invalid = listOf(
            manifest().put("sizeBytes", 0), manifest().put("sizeBytes", 100L * 1024 * 1024 + 1),
            manifest().put("sha256", "a".repeat(63)), manifest().put("sha256", "A".repeat(64)),
            manifest().put("releaseNotes", "a".repeat(4001)), manifest().put("releaseNotes", "bad\u0000text"),
            manifest().put("versionName", "../0.1.1"), manifest().put("versionName", "0.1.1+metadata"),
            manifest().put("versionName", "0.01.1"),
        )
        for (item in invalid) {
            server.enqueue(response(item))
            failure { source.latest(1) }
        }
    }

    @Test fun apkUrlMustMatchExactRepositoryTagNameAndHttps() {
        val urls = listOf(
            apkUrl.replace("https:", "http:"), apkUrl.replace("github.com", "github.com.attacker.test"),
            apkUrl.replace("Richinino", "SomeoneElse"), apkUrl.replace("android-v0.1.1", "android-v0.1.2"),
            "$apkUrl?download=1", "$apkUrl#fragment", apkUrl.replace("github.com", "user@github.com"),
            apkUrl.replace("github.com", "github.com:8443"), apkUrl.replace("zdravie-0.1.1.apk", "app.apk"),
            apkUrl.replace("/releases/", "/%72eleases/"),
        )
        for (url in urls) {
            server.enqueue(response(manifest().put("apkUrl", url)))
            failure { source.latest(1) }
        }
    }

    @Test fun githubLatestTagRedirectAndSignedAssetRedirectWork() {
        server.enqueue(MockResponse().setResponseCode(302)
            .setHeader("Location", "/$repository/releases/download/android-v0.1.1/android-update.json"))
        server.enqueue(MockResponse().setResponseCode(302)
            .setHeader("Location", "https://release-assets.githubusercontent.com/github-production-release-asset/file?sig=fixture"))
        server.enqueue(response())
        assertEquals(2, source.latest(1)!!.versionCode)
        assertEquals(3, server.requestCount)
        server.takeRequest()
        server.takeRequest()
        val request = server.takeRequest()
        assertEquals("release-assets.githubusercontent.com", request.getHeader(":authority") ?: request.getHeader("Host"))
    }

    @Test fun metadataMustMatchTheRedirectedImmutableReleaseTag() {
        server.enqueue(MockResponse().setResponseCode(302)
            .setHeader("Location", "/$repository/releases/download/android-v0.1.2/android-update.json"))
        server.enqueue(response())
        failure { source.latest(1) }
    }

    @Test fun redirectTargetsRejectHttpForeignHostsReposCredentialsFragmentsAndPorts() {
        val targets = listOf(
            "http://release-assets.githubusercontent.com/file", "https://objects.githubusercontent.com/file",
            "https://release-assets.githubusercontent.com.attacker.test/file",
            "https://user@release-assets.githubusercontent.com/file", "https://release-assets.githubusercontent.com:8443/file",
            "https://release-assets.githubusercontent.com/file#fragment", "https://github.com/Someone/Else/releases/latest/download/android-update.json",
            "https://github.com/$repository/issues", "$feed?foreign=true",
        )
        for (target in targets) {
            val before = server.requestCount
            server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", target))
            failure { source.latest(1) }
            assertEquals(before + 1, server.requestCount)
        }
    }

    @Test fun redirectLoopsAndAmbiguousLocationsAreRejected() {
        repeat(6) { server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", feed)) }
        failure { source.latest(1) }
        assertEquals(6, server.requestCount)
        server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", feed).addHeader("Location", feed))
        failure { source.latest(1) }
    }

    @Test fun assetRedirectCannotReturnToGithubOrSwitchToAnUnrelatedAsset() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://release-assets.githubusercontent.com/file"))
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", apkUrl))
        failure { source.download(release(), File(directory, "candidate.apk")) }
        assertNoPartials()
        server.enqueue(MockResponse().setResponseCode(302)
            .setHeader("Location", apkUrl.replace("android-v0.1.1", "android-v0.1.2")))
        failure { source.download(release(), File(directory, "candidate.apk")) }
        assertNoPartials()
    }

    @Test fun apkIsPublishedOnlyAfterSizeAndHashVerificationAndProgressIsBounded() {
        val destination = File(directory, "candidate.apk").apply { writeText("previous verified file") }
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://release-assets.githubusercontent.com/file?signature=fixture"))
        server.enqueue(MockResponse().setBody(Buffer().write(apk)))
        val progress = mutableListOf<Long>()
        val result = source.download(release(), destination) { received, expected ->
            assertEquals(apk.size.toLong(), expected)
            assertTrue(received in 0..expected)
            assertEquals("previous verified file", destination.readText())
            progress += received
        }
        assertEquals(destination, result)
        assertArrayEquals(apk, result.readBytes())
        assertEquals(0L, progress.first())
        assertEquals(apk.size.toLong(), progress.last())
        assertEquals(progress.sorted(), progress)
        assertNoPartials()
    }

    @Test fun badHashAndWrongContentLengthLeavePreviousFileAndNoPartial() {
        val destination = File(directory, "candidate.apk").apply { writeText("previous") }
        server.enqueue(MockResponse().setBody(Buffer().write(apk)))
        failure { source.download(release().copy(sha256 = "0".repeat(64)), destination) }
        assertEquals("previous", destination.readText())
        assertNoPartials()
        server.enqueue(MockResponse().setBody("short"))
        failure { source.download(release(), destination) }
        assertEquals("previous", destination.readText())
        assertNoPartials()
    }

    @Test fun chunkedShortAndOversizeApkAreRejectedWithoutPublishing() {
        val destination = File(directory, "candidate.apk")
        for (bytes in listOf(apk.copyOf(10), apk + byteArrayOf(0))) {
            server.enqueue(MockResponse().setChunkedBody(Buffer().write(bytes), 4096))
            failure { source.download(release(), destination) }
            assertFalse(destination.exists())
            assertNoPartials()
        }
    }

    @Test fun callerConstructedUntrustedReleaseCannotStartADownload() {
        val destination = File(directory, "candidate.apk")
        failure { source.download(release().copy(apkUrl = "https://attacker.test/app.apk"), destination) }
        failure { source.download(release().copy(sizeBytes = 100L * 1024 * 1024 + 1), destination) }
        assertEquals(0, server.requestCount)
        assertNoPartials()
    }

    @Test fun cancellationDoesNotPublishOrLeaveAPartialApk() {
        val destination = File(directory, "candidate.apk").apply { writeText("previous") }
        server.enqueue(MockResponse().setBody(Buffer().write(apk)))
        assertThrows(CancellationException::class.java) {
            source.download(release(), destination) { read, _ ->
                if (read > 0) Thread.currentThread().interrupt()
            }
        }
        Thread.interrupted()
        assertEquals("previous", destination.readText())
        assertNoPartials()
    }

    @Test fun accountCookiesAuthAndInjectedInterceptorsNeverReachUpdateRequests() {
        var cookieReads = 0
        var cookieWrites = 0
        var authentications = 0
        val ambient = object : CookieJar {
            override fun loadForRequest(url: HttpUrl): List<Cookie> {
                cookieReads++
                return listOf(Cookie.Builder().name("owi_session").value("fixture-secret").domain(url.host).build())
            }
            override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) { cookieWrites++ }
        }
        source = GithubUpdateSource(client.newBuilder().cookieJar(ambient)
            .authenticator(Authenticator { _, _ -> authentications++; null })
            .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("Authorization", "fixture-secret").build()) }
            .addNetworkInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("Cookie", "owi_session=fixture-secret").build()) }
            .build(), repository)
        server.enqueue(response().addHeader("Set-Cookie", "injected=fixture; Secure; Path=/"))
        assertNotNull(source.latest(1))
        val request = server.takeRequest()
        assertNull(request.getHeader("Authorization"))
        assertNull(request.getHeader("Cookie"))
        server.enqueue(MockResponse().setResponseCode(401).setHeader("WWW-Authenticate", "Basic realm=fixture"))
        failure { source.latest(1) }
        assertEquals(0, cookieReads)
        assertEquals(0, cookieWrites)
        assertEquals(0, authentications)
    }

    @Test fun forksCanUseTheirOwnExactRepositoryAndUnsafeConfigurationIsRejected() {
        source = GithubUpdateSource(client, "Example/zdravie-fork")
        server.enqueue(response(manifest().put("apkUrl", apkUrl.replace(repository, "Example/zdravie-fork"))))
        assertNotNull(source.latest(1))
        assertEquals("/Example/zdravie-fork/releases/latest/download/android-update.json", server.takeRequest().path)
        for (repo in listOf("owner/repo/extra", "https://github.com/owner/repo", "owner/..", "owner/repo?x=1", "../repo")) {
            assertThrows(IllegalArgumentException::class.java) { GithubUpdateSource(client, repo) }
        }
    }

    private class FixtureSocketFactory(private val port: () -> Int) : SocketFactory() {
        override fun createSocket(): Socket = object : Socket() {
            override fun connect(endpoint: SocketAddress?, timeout: Int) {
                super.connect(InetSocketAddress("127.0.0.1", port()), timeout)
            }
        }
        override fun createSocket(host: String?, port: Int): Socket = error("Unexpected overload")
        override fun createSocket(host: String?, port: Int, localHost: InetAddress?, localPort: Int): Socket = error("Unexpected overload")
        override fun createSocket(host: InetAddress?, port: Int): Socket = error("Unexpected overload")
        override fun createSocket(host: InetAddress?, port: Int, localHost: InetAddress?, localPort: Int): Socket = error("Unexpected overload")
    }
}
