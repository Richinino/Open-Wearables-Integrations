package sk.zdravie.app.ui

import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.ZType
import sk.zdravie.app.ui.components.Segmented
import androidx.compose.ui.draw.clip
import sk.zdravie.app.ui.screens.SleepScreen
import sk.zdravie.app.ui.screens.ActivityScreen
import sk.zdravie.app.ui.screens.TrendsScreen
import sk.zdravie.app.logic.SleepKind
import sk.zdravie.app.logic.Dates
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Instant
import sk.zdravie.app.BuildConfig
import sk.zdravie.app.logic.Format
import sk.zdravie.app.logic.Scores
import sk.zdravie.app.model.AppSession
import sk.zdravie.app.model.AppUiState
import sk.zdravie.app.model.JournalEntry
import sk.zdravie.app.model.WorkoutSummary
import sk.zdravie.app.ui.screens.ModeChoice
import sk.zdravie.app.ui.screens.TodayScreen
import sk.zdravie.app.ui.screens.today.focusDate

private val Web = BuildConfig.API_BASE_URL.trimEnd('/')

/** Balík 1 entry points of the controller; all default to no-ops so previews and tests can omit them. */
private class DailyActions(
    val load: (String) -> Unit,
    val save: (String, JournalEntry) -> Unit,
    val adopt: (String) -> Unit,
)

/**
 * Native screens consume only the current controller state. No credentials or health data are saved by UI.
 * [clock] is read during composition; the activity passes a ticking clock, tests a fixed one.
 */
@Composable
fun ZdravieApp(
    state: AppUiState,
    onLogin: (String, String, Boolean) -> Unit,
    onLogout: () -> Unit,
    onRefresh: () -> Unit,
    onOpenWeb: (String) -> Unit,
    onCheckForUpdates: (() -> Unit)? = null,
    overlay: @Composable () -> Unit = {},
    onLoadDaily: (String) -> Unit = {},
    onSaveJournal: (String, JournalEntry) -> Unit = { _, _ -> },
    onAdoptConflict: (String) -> Unit = {},
    clock: () -> Instant = Instant::now,
) {
    val session = state.session
    // A changed identity discards navigation, selected dates, and all other remembered UI state.
    key(session?.identity, session?.account?.id) {
        var localTheme by remember(session?.account?.theme) { mutableStateOf(session?.account?.theme ?: "system") }
        ZdravieTheme(localTheme) {
            if (session == null) {
                LoginScreen(state, onLogin, onRefresh, onOpenWeb)
            } else {
                SignedInApp(state, session, localTheme, { localTheme = it }, onLogout, onRefresh, onOpenWeb, onCheckForUpdates,
                    DailyActions(onLoadDaily, onSaveJournal, onAdoptConflict), clock())
            }
            overlay()
        }
    }
}

