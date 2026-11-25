package sk.zdravie.app.ui

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.text.AnnotatedString
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import sk.zdravie.app.model.Account
import sk.zdravie.app.model.AccountIdentity
import sk.zdravie.app.model.AppSession
import sk.zdravie.app.model.AppUiState
import sk.zdravie.app.model.Dataset
import sk.zdravie.app.model.DaySummary
import sk.zdravie.app.ui.TodayFixtures.dataset
import sk.zdravie.app.ui.TodayFixtures.emptyDay
import sk.zdravie.app.ui.TodayFixtures.local
import sk.zdravie.app.ui.TodayFixtures.richDays

/** Only synthetic in-memory models: these screens never contact the production API. */
@RunWith(AndroidJUnit4::class)
class ZdravieAppTest {
    @get:Rule val compose = createComposeRule()

    private val today = "2026-10-20"
    private val now: Instant = local(today, 9, 0)

    @Test fun loginSubmitsTypedCredentialsAndClearsPassword() {
        var received: Triple<String, String, Boolean>? = null
        compose.setContent {
            ZdravieApp(AppUiState(), { email, password, remember -> received = Triple(email, password, remember) }, {}, {}, {})
        }
        compose.onNodeWithText("E-mail").performTextInput("synthetic@example.invalid")
        compose.onNodeWithText("Heslo").performTextInput("Synthetic-only-password")
        compose.onNodeWithTag("login-list").performScrollToNode(hasText("Prihlásiť sa"))
        compose.onNodeWithText("Prihlásiť sa").performClick()
        compose.runOnIdle { assertEquals(Triple("synthetic@example.invalid", "Synthetic-only-password", false), received) }
        compose.onNodeWithTag("login-list").performScrollToNode(hasText("Heslo"))
        compose.onNodeWithText("Heslo").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
    }

    @Test fun loginErrorRetriesSessionRestoreWithoutCredentials() {
        var retries = 0
        compose.setContent {
            ZdravieApp(AppUiState(error = "Skúšobná obnova relácie zlyhala."), { _, _, _ -> }, {}, { retries++ }, {})
        }
        compose.onNodeWithTag("login-list").performScrollToNode(hasText("Skúsiť znova"))
        compose.onNodeWithText("Skúsiť znova").performClick()
        compose.runOnIdle { assertEquals(1, retries) }
    }

    @Test fun bottomBarHasFourTabsAndSleepPanelOpensSleepTab() {
        show(loaded(dataset(richDays(today, 30), now)))
        listOf("Dnes", "Spánok", "Aktivita", "Trendy").forEach { compose.onNode(navigationTab(it)).assertIsDisplayed() }
        compose.onNode(navigationTab("Dnes")).assertIsSelected()
        compose.onNodeWithTag("today-list").performScrollToNode(hasText("Detail noci"))
        compose.onNodeWithText("Detail noci").performClick()
        compose.onNode(navigationTab("Spánok")).assertIsSelected()
        compose.onNode(navigationTab("Trendy")).performClick()
        compose.onNode(navigationTab("Trendy")).assertIsSelected()
        compose.onNode(navigationTab("Dnes")).performClick()
        compose.onNodeWithText("SKÓRE DŇA").assertIsDisplayed()
    }

    @Test fun missingMetricsStayMissingOnToday() {
        show(loaded(dataset(listOf(emptyDay(today)), now)))
        compose.onNodeWithTag("day-score-value").assertTextEquals("–")
        compose.onNodeWithTag("today-list").performScrollToNode(hasText("KROKY DNES"))
        compose.onNodeWithTag("steps-value").assertTextEquals("–")
    }

    @Test fun todayMarksEstimatesAndUsesTheDatasetZoneForWorkouts() {
        val day = emptyDay(today).copy(
            activeMinutesEst = 24.0, steps = 1200.0,
            workouts = listOf(TodayFixtures.run(today, 1, 30).copy(start = Instant.parse("2026-10-19T23:30:00Z"))),
        )
        show(loaded(dataset(listOf(day), now)))
        compose.onNodeWithTag("today-list").performScrollToNode(hasText("≈ 24 min"))
        compose.onNodeWithText("≈ 24 min").assertIsDisplayed()
        compose.onNodeWithTag("today-list").performScrollToNode(hasText("01:30"))
        compose.onNodeWithText("01:30").assertIsDisplayed()
    }

