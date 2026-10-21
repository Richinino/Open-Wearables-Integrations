package sk.zdravie.app.updates

import java.io.File
import java.nio.file.Files

/** One cleanup before the first updater of this process starts; never prune later active transfers. */
internal object UpdateCache {
    private val preparedRoots = mutableSetOf<String>()
    private val ownedFile = Regex("(?:update-[0-9]+-[0-9]+\\.apk|zdravie-update-[A-Za-z0-9-]+\\.part)")

    @Synchronized
    fun prepare(cacheRoot: File): File {
        val directory = File(cacheRoot, "updates")
        try {
            val root = cacheRoot.canonicalFile
            if (!preparedRoots.add(root.path)) return directory
            val expected = File(root, "updates")
            // A symlink or redirected directory is not an updater-owned cache location.
            if (Files.isSymbolicLink(expected.toPath()) || expected.canonicalFile != expected || !expected.isDirectory) return directory
            expected.listFiles()?.forEach { child ->
                if (ownedFile.matches(child.name) && !Files.isSymbolicLink(child.toPath()) && child.isFile &&
                    child.canonicalFile.parentFile == expected) child.delete()
            }
        } catch (_: Exception) { /* Cache cleanup must never prevent login or loading the overview. */ }
        return directory
    }
}
