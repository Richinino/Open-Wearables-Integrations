package sk.zdravie.app.preview

import android.graphics.Bitmap
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.Instant
import java.time.LocalDate
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import sk.zdravie.app.model.*
import sk.zdravie.app.ui.ZdravieApp

/** Visual evidence only: synthetic models, no network, credentials or production data. */
@RunWith(AndroidJUnit4::class)
class NativePreviewTest {
    @get:Rule val compose = createComposeRule()
    private fun state() = AppUiState(
        session = AppSession(Account("preview", "Alex", "Ukážka", "alex@example.test", "user", "active", true, false, "dark"),
            AccountIdentity("preview", "preview", false, 0), Instant.parse("2026-10-22T10:00:00Z").toEpochMilli(), true),
        days = (0..13).map { n -> DaySummary(LocalDate.of(2026,10,8).plusDays(n.toLong()).toString(), n != 13,
            if(n == 4) null else 4000L+n*250L, (4000+n*250)*0.75, 45.0+n, 460.0, 85.0, 78.0, 75.0, 54.0,
            42.0,"rmssd",if(n==13) listOf(WorkoutSummary("preview-walk","walking","2026-10-21T09:00:00Z",2700.0,2300.0,112.0)) else emptyList(),"estimated","measured", timezone = "Europe/Bratislava") },
        syncedAt = "2026-10-21T11:30:00Z", hasLoaded = true)
    @Test fun captureNativeOverview() {
        compose.setContent { ZdravieApp(state(), {_,_,_->},{},{},{}) }
        save("native-overview.png")
    }
    @Test fun captureNativeHistory() {
        compose.setContent { ZdravieApp(state(), {_,_,_->},{},{},{}) }
        compose.onNodeWithText("História").performClick()
        save("native-history.png")
    }
    private fun save(name:String) {
        compose.waitForIdle()
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val bitmap=requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        val target=File(instrumentation.targetContext.filesDir,name)
        target.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }
        bitmap.recycle()
        assertTrue(target.length()>1000)
    }
}
