package sk.zdravie.app.ui

import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import sk.zdravie.app.logic.SleepKind
import sk.zdravie.app.model.Day
import sk.zdravie.app.ui.screens.ActivityScreen
import sk.zdravie.app.ui.screens.SleepScreen
import sk.zdravie.app.ui.screens.TrendsScreen
import sk.zdravie.app.ui.screens.paceText

/** Spánok, Aktivita and Trendy on synthetic data only. */
@RunWith(AndroidJUnit4::class)
class NewScreensTest {
    @get:Rule val compose = createComposeRule()
    private val today = "2026-10-23"
    private val now = TodayFixtures.local(today, 19, 0)

    private fun data(change: (Day) -> Day = { it }) =
        TodayFixtures.dataset(TodayFixtures.richDays(today, 60).let { it.dropLast(1) + change(it.last()) }, now)

    @Test fun hypnogramHasFourLanes() {
        compose.setContent { ZdravieTheme("dark") { SleepScreen(data(), today, today, SleepKind.PERFORMANCE, "A", {}, {}) } }
        compose.onNodeWithTag("hypnogram-lanes").assertIsDisplayed()
        // Lane labels sit beside the lanes; the same words also label the stage list and tiles.
        listOf("Bdenie", "REM", "Ľahký", "Hlboký").forEach { lane ->
            assertEquals(true, compose.onAllNodesWithText(lane, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
        }
    }

    @Test fun preferredScoreIsLarge() {
        compose.setContent { ZdravieTheme("dark") { SleepScreen(data(), today, today, SleepKind.APPLE, "A", {}, {}) } }
        compose.onNodeWithTag("sleep-list").performScrollToNode(hasTestTag("score-preferred"))
        compose.onNodeWithTag("score-preferred", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Sleep Score", useUnmergedTree = true).assertExists()
    }

    @Test fun samsungLearningShowsLearningText() {
        val learning = data { day ->
            day.copy(scores = day.scores!!.copy(samsungSleep = TodayFixtures.score(null, "learning", mapOf("entries" to 3.0, "needed" to 5.0))))
        }
        compose.setContent { ZdravieTheme("dark") { SleepScreen(learning, today, today, SleepKind.SAMSUNG, "A", {}, {}) } }
        compose.onNodeWithTag("sleep-list").performScrollToNode(hasTestTag("score-preferred"))
        compose.onNodeWithTag("learning", useUnmergedTree = true).assertExists()
    }

    @Test fun nightWithoutTimelineShowsEmptyState() {
        val bare = data { it.copy(sleepTimeline = emptyList()) }
        compose.setContent { ZdravieTheme("dark") { SleepScreen(bare, today, today, SleepKind.PERFORMANCE, "A", {}, {}) } }
        compose.onNodeWithTag("no-timeline").assertIsDisplayed()
    }

    @Test fun napListedSeparately() {
        val napped = data { it.copy(napMinutes = 25.0) }
        compose.setContent { ZdravieTheme("dark") { SleepScreen(napped, today, today, SleepKind.PERFORMANCE, "A", {}, {}) } }
        compose.onNodeWithTag("nap-value", useUnmergedTree = true).assertTextEquals("25 min")
    }

    @Test fun stepsShowAverage() {
        compose.setContent { ZdravieTheme("dark") { ActivityScreen(data(), today, today, "A", {}, {}) } }
        compose.onNodeWithTag("steps-average", useUnmergedTree = true).assertExists()
    }

    @Test fun workoutTapOpensSheet() {
        compose.setContent { ZdravieTheme("dark") { ActivityScreen(data(), today, today, "A", {}, {}) } }
        val id = "run-2026-10-22"
        compose.onNodeWithTag("activity-list").performScrollToNode(hasTestTag("workout-$id"))
        compose.onNodeWithTag("workout-$id").performClick()
        compose.onNodeWithTag("workout-sheet").assertExists()
        compose.onNodeWithTag("pace", useUnmergedTree = true).assertExists()
    }

    @Test fun paceOnlyForRunning() {
        val run = TodayFixtures.run(today, 7, 0)
        assertEquals("5:40 min/km", paceText(run))
        assertEquals(null, paceText(run.copy(type = "strength_training")))
    }

    @Test fun missingStrainShowsDash() {
        val none = data { it.copy(scores = it.scores!!.copy(strain = null)) }
        compose.setContent { ZdravieTheme("dark") { ActivityScreen(none, today, today, "A", {}, {}) } }
        compose.onNodeWithTag("activity-list").performScrollToNode(hasTestTag("strain-today"))
        compose.onNodeWithTag("strain-today", useUnmergedTree = true).assertTextEquals("–")
    }

    @Test fun estimatedDistanceHasApprox() {
        compose.setContent { ZdravieTheme("dark") { ActivityScreen(data(), today, today, "A", {}, {}) } }
        compose.onNodeWithTag("activity-list").performScrollToNode(hasTestTag("distance-value"))
        compose.onNodeWithTag("distance-value", useUnmergedTree = true).assert(hasText("≈", substring = true))
    }

    @Test fun chipChangesMetric() {
        compose.setContent { ZdravieTheme("dark") { TrendsScreen(data(), today, "A", {}, {}) } }
        compose.onNodeWithTag("chip-sleep").performClick()
        compose.onNodeWithText("Spánok · 30 dní", substring = true, ignoreCase = true).assertExists()
    }

    @Test fun recordsListFive() {
        compose.setContent { ZdravieTheme("dark") { TrendsScreen(data(), today, "A", {}, {}) } }
        compose.onNodeWithTag("trends-list").performScrollToNode(hasTestTag("record-steps"))
        compose.onNodeWithTag("record-steps", useUnmergedTree = true).assertExists()
    }

    @Test fun weekCardOpensDay() {
        var opened: String? = null
        compose.setContent { ZdravieTheme("dark") { TrendsScreen(data(), today, "A", { opened = it }, {}) } }
        compose.onNodeWithTag("trends-list").performScrollToNode(hasTestTag("week-2026-10-21"))
        compose.onNodeWithTag("week-2026-10-21").performClick()
        compose.runOnIdle { assertEquals("2026-10-21", opened) }
    }
}