@Composable
private fun LoginScreen(state: AppUiState, onLogin: (String, String, Boolean) -> Unit, onRefresh: () -> Unit, onOpenWeb: (String) -> Unit) {
    var email by remember { mutableStateOf("") }
    // Deliberately remember, never rememberSaveable: a password never enters saved instance state.
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var rememberLogin by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    val canSubmit = email.isNotBlank() && password.isNotEmpty() && !state.loading
    val submit = {
        if (canSubmit) {
            keyboard?.hide()
            focus.clearFocus()
            onLogin(email.trim(), password, rememberLogin)
            password = ""
            showPassword = false
        }
    }
    Scaffold(containerColor = MaterialTheme.colorScheme.background, contentWindowInsets = WindowInsets.safeDrawing) { insets ->
        Box(Modifier.fillMaxSize().padding(insets), contentAlignment = Alignment.TopCenter) {
            LazyColumn(
                modifier = Modifier.widthIn(max = 520.dp).fillMaxSize().imePadding().testTag("login-list"),
                contentPadding = PaddingValues(24.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                item { Brand() }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Vaše zdravie.\nVáš prehľad.", style = ZType.figure, color = LocalZTokens.current.ink, modifier = Modifier.semantics { heading() })
                        MutedText("Spánok, pohyb a každodenné súvislosti na jednom mieste.")
                    }
                }
                item {
                    Panel {
                        SectionTitle("Vitajte späť")
                        MutedText("Prihláste sa svojím účtom Zdravie.")
                        OutlinedTextField(
                            value = email,
                            onValueChange = { email = it },
                            label = { Text("E-mail") },
                            singleLine = true,
                            enabled = !state.loading,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                            keyboardActions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }),
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp),
                        )
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it },
                            label = { Text("Heslo") },
                            singleLine = true,
                            enabled = !state.loading,
                            visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                            trailingIcon = {
                                TextButton(onClick = { showPassword = !showPassword }, enabled = !state.loading) {
                                    Text(if (showPassword) "Skryť" else "Ukázať")
                                }
                            },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { submit() }),
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp),
                        )
                        Row(
                            Modifier.fillMaxWidth().toggleable(value = rememberLogin, enabled = !state.loading, role = Role.Checkbox, onValueChange = { rememberLogin = it }).padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(checked = rememberLogin, onCheckedChange = null, enabled = !state.loading)
                            Text("Zapamätať prihlásenie", modifier = Modifier.padding(start = 12.dp))
                        }
                        state.error?.let { ErrorNotice(it, onRefresh) }
                        Button(onClick = { submit() }, enabled = canSubmit, modifier = Modifier.fillMaxWidth().height(56.dp), shape = RoundedCornerShape(18.dp)) {
                            if (state.loading) {
                                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                                Text("Prihlasovanie…", Modifier.padding(start = 12.dp))
                            } else Text("Prihlásiť sa", fontWeight = FontWeight.SemiBold)
                        }
                        TextButton(onClick = { onOpenWeb("$Web/zabudnute-heslo") }, modifier = Modifier.fillMaxWidth()) { Text("Zabudnuté heslo") }
                    }
                }
                item {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                        MutedText("Ešte nemáte účet?")
                        TextButton(onClick = { onOpenWeb("$Web/registracia") }) { Text("Vytvoriť účet na webe") }
                    }
                }
            }
        }
    }
}

@Composable
private fun SignedInApp(
    state: AppUiState,
    session: AppSession,
    theme: String,
    onTheme: (String) -> Unit,
    onLogout: () -> Unit,
    onRefresh: () -> Unit,
    onOpenWeb: (String) -> Unit,
    onCheckForUpdates: (() -> Unit)?,
    daily: DailyActions,
    now: Instant,
) {
    // All of this sits inside the identity key of ZdravieApp, so a new account starts from scratch.
    var tab by remember { mutableStateOf(AppTab.TODAY) }
    var showAccount by remember { mutableStateOf(false) }
    var selectedDate by remember { mutableStateOf<String?>(null) }
    var modeChoice by remember { mutableStateOf<ModeChoice?>(null) }
    val waiting = session.account.status == "pending" || !session.account.paired
    val dataset = state.dataset?.takeIf { it.days.isNotEmpty() }
    val initial = initialOf(session.account.firstName)
    // The selected date is shared by all tabs; without a choice it follows the web's focus day.
    val date = dataset?.let {
        val natural = Scores.resolveMode(now, it.timezone, null).mode
        val forced = modeChoice?.takeIf { choice -> choice.natural == natural }?.mode
        selectedDate ?: focusDate(it, now, forced)
    }
    val eyebrow = date?.let { Format.formatDayLong(it) }
    LaunchedEffect(tab, date, waiting, showAccount) {
        if (tab == AppTab.TODAY && date != null && !waiting && !showAccount) daily.load(date)
    }
    BackHandler(enabled = showAccount) { showAccount = false }
    val openAccount = { showAccount = true }
    AppShell(
        tab = tab,
        showNav = !showAccount && !waiting,
        onTab = { picked ->
            // Tapping Dnes again goes back to the automatic day.
            if (picked == AppTab.TODAY && tab == AppTab.TODAY) selectedDate = null
            tab = picked
        },
    ) {
        when {
            showAccount -> Column(Modifier.fillMaxSize()) {
                BackRow("Účet") { showAccount = false }
                Box(Modifier.weight(1f), contentAlignment = Alignment.TopCenter) {
                    AccountScreen(state, session, theme, onTheme, onLogout, onRefresh, onOpenWeb, onCheckForUpdates)
                }
            }
            waiting -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                WaitingScreen(state, session, onRefresh, onOpenWeb)
                AccountCircle(initial, openAccount, Modifier.align(Alignment.TopEnd).padding(top = 16.dp, end = 12.dp))
            }
            dataset == null || date == null -> Column(Modifier.widthIn(max = 840.dp).fillMaxSize()) {
                ScreenHeader(null, tab.title, initial, openAccount, Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp))
                Box(Modifier.weight(1f)) {
                    ScreenList {
                        item { RefreshStatus(state, onRefresh) }
                        item { NoData(state, onRefresh) }
                    }
                }
            }
            tab == AppTab.TODAY -> TodayScreen(
                dataset = dataset,
                date = date,
                now = now,
                account = session.account,
                daily = state.daily,
                onDate = { selectedDate = it },
                onOpenSleep = { tab = AppTab.SLEEP },
                onSaveJournal = daily.save,
                onRefresh = onRefresh,
                onAdoptConflict = daily.adopt,
                onOpenAccount = openAccount,
                modeChoice = modeChoice,
                onModeChoice = { modeChoice = it },
                refreshing = state.refreshing,
                error = state.error,
                readOnly = session.identity.viewOnly,
            )
            tab == AppTab.SLEEP -> SleepScreen(
                dataset = dataset,
                date = date,
                today = Dates.todayIn(dataset.timezone, now),
                kind = SleepKind.fromAccount(session.account.sleepScore),
                initial = initial,
                onDate = { selectedDate = it },
                onAccount = openAccount,
            )
            tab == AppTab.ACTIVITY -> ActivityScreen(
                dataset = dataset,
                date = date,
                today = Dates.todayIn(dataset.timezone, now),
                initial = initial,
                onDate = { selectedDate = it },
                onAccount = openAccount,
            )
            else -> TrendsScreen(
                dataset = dataset,
                today = Dates.todayIn(dataset.timezone, now),
                initial = initial,
                onOpenDay = { day ->
                    selectedDate = day
                    tab = AppTab.TODAY
                },
                onAccount = openAccount,
            )
        }
    }
}

