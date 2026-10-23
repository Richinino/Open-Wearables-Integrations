package sk.zdravie.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import sk.zdravie.app.logic.StageSegment
import sk.zdravie.app.model.SleepStage
import sk.zdravie.app.ui.components.ChoiceChips
import sk.zdravie.app.ui.components.Eyebrow
import sk.zdravie.app.ui.components.MiniBars
import sk.zdravie.app.ui.components.Panel
import sk.zdravie.app.ui.components.ScoreRing
import sk.zdravie.app.ui.components.Segmented
import sk.zdravie.app.ui.components.Sparkline
import sk.zdravie.app.ui.components.StageStrip
import sk.zdravie.app.ui.components.ZoneBar
import sk.zdravie.app.ui.theme.LocalZTokens

class ComponentsTest {
    @get:Rule val rule = createComposeRule()

    @Test fun descriptionsInDarkTheme() = checkDescriptions("dark")
    @Test fun descriptionsInLightTheme() = checkDescriptions("light")

    private fun checkDescriptions(theme: String) {
        run {
            rule.setContent {
                ZdravieTheme(theme) {
                    val t = LocalZTokens.current
                    Column {
                        ScoreRing(0.72f, t.accent, 220.dp, contentDescription = "Pripravenosť 72") { Text("72") }
                        MiniBars(listOf(10.0, null, 30.0), setOf(2), t.sleep, contentDescription = "Kroky za 3 dni")
                        Sparkline(listOf(1.0, null, 3.0, 2.0), t.heart, contentDescription = "Pulz")
                        StageStrip(listOf(StageSegment(SleepStage.DEEP, 60.0), StageSegment(SleepStage.REM, 90.0)), contentDescription = "Fázy spánku")
                        ZoneBar(10.0, null, 5.0, contentDescription = "Zóny")
                        Panel { Eyebrow("Spánok") }
                    }
                }
            }
            rule.onNodeWithContentDescription("Pripravenosť 72").assertIsDisplayed().assertContentDescriptionEquals("Pripravenosť 72")
            rule.onNodeWithContentDescription("Kroky za 3 dni").assertIsDisplayed()
            rule.onNodeWithContentDescription("Pulz").assertIsDisplayed()
            rule.onNodeWithContentDescription("Fázy spánku").assertIsDisplayed()
            rule.onNodeWithContentDescription("Zóny").assertIsDisplayed()
            rule.onNodeWithText("SPÁNOK").assertIsDisplayed()
        }
    }

    @Test fun segmentedAndChipsReportSelectionAndClicks() {
        var picked = -1
        rule.setContent {
            ZdravieTheme("dark") {
                var seg by remember { mutableIntStateOf(0) }
                Column {
                    Segmented(listOf("Ráno", "Večer"), seg, { seg = it })
                    ChoiceChips(listOf("7 dní", "30 dní"), 0, { picked = it })
                }
            }
        }
        rule.onNodeWithText("Ráno").assertIsSelected()
        rule.onNodeWithText("Večer").performClick()
        rule.onNodeWithText("Večer").assertIsSelected()
        rule.onNodeWithText("30 dní").performClick()
        assertEquals(1, picked)
    }
}
