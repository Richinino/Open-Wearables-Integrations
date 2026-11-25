package sk.zdravie.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.Instant
import sk.zdravie.app.logic.Dates
import sk.zdravie.app.logic.Format
import sk.zdravie.app.logic.Metrics
import sk.zdravie.app.logic.Mode
import sk.zdravie.app.logic.Scores
import sk.zdravie.app.logic.SleepKind
import sk.zdravie.app.model.Account
import sk.zdravie.app.model.DailyResult
import sk.zdravie.app.model.DailyUiState
import sk.zdravie.app.model.Dataset
import sk.zdravie.app.model.JournalEntry
import sk.zdravie.app.ui.CircleIconButton
import sk.zdravie.app.ui.ScreenHeader
import sk.zdravie.app.ui.ZIcons
import sk.zdravie.app.ui.components.Segmented
import sk.zdravie.app.ui.initialOf
import sk.zdravie.app.ui.screens.today.ActivityPanel
import sk.zdravie.app.ui.screens.today.EveningHeroPanel
import sk.zdravie.app.ui.screens.today.HeartPanel
import sk.zdravie.app.ui.screens.today.InsightsPanel
import sk.zdravie.app.ui.screens.today.InsightsView
import sk.zdravie.app.ui.screens.today.JournalPanel
import sk.zdravie.app.ui.screens.today.LoadPanel
import sk.zdravie.app.ui.screens.today.MorningHeroPanel
import sk.zdravie.app.ui.screens.today.NightBanner
import sk.zdravie.app.ui.screens.today.SleepPanel
import sk.zdravie.app.ui.screens.today.StatusRow
import sk.zdravie.app.ui.screens.today.TodayModel
import sk.zdravie.app.ui.screens.today.WorkoutsPanel
import sk.zdravie.app.ui.screens.today.balikInsights
import sk.zdravie.app.ui.screens.today.buildTodayModel
import sk.zdravie.app.ui.screens.today.emptyJournal
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.ZType

/**
 * A manual Ráno/Večer choice. It holds only while the automatic layout is still [natural], so a
 * choice made last evening does not stick into the next morning.
 */
data class ModeChoice(val mode: Mode, val natural: Mode)

/** The layout in force: the manual choice while it still applies, otherwise [Scores.resolveMode]. */
fun effectiveMode(choice: ModeChoice?, natural: Mode): Mode = choice?.takeIf { it.natural == natural }?.mode ?: natural

