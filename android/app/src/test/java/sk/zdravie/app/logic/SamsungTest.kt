package sk.zdravie.app.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import sk.zdravie.app.logic.LogicFixtures.makeScore
import sk.zdravie.app.model.Score

class SamsungTest {
    private fun learning(entries: Int, needed: Int = 10): Score =
        makeScore(null, mapOf("entries" to entries.toDouble(), "needed" to needed.toDouble()), "learning")

    @Test fun countsTheEntriesStillMissing() {
        assertTrue(Samsung.isLearning(learning(6)))
        assertEquals(4, Samsung.learningGap(learning(6)))
        assertEquals(0, Samsung.learningGap(learning(12)))
        assertEquals(10, Samsung.learningGap(makeScore(null, emptyMap(), "learning")))
        assertNull(Samsung.learningGap(makeScore(80.0)))
        assertNull(Samsung.learningGap(null))
    }

    @Test fun recognisesLearningAmongSeveralNotes() {
        assertTrue(Samsung.isLearning(makeScore(null, emptyMap(), "estimate; learning")))
        assertFalse(Samsung.isLearning(makeScore(null, emptyMap(), "estimate")))
    }

    @Test fun saysItInSlovak() {
        assertEquals("učí sa, chýba ešte 1 zápis", Samsung.learningText(learning(9)))
        assertEquals("učí sa, chýbajú ešte 3 zápisy", Samsung.learningText(learning(7)))
        assertEquals("učí sa, chýbajú ešte 4 zápisy", Samsung.learningText(learning(6)))
        assertEquals("učí sa, chýba ešte 8 zápisov", Samsung.learningText(learning(2)))
        assertEquals("učí sa", Samsung.learningText(learning(10)))
        assertNull(Samsung.learningText(makeScore(70.0)))
    }

    @Test fun hidesTheCountersFromThePartsWhileLearning() {
        assertEquals(emptyMap<String, Double?>(), Samsung.scoreParts(learning(3))?.components)
        val scored = makeScore(80.0, mapOf("deep" to 70.0))
        assertSame(scored, Samsung.scoreParts(scored))
        assertNull(Samsung.scoreParts(null))
    }
}
