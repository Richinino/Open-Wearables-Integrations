package sk.zdravie.app.ui

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.time.Instant
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import sk.zdravie.app.model.Account
import sk.zdravie.app.model.DailyResult
import sk.zdravie.app.model.DailyUiState
import sk.zdravie.app.model.Dataset
import sk.zdravie.app.model.JournalEntry
import sk.zdravie.app.model.JournalKeys
import sk.zdravie.app.model.JournalState
import sk.zdravie.app.model.NightSignal
import sk.zdravie.app.ui.TodayFixtures.dataset
import sk.zdravie.app.ui.TodayFixtures.emptyDay
import sk.zdravie.app.ui.TodayFixtures.local
import sk.zdravie.app.ui.TodayFixtures.richDays
import sk.zdravie.app.ui.screens.TodayScreen

/** Synthetic data only; the screen never touches the network here. */
@RunWith(AndroidJUnit4::class)
class TodayScreenTest {
    @get:Rule val compose = createComposeRule()

    private val today = "2026-10-23"
    private val morning: Instant = local(today, 8, 0)
    private val evening: Instant = local(today, 20, 0)

    private fun show(
        data: Dataset,
        now: Instant,
        daily: DailyUiState? = null,
        account: Account = TodayFixtures.account(),
        onSave: (String, JournalEntry) -> Unit = { _, _ -> },
        onAdopt: (String) -> Unit = {},
    ) {
        compose.setContent {
            ZdravieTheme("dark") {
                TodayScreen(
                    dataset = data, date = today, now = now, account = account, daily = daily,
                    onDate = {}, onOpenSleep = {}, onSaveJournal = onSave, onRefresh = {}, onAdoptConflict = onAdopt,
                )
            }
        }
    }

    private fun scrollTo(text: String) = compose.onNodeWithTag("today-list").performScrollToNode(hasText(text))

    private fun scrollToEnd() = compose.onNodeWithTag("today-list").performScrollToNode(hasTestTag("today-end"))

    private fun days(change: (List<sk.zdravie.app.model.Day>) -> List<sk.zdravie.app.model.Day> = { it }) =
        change(richDays(today, 30))

    private fun withLast(list: List<sk.zdravie.app.model.Day>, change: (sk.zdravie.app.model.Day) -> sk.zdravie.app.model.Day) =
        list.dropLast(1) + change(list.last())

    @Test fun morningShowsDayScoreAndSentence() {
        val list = days { withLast(it) { day -> day.copy(scores = day.scores!!.copy(dayScore = 78.0)) } }
        show(dataset(list, morning.minusSeconds(7 * 60)), morning)
        compose.onNodeWithText("SKÓRE DŇA").assertIsDisplayed()
        compose.onNodeWithTag("day-score-value").assertTextEquals("78")
        compose.onNodeWithText("dobrý deň").assertIsDisplayed()
        compose.onNodeWithText("Noc bola v poriadku a pripravenosť je dobrá. Bežný deň by mal sedieť.").assertIsDisplayed()
        compose.onNodeWithText("Ráno").assertIsSelected()
        compose.onNodeWithText("DÁTA PRED 7 MIN", substring = true).assertIsDisplayed()
    }

    @Test fun eveningShowsStrainNeedAndBedtime() {
        val list = days {
            withLast(it) { day -> day.copy(scores = day.scores!!.copy(strain = 13.4, sleepNeedMinutes = 500.0)) }
        }
        show(dataset(list, evening.minusSeconds(60)), evening)
        compose.onNodeWithText("STRAIN DŇA").assertIsDisplayed()
        compose.onNodeWithTag("strain-value").assertTextEquals("13,4")
        compose.onNodeWithText("Večer").assertIsSelected()
        scrollTo("Zaspať okolo")
        compose.onNodeWithText("8 h 20").assertIsDisplayed()
        compose.onNodeWithTag("bedtime-value").assertTextEquals("22:20")
        compose.onNodeWithText("vstávaš zvyčajne 06:56").assertIsDisplayed()
        compose.onNodeWithText(
            "Dnešný strain je 13,4, stredná záťaž. Na dnešnú noc potrebuješ asi 8 h 20 min spánku, " +
                "takže je dobré zaspať okolo 22:20.",
        ).assertExists()
    }

    @Test fun yellowSignalShowsBanner() {
        val list = days {
            withLast(it) { day -> day.copy(scores = day.scores!!.copy(nightSignal = NightSignal("yellow", 56.0, 52.0, 4.0))) }
        }
        show(dataset(list, morning), morning)
        compose.onNodeWithText("Nočný tep bol vyšší než zvyčajne").assertIsDisplayed()
        compose.onNodeWithText("Minulú noc bol tep o 4 bpm nad tvojím normálom", substring = true).assertIsDisplayed()
    }