/**
 * The home screen: header with ‹ › and Ráno/Večer, data status, night warning, the morning or evening
 * block and the day's sleep, activity, heart, load, workouts and journal. All day and time maths runs
 * in the dataset time zone; [now] comes from the caller so tests can fix it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(
    dataset: Dataset,
    date: String,
    now: Instant,
    account: Account,
    daily: DailyUiState?,
    onDate: (String) -> Unit,
    onOpenSleep: () -> Unit,
    onSaveJournal: (String, JournalEntry) -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    onAdoptConflict: (String) -> Unit = {},
    onOpenAccount: () -> Unit = {},
    modeChoice: ModeChoice? = null,
    onModeChoice: ((ModeChoice?) -> Unit)? = null,
    refreshing: Boolean = false,
    error: String? = null,
    readOnly: Boolean = false,
) {
    val tz = dataset.timezone
    val today = Dates.todayIn(tz, now)
    val natural = Scores.resolveMode(now, tz, null).mode
    var localChoice by remember { mutableStateOf<ModeChoice?>(null) }
    val choice = if (onModeChoice != null) modeChoice else localChoice
    val mode = effectiveMode(choice, natural)
    val kind = SleepKind.fromAccount(account.sleepScore)
    // Everything heavy is derived once per input change, not on every frame or minute tick.
    val model = remember(dataset, date, today, mode, kind) { buildTodayModel(dataset, date, today, mode, kind) }
    val sync = dataset.lastComputeSuccessAt ?: dataset.syncedAt
    val stale = Metrics.isStale(sync, now)
    val status = statusText(sync, now, stale, model.incomplete)

    val ownDaily = daily?.takeIf { it.day == date }
    val insights = remember(ownDaily?.insights, model) {
        when (val result = ownDaily?.insights) {
            is DailyResult.Ok -> balikInsights(result.value)
            // Unsupported, unavailable or still loading: the web's own observations, quietly.
            else -> InsightsView(model.webInsights, emptyList())
        }
    }
    val journal = (ownDaily?.journal as? DailyResult.Ok)?.value
    var draft by remember(date, journal?.revision) { mutableStateOf(journal?.let { it.entry ?: emptyJournal() }) }

    val pick: (Mode) -> Unit = { picked ->
        val next = ModeChoice(picked, natural)
        if (onModeChoice != null) onModeChoice(next) else localChoice = next
    }

    PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh, modifier = modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            LazyColumn(
                modifier = Modifier.widthIn(max = 640.dp).fillMaxSize().testTag("today-list"),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                item(key = "header") {
                    ScreenHeader(model.eyebrow, model.title, initialOf(account.firstName), onOpenAccount)
                }
                item(key = "controls") { Controls(model, mode, onDate, pick) }
                item(key = "status") { StatusRow(status, stale) }
                if (error != null) item(key = "error") { ErrorLine(error, onRefresh) }
                model.alert?.let { alert -> item(key = "alert") { NightBanner(alert) } }
                val sections = Sections(model, insights, onOpenSleep)
                if (mode == Mode.MORNING) {
                    item(key = "hero") { MorningHeroPanel(model.morning!!) }
                    sections.insights(this)
                    sections.sleep(this)
                    sections.activity(this)
                } else {
                    item(key = "hero") { EveningHeroPanel(model.evening!!) }
                    sections.activity(this)
                    sections.workouts(this)
                    sections.insights(this)
                    sections.sleep(this)
                }
                item(key = "heart") { HeartPanel(model.heart) }
                item(key = "load") { LoadPanel(model.load) }
                if (mode == Mode.MORNING) sections.workouts(this)
                val current = draft
                // "Môj deň" only when the server answers the journal; otherwise the block does not exist.
                if (ownDaily != null && journal != null && current != null) {
                    item(key = "journal") {
                        JournalPanel(date, current, { draft = it }, ownDaily, readOnly, onSaveJournal, onAdoptConflict)
                    }
                }
                item(key = "end") { Spacer(Modifier.fillMaxWidth().height(1.dp).testTag("today-end")) }
            }
        }
    }
}

/** List items shared by both layouts, in the order each artboard places them. */
private class Sections(val model: TodayModel, val insights: InsightsView, val onOpenSleep: () -> Unit) {
    fun insights(scope: LazyListScope) {
        if (insights.cards.isEmpty() && insights.notes.isEmpty()) return
        scope.item(key = "insights") { InsightsPanel(insights) }
    }
    fun sleep(scope: LazyListScope) = scope.item(key = "sleep") { SleepPanel(model.sleep, onOpenSleep) }
    fun activity(scope: LazyListScope) = scope.item(key = "activity") { ActivityPanel(model.activity) }
    fun workouts(scope: LazyListScope) = scope.item(key = "workouts") { WorkoutsPanel(model.workouts) }
}

/** "Dáta pred 7 min", "Pozor · dáta pred 3 h", plus the running-day label. */
private fun statusText(sync: Instant?, now: Instant, stale: Boolean, incomplete: Boolean): String {
    val age = if (sync == null) "čas synchronizácie nie je známy" else "dáta ${Format.formatRelative(sync, now)}"
    val lead = if (stale) "Pozor · $age" else age.replaceFirstChar { it.uppercase() }
    return if (incomplete) "$lead · Priebežné údaje · deň ešte nie je uzavretý" else lead
}

@Composable
private fun Controls(model: TodayModel, mode: Mode, onDate: (String) -> Unit, onMode: (Mode) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            CircleIconButton(ZIcons.back, "Predošlý deň", model.canGoBack, { onDate(Dates.addDays(model.date, -1)) })
            CircleIconButton(ZIcons.forward, "Ďalší deň", model.canGoForward, { onDate(Dates.addDays(model.date, 1)) })
        }
        Segmented(
            options = listOf("Ráno", "Večer"),
            selected = if (mode == Mode.MORNING) 0 else 1,
            onSelect = { onMode(if (it == 0) Mode.MORNING else Mode.EVENING) },
            modifier = Modifier.width(168.dp),
        )
    }
}

@Composable
private fun ErrorLine(message: String, onRetry: () -> Unit) {
    val t = LocalZTokens.current
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 4.dp).semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(message, style = ZType.caption, color = t.ink2, modifier = Modifier.weight(1f))
        Box(Modifier.heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onRetry), contentAlignment = Alignment.Center) {
            Text("Skúsiť znova", style = ZType.label, color = t.accentText, fontWeight = FontWeight.SemiBold)
        }
    }
}