@Composable
private fun WaitingScreen(state: AppUiState, session: AppSession, onRefresh: () -> Unit, onOpenWeb: (String) -> Unit) {
    val pending = session.account.status == "pending"
    ScreenList {
        item { Brand() }
        item {
            Panel {
                StatusPill(if (pending) "Čaká na aktiváciu" else "Čaká na spárovanie", MaterialTheme.colorScheme.secondary)
                Text(if (pending) "Váš účet je pripravený na ďalší krok" else "Pripojme vaše údaje", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() })
                MutedText(if (pending) "Účet ešte čaká na aktiváciu a spárovanie so zdrojom údajov. Po ich dokončení sa tu zobrazí váš prehľad." else "Účet zatiaľ nie je spárovaný so zdrojom údajov. Podrobnosti nájdete v nastaveniach účtu na webe.")
                ValueRow("Účet", session.account.email)
                Button(onClick = onRefresh, enabled = !state.refreshing && !state.loading, modifier = Modifier.fillMaxWidth()) {
                    Text(if (state.refreshing || state.loading) "Overovanie…" else "Overiť stav účtu")
                }
                OutlinedButton(onClick = { onOpenWeb("$Web/ucet") }, modifier = Modifier.fillMaxWidth()) { Text("Otvoriť účet na webe") }
            }
        }
        state.error?.let { message -> item { ErrorNotice(message, onRefresh) } }
        item { MutedText("Po aktivácii a prvom prenose údajov obnovte túto obrazovku. Profil a odhlásenie nájdete pod kruhom účtu vpravo hore.") }
    }
}

