package sk.zdravie.app.updates

import org.junit.Assert.assertThrows
import org.junit.Test

class ApkIdentityTest {
    @Test fun `same signer strictly newer expected release is accepted`() {
        validateApkIdentity("sk.zdravie.app", 1, setOf("a"), "sk.zdravie.app", 2, setOf("a"), 2)
    }
    @Test fun `different package certificate missing signer wrong version or downgrade is rejected`() {
        for ((pkg, version, signers, expected) in listOf(
            Candidate("other.app", 2, setOf("a"), 2), Candidate("sk.zdravie.app", 2, setOf("b"), 2),
            Candidate("sk.zdravie.app", 2, emptySet(), 2), Candidate("sk.zdravie.app", 3, setOf("a"), 2),
            Candidate("sk.zdravie.app", 1, setOf("a"), 1), Candidate("sk.zdravie.app", 0, setOf("a"), 0),
        )) assertThrows(IllegalArgumentException::class.java) {
            validateApkIdentity("sk.zdravie.app", 1, setOf("a"), pkg, version, signers, expected)
        }
        assertThrows(IllegalArgumentException::class.java) {
            validateApkIdentity("sk.zdravie.app", 1, emptySet(), "sk.zdravie.app", 2, emptySet(), 2)
        }
    }
    private data class Candidate(val pkg: String, val version: Long, val signers: Set<String>, val expected: Long)
}