    @Test fun dayWithoutScoresShowsDashes() {
        // A running day with nothing measured yet and no scores at all: dashes, never zeros, no crash.
        show(dataset(listOf(emptyDay(today, complete = false)), null), morning)
        compose.onNodeWithTag("day-score-value").assertTextEquals("–")
        compose.onNodeWithText("Skóre za dnešok ešte nie je spočítané. Nižšie je, čo ukazujú posledné dni.").assertExists()
        compose.onAllNodesWithText("0").assertCountEquals(0)
        scrollTo("KROKY DNES")
        compose.onNodeWithTag("steps-value").assertTextEquals("–")
        compose.onAllNodesWithText("0").assertCountEquals(0)
        scrollTo("SRDCE")
        compose.onAllNodesWithText("0").assertCountEquals(0)
        scrollToEnd()
        compose.onAllNodesWithText("0").assertCountEquals(0)
    }

    @Test fun phoneZoneDiffersFromDataset() {
        val original = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"))
        try {
            // 08:00 in Bratislava is 02:00 in New York: the dataset zone still makes it a morning.
            val list = days { withLast(it) { day -> day.copy(workouts = listOf(TodayFixtures.run(today, 7, 10))) } }
            show(dataset(list, morning), morning)
            compose.onNodeWithText("SKÓRE DŇA").assertIsDisplayed()
            scrollTo("23:12 → 06:56")
            compose.onNodeWithText("23:12 → 06:56").assertIsDisplayed()
            scrollTo("TRÉNINGY DNES")
            scrollTo("07:10")
            compose.onAllNodesWithText("07:10").assertCountEquals(1)
        } finally {
            TimeZone.setDefault(original)
        }
    }

    @Test fun journalHiddenWhenUnsupported() {
        show(dataset(days(), morning), morning,
            daily = DailyUiState(today, insights = DailyResult.Unsupported, journal = DailyResult.Unsupported))
        scrollToEnd()
        compose.onNodeWithText("MÔJ DEŇ").assertDoesNotExist()
    }

    @Test fun journalShownWhenSupported() {
        show(dataset(days(), morning), morning,
            daily = DailyUiState(today, insights = DailyResult.Unsupported, journal = DailyResult.Ok(JournalState(null, 0))))
        scrollToEnd()
        compose.onNodeWithText("MÔJ DEŇ").assertExists()
    }

    @Test fun journalSaveSendsBlankNoteAsNull() {
        var saved: Pair<String, JournalEntry>? = null
        show(dataset(days(), morning), morning,
            daily = DailyUiState(today, journal = DailyResult.Ok(JournalState(null, 3))),
            onSave = { day, entry -> saved = day to entry })
        scrollToEnd()
        compose.onNodeWithContentDescription("Ranná energia 4 z 5").performClick()
        compose.onNodeWithTag("journal-note").performTextInput("   ")
        scrollToEnd()
        compose.onNodeWithText("Uložiť").performClick()
        compose.runOnIdle {
            val (day, entry) = saved!!
            assertEquals(today, day)
            assertEquals(4, entry.ratings["morning_energy"])
            assertNull(entry.note)
            assertEquals(JournalKeys.CONTEXT.toSet(), entry.context.keys)
        }
    }

    @Test fun journalConflictKeepsDraftAndOffersNewer() {
        val saved = JournalState(JournalEntry(JournalKeys.RATINGS.associateWith { null }, JournalKeys.CONTEXT.associateWith { null }, null), 3)
        val newer = JournalState(saved.entry!!.copy(ratings = saved.entry!!.ratings + ("morning_energy" to 1)), 4)
        val state = mutableStateOf(DailyUiState(today, journal = DailyResult.Ok(saved)))
        var adopted: String? = null
        compose.setContent {
            ZdravieTheme("dark") {
                TodayScreen(
                    dataset = dataset(days(), morning), date = today, now = morning, account = TodayFixtures.account(),
                    daily = state.value, onDate = {}, onOpenSleep = {}, onSaveJournal = { _, _ -> }, onRefresh = {},
                    onAdoptConflict = { adopted = it },
                )
            }
        }
        scrollToEnd()
        compose.onNodeWithContentDescription("Ranná energia 4 z 5").performClick()
        compose.runOnIdle {
            state.value = state.value.copy(conflict = newer,
                saveError = "Zápis sa medzitým zmenil. Tvoje úpravy ostali; môžeš načítať novšiu verziu.")
        }
        scrollToEnd()
        compose.onNodeWithContentDescription("Ranná energia 4 z 5").assertIsSelected()
        compose.onNodeWithText("Zápis sa medzitým zmenil. Tvoje úpravy ostali; môžeš načítať novšiu verziu.").assertExists()
        compose.onNodeWithText("Načítať novšie").performClick()
        compose.runOnIdle { assertEquals(today, adopted) }
    }
}
