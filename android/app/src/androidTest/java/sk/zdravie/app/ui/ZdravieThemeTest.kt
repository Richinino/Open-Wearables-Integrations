package sk.zdravie.app.ui

import android.os.Build
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.core.view.WindowCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import sk.zdravie.app.model.Account
import sk.zdravie.app.model.AccountIdentity
import sk.zdravie.app.model.AppSession
import sk.zdravie.app.model.AppUiState

@RunWith(AndroidJUnit4::class)
class ZdravieThemeTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun accountAndLocalThemeChangesUpdateBothSystemBarIconAppearances() {
        val session = AppSession(Account("synthetic-theme", "Theme", null, "theme@example.invalid",
            "user", "active", true, false, "dark"),
            AccountIdentity("synthetic-theme", "synthetic-theme", false, 1), 4_000_000_000_000L, false)
        val state = mutableStateOf(AppUiState(session = session, hasLoaded = true))
        compose.setContent { ZdravieApp(state.value, { _, _, _ -> }, {}, {}, {}) }
        assertLightIconsAppearance(false)
        compose.runOnIdle { state.value = state.value.copy(session = session.copy(account = session.account.copy(theme = "light"))) }
        assertLightIconsAppearance(true)
        compose.onNodeWithText("Účet").performClick()
        compose.onNodeWithTag("screen-list").performScrollToNode(hasText("Tmavý"))
        compose.onNodeWithText("Tmavý").performClick()
        assertLightIconsAppearance(false)
        compose.onNodeWithText("Svetlý").performClick()
        assertLightIconsAppearance(true)
    }

    @Suppress("DEPRECATION") // This assertion targets the API 26–28 Window color path.
    private fun assertLightIconsAppearance(light: Boolean) {
        compose.runOnIdle {
            val window = compose.activity.window
            val controller = WindowCompat.getInsetsController(window, window.decorView)
            assertEquals(light, controller.isAppearanceLightStatusBars)
            assertEquals(light, controller.isAppearanceLightNavigationBars)
            if (Build.VERSION.SDK_INT < 29) {
                assertEquals(legacyNavigationBarColor(dark = !light), window.navigationBarColor)
            }
        }
    }
}
