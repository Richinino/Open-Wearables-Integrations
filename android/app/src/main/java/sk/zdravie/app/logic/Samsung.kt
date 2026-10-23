package sk.zdravie.app.logic

import kotlin.math.ceil
import kotlin.math.max
import sk.zdravie.app.model.Score

/**
 * Port of the "learning" part of web/src/lib/samsung.ts: the state of the two Samsung-style scores
 * while owi still learns from the user's entries. Texts are Slovak.
 */
object Samsung {
    private const val LEARNING_NOTE = "learning"
    private const val NEEDED_DEFAULT = 10.0
    private val NOTE_SPLIT = Regex(";\\s*")

    private fun isNumber(value: Double?): Boolean = value != null && value.isFinite()

    fun isLearning(score: Score?): Boolean {
        val note = score?.note
        return !note.isNullOrEmpty() && note.split(NOTE_SPLIT).contains(LEARNING_NOTE)
    }

    /** Entries still missing before the score shows; null when it is not learning. */
    fun learningGap(score: Score?): Int? {
        if (!isLearning(score)) return null
        val entries = score?.components?.get("entries")
        val needed = score?.components?.get("needed")
        val have = if (isNumber(entries)) entries!! else 0.0
        val need = if (isNumber(needed)) needed!! else NEEDED_DEFAULT
        return max(0.0, ceil(need - have)).toInt()
    }

    /** "učí sa, chýba ešte 4 zápisy"; null when the score is not learning. */
    fun learningText(score: Score?): String? {
        val gap = learningGap(score) ?: return null
        if (gap == 0) return "učí sa"
        if (gap == 1) return "učí sa, chýba ešte 1 zápis"
        if (gap <= 4) return "učí sa, chýbajú ešte $gap zápisy"
        return "učí sa, chýba ešte ${Format.formatInt(gap.toDouble())} zápisov"
    }

    /** The parts of a Samsung-style score, without the learning counters. */
    fun scoreParts(score: Score?): Score? {
        if (score == null) return null
        if (isLearning(score)) return score.copy(components = emptyMap())
        return score
    }
}