    @Test fun historyDescribesAbsentCalendarDaysAndOffersExactValues() {
        // The v0.1 history stays testable on its own until Task 12 removes it.
        val state = AppUiState(session = session(), days = listOf(day("2026-10-20", 2000L), day("2026-10-18", 1000L)), hasLoaded = true)
        compose.setContent { ZdravieTheme("light") { HistoryScreen(state, HistoryMetric.STEPS, {}, {}) } }
        compose.onNodeWithContentDescription("Kroky, 14 dní. 2 dní s údajom, 12 dní bez údaja.", substring = true).assertExists()
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("Zobraziť hodnoty grafu"))
        compose.onNodeWithText("Zobraziť hodnoty grafu").performClick()
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("Hodnoty grafu · Kroky"))
        compose.onNodeWithText("Hodnoty grafu · Kroky").assertExists()
    }

    @Test fun replacingIdentityDropsSelectedDateAndNavigation() {
        val data = dataset(richDays(today, 30), now)
        val current = mutableStateOf(loaded(data))
        compose.setContent { ZdravieApp(current.value, { _, _, _ -> }, {}, {}, {}, clock = { now }) }
        compose.onNodeWithContentDescription("Predošlý deň").performClick()
        compose.onNode(title("Včera")).assertIsDisplayed()
        compose.onNode(navigationTab("Aktivita")).performClick()
        compose.runOnIdle { current.value = loaded(data, session("beta", "Beta", version = 2)) }
        compose.onNode(navigationTab("Dnes")).assertIsSelected()
        compose.onNode(navigationTab("Aktivita")).assertIsNotSelected()
        compose.onNode(title("Dnes")).assertIsDisplayed()
        compose.onNode(title("Včera")).assertDoesNotExist()
        compose.onNodeWithContentDescription("Účet").assert(hasText("B"))
        compose.runOnIdle { current.value = AppUiState() }
        compose.onNodeWithText("Vitajte späť").assertExists()
    }

    @Test fun sessionVersionChangeAlsoDropsSelectedDay() {
        val data = dataset(richDays(today, 30), now)
        val current = mutableStateOf(loaded(data))
        compose.setContent { ZdravieApp(current.value, { _, _, _ -> }, {}, {}, {}, clock = { now }) }
        compose.onNodeWithContentDescription("Predošlý deň").performClick()
        compose.onNode(title("Včera")).assertIsDisplayed()
        compose.runOnIdle { current.value = current.value.copy(session = session(version = 2)) }
        compose.onNode(title("Dnes")).assertIsDisplayed()
        compose.onNode(title("Včera")).assertDoesNotExist()
    }

    @Test fun todayLoadsBalikBlocksForTheShownDate() {
        val loadedDays = mutableListOf<String>()
        compose.setContent {
            ZdravieApp(loaded(dataset(richDays(today, 30), now)), { _, _, _ -> }, {}, {}, {},
                onLoadDaily = { loadedDays += it }, clock = { now })
        }
        compose.onNodeWithContentDescription("Predošlý deň").performClick()
        compose.runOnIdle { assertEquals(listOf(today, "2026-10-19"), loadedDays) }
    }

    @Test fun pendingAccountHasStatusAndCanOpenAccountManagement() {
        var opened = ""
        compose.setContent {
            ZdravieApp(AppUiState(session = session(pending = true)), { _, _, _ -> }, {}, {}, { opened = it })
        }
        compose.onNodeWithText("Čaká na aktiváciu").assertIsDisplayed()
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("Otvoriť účet na webe"))
        compose.onNodeWithText("Otvoriť účet na webe").performClick()
        compose.runOnIdle { assertEquals("https://zdravie-rho.vercel.app/ucet", opened) }
        compose.onNodeWithContentDescription("Účet").performClick()
        compose.onNodeWithText("Váš účet").assertIsDisplayed()
        compose.onNodeWithContentDescription("Späť").performClick()
        compose.onNodeWithText("Čaká na aktiváciu").assertIsDisplayed()
    }

    @Test fun accountCircleOpensAccountFromToday() {
        show(loaded(dataset(richDays(today, 30), now)))
        compose.onNodeWithContentDescription("Účet").performClick()
        compose.onNodeWithText("Váš účet").assertIsDisplayed()
        compose.onNodeWithContentDescription("Späť").performClick()
        compose.onNodeWithText("SKÓRE DŇA").assertIsDisplayed()
    }

    @Test fun emptyErrorStateCanRetryWithoutInventingData() {
        var retries = 0
        compose.setContent {
            ZdravieApp(AppUiState(session = session(), hasLoaded = true, error = "Skúšobné nedostupné pripojenie."), { _, _, _ -> }, {}, { retries++ }, {})
        }
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("Skúsiť znova"))
        compose.onNodeWithText("Skúsiť znova").performClick()
        compose.runOnIdle { assertEquals(1, retries) }
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("Prehľad nie je dostupný"))
        compose.onNodeWithText("Prehľad nie je dostupný").assertIsDisplayed()
        compose.onNodeWithTag("today-list").assertDoesNotExist()
    }

    @Test fun clockDrivesTheEveningLayout() {
        val evening = local(today, 20, 0)
        compose.setContent { ZdravieApp(loaded(dataset(richDays(today, 30), evening)), { _, _, _ -> }, {}, {}, {}, clock = { evening }) }
        compose.onNodeWithText("STRAIN DŇA").assertIsDisplayed()
        compose.onNode(title("Dnes večer")).assertIsDisplayed()
    }

    private fun show(state: AppUiState) {
        compose.setContent { ZdravieApp(state, { _, _, _ -> }, {}, {}, {}, clock = { now }) }
    }

    private fun loaded(data: Dataset, session: AppSession = session()) =
        AppUiState(session = session, hasLoaded = true, dataset = data)

    private fun title(text: String): SemanticsMatcher = hasText(text) and isHeading()

    private fun navigationTab(title: String): SemanticsMatcher =
        hasText(title) and hasClickAction() and SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)

    private fun session(id: String = "synthetic-alpha", name: String = "Alfa", version: Long = 1, pending: Boolean = false) = AppSession(
        account = Account(id, name, "Test", "$id@example.invalid", "user", if (pending) "pending" else "active", !pending, false, "light"),
        identity = AccountIdentity(id, id, false, version),
        expiresAt = 4_000_000_000_000L,
        persistent = false,
    )

    private fun day(date: String, steps: Long? = null) = DaySummary(
        day = date, complete = true, steps = steps, distanceMeters = null, activeMinutes = null,
        sleepMinutes = null, sleepScore = null, readiness = null, activityScore = null,
        restingHr = null, hrvMs = null, hrvKind = null, workouts = emptyList(),
    )
}
