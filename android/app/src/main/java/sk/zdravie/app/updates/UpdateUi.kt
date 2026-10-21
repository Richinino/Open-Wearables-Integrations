package sk.zdravie.app.updates

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** Render inside ZdravieApp.overlay so account and local appearance also apply to the dialog. */
@Composable
fun UpdateUi(
    state: UpdateUiState,
    onDownload: () -> Unit,
    onDefer: () -> Unit,
    onInstall: () -> Unit,
    onDismissError: () -> Unit,
    onCancelDownload: () -> Unit,
    onRetryCheck: () -> Unit,
) {
    if (!state.visible) return
    val release = state.release
    val title = when (state.stage) {
        UpdateStage.CHECKING -> "Kontrola aktualizácií"
        UpdateStage.DOWNLOADING -> "Sťahovanie aktualizácie"
        UpdateStage.READY -> "Aktualizácia je pripravená"
        UpdateStage.PERMISSION -> "Povolenie inštalácie"
        UpdateStage.ERROR -> "Aktualizáciu sa nepodarilo dokončiť"
        UpdateStage.CURRENT -> "Máte aktuálnu verziu"
        else -> "Je dostupná aktualizácia"
    }
    val close = if (state.stage == UpdateStage.DOWNLOADING) onCancelDownload else onDefer
    AlertDialog(
        onDismissRequest = close,
        modifier = Modifier.testTag("update-dialog"),
        title = { Text(title) },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 360.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                release?.let { Text("Zdravie ${it.versionName}", style = MaterialTheme.typography.titleMedium) }
                when (state.stage) {
                    UpdateStage.CHECKING -> {
                        CircularProgressIndicator()
                        Text("Overujeme dostupnú verziu na GitHube.")
                    }
                    UpdateStage.DOWNLOADING -> {
                        val progress = if (release != null && release.sizeBytes > 0)
                            (state.downloadedBytes.toDouble() / release.sizeBytes).toFloat().coerceIn(0f, 1f) else 0f
                        LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
                        Text("${(progress * 100).toInt()} %", modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                        Text("Po stiahnutí a overení balíka potvrdíte inštaláciu v Androide.")
                    }
                    UpdateStage.READY -> Text("Balík je stiahnutý a overený. Android vás požiada o potvrdenie inštalácie. Aplikáciu nemusíte odinštalovať.")
                    UpdateStage.PERMISSION -> Text("V nastaveniach Androidu povoľte aplikácii Zdravie inštalovať túto aktualizáciu a vráťte sa späť. Inštaláciu potom ešte potvrdíte.")
                    UpdateStage.CURRENT -> Text("Momentálne nie je dostupná novšia verzia. Prehľad a údaje môžete ďalej používať.")
                    UpdateStage.OFFER -> {
                        if (!release?.releaseNotes.isNullOrBlank()) Text(release!!.releaseNotes)
                        Text("Aktualizáciu stiahneme z GitHub Releases. Po stiahnutí potvrdíte inštaláciu; aplikáciu nemusíte odinštalovať.")
                    }
                    else -> Unit
                }
                state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            when (state.stage) {
                UpdateStage.OFFER -> TextButton(onClick = onDownload) { Text("Stiahnuť") }
                UpdateStage.READY -> TextButton(onClick = onInstall) { Text("Inštalovať") }
                UpdateStage.ERROR -> TextButton(onClick = if (release == null) onRetryCheck else onDownload) { Text("Skúsiť znova") }
                UpdateStage.CURRENT -> TextButton(onClick = onDismissError) { Text("Zavrieť") }
                else -> Unit
            }
        },
        dismissButton = {
            when (state.stage) {
                UpdateStage.DOWNLOADING -> TextButton(onClick = onCancelDownload) { Text("Zrušiť sťahovanie") }
                UpdateStage.CHECKING -> TextButton(onClick = onDismissError) { Text("Pokračovať v aplikácii") }
                UpdateStage.CURRENT -> Unit
                else -> TextButton(onClick = onDefer) { Text("Odložiť") }
            }
        },
    )
}
