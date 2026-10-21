package sk.zdravie.app.ui

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.text.AnnotatedString
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import sk.zdravie.app.model.Account
import sk.zdravie.app.model.AccountIdentity
import sk.zdravie.app.model.AppSession
import sk.zdravie.app.model.AppUiState
import sk.zdravie.app.model.DaySummary
import sk.zdravie.app.model.WorkoutSummary

/** Only synthetic in-memory models: these screens never contact the production API. */
@RunWith(AndroidJUnit4::class)
class ZdravieAppTest {
    @get:Rule val compose = createComposeRule()

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

    @Test fun missingMetricsStayMissingOnOverview() {
        show(AppUiState(session = session(), days = listOf(day("2026-10-20")), hasLoaded = true))
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("Kroky"))
        compose.onNodeWithTag("metric-Kroky").assert(hasText("—"))
        compose.onNodeWithTag("metric-Spánok").assert(hasText("—"))
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("Pripravenosť ≈"))
        compose.onNodeWithTag("metric-Pripravenosť ≈").assert(hasText("—"))
        compose.onNodeWithTag("metric-Pokojový tep").assert(hasText("—"))
    }

    @Test fun overviewAndDayDetailIdentifyEstimatesAndUseTheSourceWorkoutTimezone() {
        val day = day("2026-10-21").copy(activeMinutes = 24.0, sleepScore = 82.0,
            sleepScoreEstimated = true, timezone = "Europe/Bratislava",
            workouts = listOf(WorkoutSummary("synthetic-zone-workout", "walk", "2026-10-20T23:30:00Z", 1800.0, null, null)))
        show(AppUiState(session = session(), days = listOf(day), hasLoaded = true))
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("≈ 24 min"))
        compose.onNodeWithText("≈ 24 min").assertIsDisplayed()
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("≈ 82 / 100"))
        compose.onNodeWithText("≈ 82 / 100").assertIsDisplayed()
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("Začiatok · 01:30"))
        compose.onNodeWithText("Začiatok · 01:30").assertIsDisplayed()
        compose.onNode(navigationTab("História")).performClick()
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText(dayLabel(day.day)) and hasClickAction())
        compose.onNode(hasText(dayLabel(day.day)) and hasClickAction()).performClick()
        compose.onNodeWithText("Detail dňa").assertIsDisplayed()
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("≈ 24 min"))
        compose.onNodeWithText("≈ 24 min").assertIsDisplayed()
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("≈ 82 / 100"))
        compose.onNodeWithText("≈ 82 / 100").assertIsDisplayed()
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("Začiatok · 01:30"))
        compose.onNodeWithText("Začiatok · 01:30").assertIsDisplayed()
    }

    @Test fun historyDescribesAbsentCalendarDaysAndOffersExactValues() {
        show(AppUiState(session = session(), days = listOf(day("2026-10-20", 2000L), day("2026-10-18", 1000L)), hasLoaded = true))
        compose.onNode(navigationTab("História")).performClick()
        compose.onNodeWithContentDescription("Kroky, 14 dní. 2 dní s údajom, 12 dní bez údaja.", substring = true).assertExists()
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("Zobraziť hodnoty grafu"))
        compose.onNodeWithText("Zobraziť hodnoty grafu").performClick()
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("Hodnoty grafu · Kroky"))
        compose.onNodeWithText("Hodnoty grafu · Kroky").assertExists()
    }

    @Test fun replacingIdentityDropsPreviousDayDetailAndNavigation() {
        val current = mutableStateOf(AppUiState(session = session(), days = listOf(day("2026-10-20", 2000L)), hasLoaded = true))
        compose.setContent { ZdravieApp(current.value, { _, _, _ -> }, {}, {}, {}) }
        compose.onNode(navigationTab("História")).performClick()
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText(dayLabel("2026-10-20")) and hasClickAction())
        compose.onNode(hasText(dayLabel("2026-10-20")) and hasClickAction()).performClick()
        compose.onNodeWithText("Detail dňa").assertIsDisplayed()
        compose.runOnIdle {
            current.value = AppUiState(session = session("beta", "Beta", version = 2), days = listOf(day("2026-10-19", 3000L)), hasLoaded = true)
        }
        compose.onNodeWithText("Váš prehľad").assertIsDisplayed()
        compose.onNodeWithText("Dobrý deň, Beta").assertIsDisplayed()
        compose.onNodeWithText("Detail dňa").assertDoesNotExist()
        compose.runOnIdle { current.value = AppUiState() }
        compose.onNodeWithText("Vitajte späť").assertExists()
        compose.onNodeWithText("Dobrý deň, Beta").assertDoesNotExist()
    }

    @Test fun sessionVersionChangeAlsoDropsSelectedDay() {
        val current = mutableStateOf(AppUiState(session = session(), days = listOf(day("2026-10-20", 2000L)), hasLoaded = true))
        compose.setContent { ZdravieApp(current.value, { _, _, _ -> }, {}, {}, {}) }
        compose.onNode(navigationTab("História")).performClick()
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText(dayLabel("2026-10-20")) and hasClickAction())
        compose.onNode(hasText(dayLabel("2026-10-20")) and hasClickAction()).performClick()
        compose.onNodeWithText("Detail dňa").assertIsDisplayed()
        compose.runOnIdle { current.value = current.value.copy(session = session(version = 2)) }
        compose.onNodeWithText("Váš prehľad").assertIsDisplayed()
        compose.onNodeWithText("Detail dňa").assertDoesNotExist()
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
        compose.onNode(navigationTab("Účet")).performClick()
        compose.onNodeWithText("Váš účet").assertIsDisplayed()
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
        compose.onNodeWithTag("metric-Kroky").assertDoesNotExist()
    }

    private fun show(state: AppUiState) {
        compose.setContent { ZdravieApp(state, { _, _, _ -> }, {}, {}, {}) }
    }

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
