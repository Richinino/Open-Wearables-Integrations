package sk.zdravie.app.ui

import androidx.compose.foundation.Canvas
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
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
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
import sk.zdravie.app.model.AppSession
import sk.zdravie.app.model.AppUiState
import sk.zdravie.app.model.WorkoutSummary

private const val Web = "https://zdravie-rho.vercel.app"
private enum class AppTab(val title: String) { OVERVIEW("Prehľad"), HISTORY("História"), ACCOUNT("Účet") }

/** Native screens consume only the current controller state. No credentials or health data are saved by UI. */
@Composable
fun ZdravieApp(
    state: AppUiState,
    onLogin: (String, String, Boolean) -> Unit,
    onLogout: () -> Unit,
    onRefresh: () -> Unit,
    onOpenWeb: (String) -> Unit,
) {
    val session = state.session
    // A changed identity discards navigation, selected dates, and all other remembered UI state.
    key(session?.identity, session?.account?.id) {
        var localTheme by remember(session?.account?.theme) { mutableStateOf(session?.account?.theme ?: "system") }
        ZdravieTheme(localTheme) {
            if (session == null) {
                LoginScreen(state, onLogin, onRefresh, onOpenWeb)
            } else {
                SignedInApp(state, session, localTheme, { localTheme = it }, onLogout, onRefresh, onOpenWeb)
            }
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
                        Text("Vaše zdravie.\nVáš prehľad.", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() })
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
) {
    var tab by remember { mutableStateOf(AppTab.OVERVIEW) }
    var metric by remember { mutableStateOf(HistoryMetric.STEPS) }
    val waiting = session.account.status == "pending" || !session.account.paired
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets.safeDrawing,
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                AppTab.entries.forEach { item ->
                    NavigationBarItem(
                        selected = tab == item,
                        onClick = { tab = item },
                        icon = { TabIcon(item, if (tab == item) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant) },
                        label = { Text(item.title) },
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            when {
                tab == AppTab.ACCOUNT -> AccountScreen(state, session, theme, onTheme, onLogout, onRefresh, onOpenWeb)
                waiting -> WaitingScreen(state, session, onRefresh, onOpenWeb)
                tab == AppTab.HISTORY -> HistoryScreen(state, metric, { metric = it }, onRefresh)
                else -> OverviewScreen(state, session, onRefresh) { selected -> metric = selected; tab = AppTab.HISTORY }
            }
        }
    }
}

@Composable
private fun OverviewScreen(state: AppUiState, session: AppSession, onRefresh: () -> Unit, onHistory: (HistoryMetric) -> Unit) {
    val days = remember(state.days) { state.days.sortedByDescending { it.day } }
    val latest = days.firstOrNull()
    ScreenList {
        item {
            Brand()
            Spacer(Modifier.height(24.dp))
            MutedText("Dobrý deň, ${session.account.firstName.ifBlank { "vitajte" }}")
            Text("Váš prehľad", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 6.dp).semantics { heading() })
        }
        item { RefreshStatus(state, onRefresh) }
        if (latest == null) {
            item { NoData(state, onRefresh) }
        } else {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(dayLabel(latest.day), style = MaterialTheme.typography.titleMedium)
                    if (!latest.complete) StatusPill("Priebežné údaje · deň ešte nie je uzavretý", MaterialTheme.colorScheme.secondary)
                    val age = dayAge(latest)
                    if (age != null && age >= 2) StatusPill("Posledné dostupné údaje sú staršie ako deň", MaterialTheme.colorScheme.tertiary)
                }
            }
            item {
                AdaptivePair(
                    first = { MetricCard("Kroky", steps(latest.steps), "krokov", MaterialTheme.colorScheme.primary) { onHistory(HistoryMetric.STEPS) } },
                    second = { MetricCard("Spánok", duration(latest.sleepMinutes), "celkový čas", MaterialTheme.colorScheme.secondary) { onHistory(HistoryMetric.SLEEP) } },
                )
            }
            item {
                AdaptivePair(
                    first = { MetricCard("Pripravenosť ≈", finiteValue(latest.readiness)?.let { "≈ ${whole(it)}" } ?: "—", "približné skóre / 100", MaterialTheme.colorScheme.secondary) { onHistory(HistoryMetric.READINESS) } },
                    second = { MetricCard("Pokojový tep", restingHrValue(latest), "úderov/min", MaterialTheme.colorScheme.tertiary) { onHistory(HistoryMetric.RESTING_HR) } },
                )
            }
            item {
                Panel {
                    SectionTitle("Ešte z vášho dňa")
                    ValueRow("Aktívny čas", activeMinutesLabel(latest))
                    ValueRow("Vzdialenosť", distanceLabel(latest))
                    ValueRow("Skóre spánku", sleepScoreLabel(latest))
                    ValueRow("Aktivita", finiteValue(latest.activityScore)?.let { "${whole(it)} / 100" } ?: "—")
                    MutedText("≈ označuje približný výpočet. Chýbajúce údaje zobrazujeme ako —.", small = true)
                }
            }
            if (latest.workouts.isNotEmpty()) {
                item { SectionTitle("Tréningy · ${latest.workouts.size}") }
                items(latest.workouts, key = { it.id }) { WorkoutCard(it, latest.timezone) }
            }
            item { OutlinedButton(onClick = { onHistory(HistoryMetric.STEPS) }, modifier = Modifier.fillMaxWidth()) { Text("Otvoriť históriu dní") } }
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
        item { MutedText("Po aktivácii a prvom prenose údajov obnovte túto obrazovku. Profil a odhlásenie nájdete v karte Účet.") }
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
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("system" to "Systém", "light" to "Svetlý", "dark" to "Tmavý").forEach { (value, label) ->
                        FilterChip(selected = theme == value || (value == "system" && theme !in listOf("light", "dark")), onClick = { onTheme(value) }, label = { Text(label) })
                    }
                }
                MutedText("Táto voľba platí počas otvorenia aplikácie. Trvalý vzhľad účtu zmeníte na webe.", small = true)
            }
        }
        item {
            Panel {
                SectionTitle("Správa účtu")
                MutedText("Úpravu profilu, hesla a nastavení otvoríme vo vašom prehliadači.")
                OutlinedButton(onClick = { onOpenWeb("$Web/ucet") }, modifier = Modifier.fillMaxWidth()) { Text("Profil a heslo na webe") }
                if (account.status == "active") OutlinedButton(onClick = { onOpenWeb("$Web/nastavenia") }, modifier = Modifier.fillMaxWidth()) { Text("Nastavenia na webe") }
                Button(onClick = { confirmLogout = true }, modifier = Modifier.fillMaxWidth()) { Text("Odhlásiť sa") }
            }
        }
        item { MutedText("Zdravie · natívna aplikácia pre Android", small = true) }
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