@Composable
private fun AccountScreen(
    state: AppUiState,
    session: AppSession,
    theme: String,
    onTheme: (String) -> Unit,
    onLogout: () -> Unit,
    onRefresh: () -> Unit,
    onOpenWeb: (String) -> Unit,
    onCheckForUpdates: (() -> Unit)?,
) {
    var confirmLogout by remember { mutableStateOf(false) }
    val account = session.account
    ScreenList {
        item { ScreenHeading("Váš účet", "Profil, pripojenie a vzhľad") }
        item {
            Panel {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Box(Modifier.size(56.dp).background(MaterialTheme.colorScheme.primaryContainer, CircleShape), contentAlignment = Alignment.Center) {
                        Text(account.firstName.firstOrNull()?.uppercase() ?: "Z", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(listOfNotNull(account.firstName, account.lastName).filter { it.isNotBlank() }.joinToString(" ").ifBlank { "Účet Zdravie" }, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        MutedText(account.email)
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ValueRow("Stav účtu", when (account.status) { "active" -> "Aktívny"; "pending" -> "Čaká na aktiváciu"; "disabled" -> "Deaktivovaný"; else -> "Overiť na webe" })
                ValueRow("Zdroj údajov", if (account.paired) "Spárovaný" else "Čaká na spárovanie")
                ValueRow("Samsung Health", if (account.hasSamsung) "Pripojený k účtu" else "Nepripojený")
                ValueRow("Prihlásenie", if (session.persistent) "Zapamätané na tomto zariadení" else "Dočasná relácia")
            }
        }
        item { RefreshStatus(state, onRefresh) }
        item {
            Panel {
                SectionTitle("Vzhľad")
                val themes = listOf("system" to "Systém", "dark" to "Tmavý", "light" to "Svetlý")
                val picked = themes.indexOfFirst { it.first == theme }.takeIf { it >= 0 } ?: 0
                Segmented(themes.map { it.second }, picked, { onTheme(themes[it].first) })
                MutedText("Táto voľba platí počas otvorenia aplikácie. Trvalý vzhľad účtu zmeníte na webe.", small = true)
            }
        }
        item {
            Panel {
                SectionTitle("Správa účtu")
                MutedText("Úpravu profilu, hesla a nastavení otvoríme vo vašom prehliadači.")
                OutlinedButton(onClick = { onOpenWeb("$Web/ucet") }, modifier = Modifier.fillMaxWidth()) { Text("Profil a heslo na webe") }
                if (account.status == "active") OutlinedButton(onClick = { onOpenWeb("$Web/nastavenia") }, modifier = Modifier.fillMaxWidth()) { Text("Nastavenia na webe") }
                if (account.status == "active" && account.hasSamsung) OutlinedButton(onClick = { onOpenWeb("$Web/zapis") }, modifier = Modifier.fillMaxWidth()) { Text("Zápis zo Samsung Health") }
                if (account.role == "admin" && account.status == "active") OutlinedButton(onClick = { onOpenWeb("$Web/admin") }, modifier = Modifier.fillMaxWidth()) { Text("Admin panel") }
                Button(onClick = { confirmLogout = true }, modifier = Modifier.fillMaxWidth()) { Text("Odhlásiť sa") }
            }
        }
        item {
            Panel {
                SectionTitle("Aplikácia")
                ValueRow("Verzia", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                if (onCheckForUpdates != null) OutlinedButton(onClick = onCheckForUpdates, modifier = Modifier.fillMaxWidth()) { Text("Skontrolovať aktualizácie") }
                MutedText("Zdravie · natívna aplikácia pre Android", small = true)
            }
        }
    }
    if (confirmLogout) AlertDialog(
        onDismissRequest = { confirmLogout = false },
        title = { Text("Odhlásiť sa?") },
        text = { Text("Na ďalšie zobrazenie svojho prehľadu sa znova prihlásite.") },
        confirmButton = { TextButton(onClick = { confirmLogout = false; onLogout() }) { Text("Odhlásiť sa") } },
        dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Zostať prihlásený") } },
    )
}

@Composable
internal fun ScreenList(content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    LazyColumn(
        modifier = Modifier.widthIn(max = 840.dp).fillMaxSize().testTag("screen-list"),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        content = content,
    )
}

/** The A2 glass panel (radius 28, 1 dp line) used by login, waiting and account. */
@Composable
internal fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    sk.zdravie.app.ui.components.Panel(modifier.fillMaxWidth(), padding = 0.dp) {
        Column(Modifier.fillMaxWidth().padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp), content = content)
    }
}

/** Half gold, half violet: the day and the night, as on the web. */
@Composable
private fun Brand() {
    val t = LocalZTokens.current
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(26.dp).clip(CircleShape).background(androidx.compose.ui.graphics.Brush.horizontalGradient(0.5f to t.accent, 0.5f to t.sleep)))
        Text("Zdravie", style = ZType.heading, color = t.ink, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
internal fun ScreenHeading(title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = ZType.title, color = LocalZTokens.current.ink, modifier = Modifier.semantics { heading() })
        MutedText(subtitle)
    }
}

@Composable
internal fun SectionTitle(value: String) {
    Text(value, style = ZType.heading, color = LocalZTokens.current.ink, modifier = Modifier.semantics { heading() })
}

@Composable
internal fun MutedText(value: String, small: Boolean = false, modifier: Modifier = Modifier) {
    Text(value, modifier, color = LocalZTokens.current.ink2, style = if (small) ZType.caption else ZType.body)
}

@Composable
internal fun ValueRow(label: String, value: String) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        if (maxWidth < 300.dp || LocalDensity.current.fontScale > 1.3f) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                MutedText(label)
                Text(value, fontWeight = FontWeight.Medium)
            }
        } else Row(horizontalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.fillMaxWidth()) {
            MutedText(label, modifier = Modifier.weight(1f))
            Text(value, modifier = Modifier.weight(1.2f), fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
internal fun StatusPill(label: String, color: Color) {
    Surface(shape = RoundedCornerShape(12.dp), color = color.copy(alpha = 0.12f)) {
        Text(label, Modifier.padding(horizontal = 12.dp, vertical = 8.dp), color = color, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
internal fun RefreshStatus(state: AppUiState, onRefresh: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (state.error != null) ErrorNotice(state.error, onRefresh)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                MutedText("Posledná synchronizácia", small = true)
                Text(syncLabel(state.syncedAt) ?: if (state.hasLoaded) "Čas nie je dostupný" else "Čaká sa na údaje", style = MaterialTheme.typography.bodyMedium)
            }
            if (state.refreshing || state.loading) {
                CircularProgressIndicator(Modifier.size(24.dp).semantics { contentDescription = "Obnovujú sa údaje" }, strokeWidth = 2.dp)
            } else TextButton(onClick = onRefresh) { Text("Obnoviť") }
        }
    }
}

@Composable
internal fun ErrorNotice(message: String, retry: (() -> Unit)? = null) {
    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Nepodarilo sa dokončiť požiadavku", color = MaterialTheme.colorScheme.onErrorContainer, fontWeight = FontWeight.SemiBold)
            Text(message, color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodyMedium)
            if (retry != null) TextButton(onClick = retry) { Text("Skúsiť znova") }
        }
    }
}

