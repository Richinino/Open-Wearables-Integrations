package sk.zdravie.app.updates

import java.io.File
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class UpdateCacheTest {
    @get:Rule val files = TemporaryFolder()

    @Test fun `startup prunes only known updater files inside private updates directory`() {
        val root = files.newFolder()
        val updates = File(root, "updates").apply { mkdirs() }
        val orphan = File(updates, "update-2-4.apk").apply { writeText("orphan") }
        val partial = File(updates, "zdravie-update-123456.part").apply { writeText("partial") }
        val sibling = File(root, "update-2-4.apk").apply { writeText("unrelated cache") }
        val unrelated = File(updates, "other.apk").apply { writeText("unowned") }
        val nested = File(updates, "nested").apply { mkdirs() }
        val nestedFile = File(nested, "update-2-4.apk").apply { writeText("unowned nested") }
        assertEquals(updates, UpdateCache.prepare(root))
        assertFalse(orphan.exists()); assertFalse(partial.exists())
        assertTrue(sibling.exists()); assertTrue(unrelated.exists()); assertTrue(nestedFile.exists())
    }

    @Test fun `another view model in the same process does not delete active transfer files`() {
        val root = files.newFolder()
        val updates = UpdateCache.prepare(root).apply { mkdirs() }
        val active = File(updates, "zdravie-update-456789.part").apply { writeText("active") }
        val candidate = File(updates, "update-3-6.apk").apply { writeText("verified") }
        UpdateCache.prepare(root)
        assertTrue(active.exists()); assertTrue(candidate.exists())
    }
}
