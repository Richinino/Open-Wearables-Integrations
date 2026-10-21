package sk.zdravie.app.updates

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.hasText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import sk.zdravie.app.ui.ZdravieTheme
import sk.zdravie.app.ui.ZdravieApp
import sk.zdravie.app.BuildConfig
import sk.zdravie.app.model.Account
import sk.zdravie.app.model.AccountIdentity
import sk.zdravie.app.model.AppSession
import sk.zdravie.app.model.AppUiState
import sk.zdravie.app.updates.core.UpdateRelease

@RunWith(AndroidJUnit4::class)
class UpdateUiTest {
    @get:Rule val compose = createComposeRule()
    private val release = UpdateRelease(2, "0.1.1", "https://example.invalid/synthetic.apk", "0".repeat(64), 100, "Synthetic notes")

    @Test fun offerHasDownloadAndDeferWithoutForcingInstallation() {
        var downloaded = 0; var deferred = 0
        compose.setContent {
            ZdravieTheme("dark") {
                UpdateUi(UpdateUiState(UpdateStage.OFFER, true, release), { downloaded++ }, { deferred++ }, {}, {}, {}, {})
            }
        }
        compose.onNodeWithText("Je dostupná aktualizácia").assertIsDisplayed()
        compose.onNodeWithText("Stiahnuť").performClick()
        compose.onNodeWithText("Odložiť").performClick()
        compose.runOnIdle { assertEquals(1, downloaded); assertEquals(1, deferred) }
    }

    @Test fun progressCanBeCancelledAndNeverShowsInstallBeforeValidation() {
        var cancelled = 0
        compose.setContent {
            ZdravieTheme("light") {
                UpdateUi(UpdateUiState(UpdateStage.DOWNLOADING, true, release, 50), {}, {}, {}, {}, { cancelled++ }, {})
            }
        }
        compose.onNodeWithText("50 %").assertIsDisplayed()
        compose.onNodeWithText("Inštalovať").assertDoesNotExist()
        compose.onNodeWithText("Zrušiť sťahovanie").performClick()
        compose.runOnIdle { assertEquals(1, cancelled) }
    }

    @Test fun invisibleFailureDoesNotOverlayTheApplication() {
        compose.setContent {
            UpdateUi(UpdateUiState(UpdateStage.ERROR, false, error = "Synthetic failure"), {}, {}, {}, {}, {}, {})
        }
        compose.onNodeWithTag("update-dialog").assertDoesNotExist()
    }

    @Test fun accountOffersManualUpdateCheckAndInstalledVersion() {
        var checks = 0
        val session = AppSession(
            Account("synthetic", "Alex", null, "alex@example.invalid", "user", "active", true, false, "light"),
            AccountIdentity("synthetic", "synthetic", false, 0), 5000, true,
        )
        compose.setContent {
            ZdravieApp(AppUiState(session = session), { _, _, _ -> }, {}, {}, {}, onCheckForUpdates = { checks++ })
        }
        compose.onNodeWithText("Účet").performClick()
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("Skontrolovať aktualizácie"))
        compose.onNodeWithText("${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})").assertIsDisplayed()
        compose.onNodeWithText("Skontrolovať aktualizácie").performClick()
        compose.runOnIdle { assertEquals(1, checks) }
    }
}