@Composable
internal fun NoData(state: AppUiState, onRefresh: () -> Unit) {
    Panel {
        if (state.loading || state.refreshing || !state.hasLoaded && state.error == null) {
            CircularProgressIndicator(Modifier.size(32.dp), strokeWidth = 3.dp)
            SectionTitle("Načítavame váš prehľad")
            MutedText("Údaje sa zobrazia po dokončení synchronizácie.")
        } else {
            SectionTitle(if (state.error == null) "Zatiaľ nemáme údaje" else "Prehľad nie je dostupný")
            MutedText(if (state.error == null) "Účet je pripojený. Po prvom prenose údajov tu nájdete svoje dni, spánok a aktivitu." else "Nepodarilo sa načítať údaje z vášho účtu. Skontrolujte pripojenie a skúste načítanie zopakovať.")
            OutlinedButton(onClick = onRefresh) { Text("Obnoviť údaje") }
        }
    }
}



private val SyncDate = java.time.format.DateTimeFormatter.ofPattern("d. M. yyyy, HH:mm", java.util.Locale.forLanguageTag("sk-SK"))

/** Server sync time in local "d. M. yyyy, HH:mm"; null when absent or unreadable. */
internal fun syncLabel(value: String?): String? {
    if (value.isNullOrBlank()) return null
    val instant = runCatching { java.time.Instant.parse(value) }.getOrNull()
        ?: runCatching { java.time.OffsetDateTime.parse(value).toInstant() }.getOrNull()
        ?: value.toLongOrNull()?.let { runCatching { java.time.Instant.ofEpochMilli(it) }.getOrNull() }
    return instant?.atZone(java.time.ZoneId.systemDefault())?.format(SyncDate)
}