@Composable
internal fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Card(modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp), content = content)
    }
}

@Composable
private fun Brand() {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(12.dp, 28.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape(6.dp)))
        Text("zdravie", fontWeight = FontWeight.Bold, fontSize = 25.sp, letterSpacing = (-0.7).sp)
    }
}

@Composable
internal fun ScreenHeading(title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() })
        MutedText(subtitle)
    }
}

@Composable
internal fun SectionTitle(value: String) {
    Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
}

@Composable
internal fun MutedText(value: String, small: Boolean = false, modifier: Modifier = Modifier) {
    Text(value, modifier, color = MaterialTheme.colorScheme.onSurfaceVariant, style = if (small) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyMedium)
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
private fun AdaptivePair(first: @Composable () -> Unit, second: @Composable () -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        if (maxWidth >= 340.dp && LocalDensity.current.fontScale <= 1.25f) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.weight(1f)) { first() }
                Box(Modifier.weight(1f)) { second() }
            }
        } else Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { first(); second() }
    }
}

@Composable
private fun MetricCard(title: String, value: String, unit: String, accent: Color, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth().testTag("metric-$title"), shape = RoundedCornerShape(24.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(28.dp, 4.dp).background(accent, CircleShape))
            Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            MutedText(unit, small = true)
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

@Composable
internal fun WorkoutCard(workout: WorkoutSummary, timezone: String?) {
    Panel {
        Text(workoutName(workout.type), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        MutedText("Začiatok · ${workoutTime(workout.start, timezone)}", small = true)
        ValueRow("Trvanie", duration(finiteValue(workout.durationSeconds)?.div(60)))
        finiteValue(workout.distanceMeters)?.let { ValueRow("Vzdialenosť", "${decimal(it / 1000)} km") }
        if (finiteValue(workout.averageHr) != null) ValueRow("Priemerný tep", "${whole(workout.averageHr)} úderov/min")
    }
}

private fun workoutName(type: String): String = when (type.lowercase()) {
    "walking", "walk" -> "Chôdza"
    "running", "run" -> "Beh"
    "cycling", "bike", "biking" -> "Bicyklovanie"
    "swimming", "swim" -> "Plávanie"
    "hiking", "hike" -> "Turistika"
    "strength", "strength_training", "weight_training" -> "Silový tréning"
    "yoga" -> "Joga"
    "workout", "other", "unknown", "" -> "Tréning"
    else -> type.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

@Composable
private fun TabIcon(tab: AppTab, color: Color) {
    Canvas(Modifier.size(24.dp).clearAndSetSemantics {}) {
        val scale = size.width / 24f
        val stroke = 1.8f * scale
        when (tab) {
            AppTab.OVERVIEW -> {
                drawRoundRect(color, Offset(3 * scale, 3 * scale), Size(7 * scale, 7 * scale), style = Stroke(stroke))
                drawRoundRect(color, Offset(14 * scale, 3 * scale), Size(7 * scale, 11 * scale), style = Stroke(stroke))
                drawRoundRect(color, Offset(3 * scale, 14 * scale), Size(7 * scale, 7 * scale), style = Stroke(stroke))
                drawRoundRect(color, Offset(14 * scale, 18 * scale), Size(7 * scale, 3 * scale), style = Stroke(stroke))
            }
            AppTab.HISTORY -> {
                drawLine(color, Offset(4 * scale, 20 * scale), Offset(4 * scale, 4 * scale), stroke, StrokeCap.Round)
                drawLine(color, Offset(4 * scale, 20 * scale), Offset(21 * scale, 20 * scale), stroke, StrokeCap.Round)
                val points = listOf(Offset(7 * scale, 15 * scale), Offset(11 * scale, 10 * scale), Offset(15 * scale, 13 * scale), Offset(20 * scale, 5 * scale))
                points.zipWithNext().forEach { (a, b) -> drawLine(color, a, b, stroke, StrokeCap.Round) }
            }
            AppTab.ACCOUNT -> {
                drawCircle(color, 4 * scale, Offset(12 * scale, 7 * scale), style = Stroke(stroke))
                drawArc(color, 180f, 180f, false, Offset(4 * scale, 14 * scale), Size(16 * scale, 12 * scale), style = Stroke(stroke))
            }
        }
    }
}
