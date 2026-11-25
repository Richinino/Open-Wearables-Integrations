package sk.zdravie.app.preview

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.Instant
import java.time.LocalDate
import kotlin.math.ceil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import sk.zdravie.app.model.*
import sk.zdravie.app.ui.AppShell
import sk.zdravie.app.ui.AppTab
import sk.zdravie.app.ui.HistoryMetric
import sk.zdravie.app.ui.HistoryScreen
import sk.zdravie.app.ui.TodayFixtures
import sk.zdravie.app.ui.TodayFixtures.local
import sk.zdravie.app.ui.ZdravieApp
import sk.zdravie.app.ui.ZdravieTheme
import sk.zdravie.app.ui.screens.TodayScreen

/**
 * Visual evidence only: synthetic models, no network, credentials or production data.
 * Today captures are saved to the app's external files dir; pull them with
 * `adb pull /sdcard/Android/data/sk.zdravie.app/files/<name>.png`.
 */
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
        // The v0.1 history is no longer a tab (Task 8); it is rendered directly until Task 12 removes it.
        compose.setContent { ZdravieTheme("dark") { HistoryScreen(state(), HistoryMetric.STEPS, {}, {}) } }
        save("native-history.png")
    }

    private val today = "2026-10-23"

    /** 400 synthetic days, so the capture also exercises a long history. */
    private fun days(change: (Day) -> Day): List<Day> {
        val all = TodayFixtures.richDays(today, 400)
        return all.dropLast(1) + change(all.last())
    }

    private fun journal() = DailyResult.Ok(JournalState(JournalEntry(
        JournalKeys.RATINGS.associateWith { if (it == "morning_energy" || it == "sleep_quality") 4 else null },
        JournalKeys.CONTEXT.associateWith { if (it == "late_caffeine") true else null }, null), 2))

    @Test fun captureTodayMorning() {
        val now = local(today, 8, 0)
        val data = TodayFixtures.dataset(days { day ->
            day.copy(
                steps = 2860.0, activeMinutesEst = 18.0, totalKcalEst = 640.0, activityKcalEst = 210.0, distanceMEst = 2100.0,
                zoneLightMin = 12.0, zoneModerateMin = 5.0, zoneVigorousMin = 1.0,
                workouts = listOf(TodayFixtures.run(today, 7, 10)),
                scores = day.scores!!.copy(dayScore = 78.0),
            )
        }, now.minusSeconds(7 * 60))
        captureToday("dnes-rano.png", data, now, DailyUiState(today, insights = DailyResult.Unsupported, journal = journal()))
    }

    @Test fun captureTodayEvening() {
        val now = local(today, 20, 0)
        val strength = TodayFixtures.run(today, 17, 30, minutes = 70, id = "strength-$today").copy(
            type = "strength_training", hrAvg = 118.0, hrMax = 146.0, zoneLightMin = 49.0, zoneModerateMin = 17.5,
            zoneVigorousMin = 3.5, distanceM = null, kcalEst = 380.0, strain = 7.8,
        )
        val data = TodayFixtures.dataset(days { day ->
            day.copy(
                steps = 12480.0, activeMinutesEst = 94.0, totalKcalEst = 2760.0, activityKcalEst = 1010.0,
                distance = Selected(9600.0, ValueSource.MEASURED),
                zoneLightMin = 52.0, zoneModerateMin = 30.0, zoneVigorousMin = 12.0,
                workouts = listOf(TodayFixtures.run(today, 7, 10), strength),
                scores = day.scores!!.copy(strain = 13.4, sleepNeedMinutes = 500.0,
                    nightSignal = NightSignal("yellow", 56.0, 52.0, 4.0)),
            )
        }, now.minusSeconds(4 * 60))
        captureToday("dnes-vecer.png", data, now, DailyUiState(today, insights = DailyResult.Unsupported, journal = journal()))
    }

    /**
     * The whole scroll in one image: the screen is laid out as tall as its content (so the lazy list
     * composes every panel), recorded into a graphics layer and rendered off-window.
     */
    private fun captureToday(name: String, data: Dataset, now: Instant, daily: DailyUiState) {
        var height by mutableIntStateOf(6000)
        var slices: List<GraphicsLayer> = emptyList()
        var size = IntSize.Zero
        compose.setContent {
            val recorder = rememberGraphicsLayer()
            // Emulator GPUs refuse textures taller than ~8k px, so the page is rendered in slices.
            val parts = List(MAX_SLICES) { rememberGraphicsLayer() }
            slices = parts
            Box(
                Modifier
                    .fillMaxWidth()
                    .wrapContentHeight(align = Alignment.Top, unbounded = true)
                    .requiredHeight(height.dp)
                    .drawWithContent {
                        recorder.record { this@drawWithContent.drawContent() }
                        drawLayer(recorder)
                        val width = this.size.width.toInt()
                        val total = this.size.height.toInt()
                        size = IntSize(width, total)
                        parts.forEachIndexed { index, part ->
                            val top = index * SLICE_PX
                            if (top < total) {
                                part.record(IntSize(width, minOf(SLICE_PX, total - top))) {
                                    translate(top = -top.toFloat()) { drawLayer(recorder) }
                                }
                            }
                        }
                    },
            ) {
                ZdravieTheme("dark") {
                    AppShell(AppTab.TODAY, showNav = true, onTab = {}) {
                        TodayScreen(
                            dataset = data, date = today, now = now, account = TodayFixtures.account("samsung"), daily = daily,
                            onDate = {}, onOpenSleep = {}, onSaveJournal = { _, _ -> }, onRefresh = {},
                        )
                    }
                }
            }
        }
        compose.waitForIdle()
        // Shrink to the content: drop the empty space below the last panel, keep the list's bottom padding.
        val density = InstrumentationRegistry.getInstrumentation().targetContext.resources.displayMetrics.density
        val list = compose.onNodeWithTag("today-list").fetchSemanticsNode().boundsInRoot
        val end = compose.onNodeWithTag("today-end").fetchSemanticsNode().boundsInRoot
        val unused = (list.bottom - end.bottom) / density - 28f
        compose.runOnIdle { height = ceil(height - unused).toInt() }
        compose.waitForIdle()
        val full = size
        val count = (full.height + SLICE_PX - 1) / SLICE_PX
        assertTrue("page too tall for $MAX_SLICES slices", count <= MAX_SLICES)
        val pieces = runBlocking { withContext(Dispatchers.Main) { slices.take(count).map { it.toImageBitmap().asAndroidBitmap() } } }
        val bitmap = Bitmap.createBitmap(full.width, full.height, Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(bitmap)
        pieces.forEachIndexed { index, piece ->
            // Hardware bitmaps cannot be drawn on a software canvas.
            val soft = piece.copy(Bitmap.Config.ARGB_8888, false)
            canvas.drawBitmap(soft, 0f, (index * SLICE_PX).toFloat(), null)
        }
        val dir = InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null)!!
        val target = File(dir, name)
        target.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertTrue(target.length() > 10_000)
    }

    private companion object {
        const val SLICE_PX = 3000
        const val MAX_SLICES = 6
    }

    private fun save(name:String) {
        compose.waitForIdle()
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        // Capture the app surface, excluding emulator launcher/system error dialogs.
        val bitmap=compose.onRoot().captureToImage().asAndroidBitmap()
        val target=File(instrumentation.targetContext.filesDir,name)
        target.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }
        bitmap.recycle()
        assertTrue(target.length()>1000)
    }
}
