package sk.zdravie.app.ui.screens.today

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sk.zdravie.app.model.DailyUiState
import sk.zdravie.app.model.JournalEntry
import sk.zdravie.app.model.JournalKeys
import sk.zdravie.app.ui.components.Eyebrow
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.Urbanist

/** Labels as in the artboard, keyed like the Balík 1 contract. */
private val RATING_LABELS = mapOf(
    "morning_energy" to "Ranná energia",
    "sleep_quality" to "Kvalita spánku",
    "evening_stress" to "Večerný stres",
    "muscle_soreness" to "Svalová únava",
)
private val CONTEXT_LABELS = mapOf(
    "travel" to "Cestovanie",
    "unusual_schedule" to "Nezvyčajný režim",
    "late_meal" to "Neskoré jedlo",
    "late_caffeine" to "Neskorý kofeín",
)

/** Ink on the accent button, as in the artboard (#1d1400); 5.7:1 on the light accent too. */
private val ON_ACCENT = Color(0xFF1D1400)

internal fun emptyJournal(): JournalEntry =
    JournalEntry(JournalKeys.RATINGS.associateWith { null }, JournalKeys.CONTEXT.associateWith { null }, null)

/** A blank note is no note: an untouched or emptied field must not send a change. */
internal fun normalized(entry: JournalEntry): JournalEntry = entry.copy(note = entry.note?.takeUnless { it.isBlank() })

private fun style(size: Int, weight: FontWeight = FontWeight.Normal) =
    TextStyle(fontFamily = Urbanist, fontWeight = weight, fontSize = size.sp, lineHeight = (size * 1.3f).sp)

/**
 * "Môj deň": four 1–5 ratings, four day tags and a note, saved with one button. The [draft] lives
 * outside the list item so scrolling away does not drop it; it is never written to disk.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun JournalPanel(
    day: String,
    draft: JournalEntry,
    onDraft: (JournalEntry) -> Unit,
    daily: DailyUiState,
    readOnly: Boolean,
    onSave: (String, JournalEntry) -> Unit,
    onAdopt: (String) -> Unit,
) {
    val t = LocalZTokens.current
    val enabled = !readOnly && !daily.saving
    ZPanel(gap = 16.dp) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Eyebrow("Môj deň")
            Text("nepovinné · dá sa opraviť", style = style(12), color = t.muted)
        }
        JournalKeys.RATINGS.forEach { key ->
            val label = RATING_LABELS[key] ?: key
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(label, style = style(14), color = t.ink2)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    (1..5).forEach { n ->
                        val on = draft.ratings[key] == n
                        val shape = RoundedCornerShape(24.dp)
                        Box(
                            Modifier
                                .weight(1f)
                                .height(48.dp)
                                .clip(shape)
                                .background(if (on) t.ink else Color.Transparent, shape)
                                .border(BorderStroke(1.dp, if (on) t.ink else t.line), shape)
                                .clickable(enabled = enabled, role = Role.RadioButton) {
                                    onDraft(draft.copy(ratings = draft.ratings + (key to if (on) null else n)))
                                }
                                .semantics {
                                    contentDescription = "$label $n z 5"
                                    selected = on
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("$n", style = style(15, FontWeight.SemiBold), color = if (on) t.bg else t.ink2)
                        }
                    }
                }
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            JournalKeys.CONTEXT.forEach { key ->
                val on = draft.context[key] == true
                val shape = RoundedCornerShape(20.dp)
                Box(
                    Modifier
                        .heightIn(min = 48.dp)
                        // Tapping marks the day; tapping again clears it to "not answered", never to "no".
                        .toggleable(value = on, enabled = enabled, role = Role.Checkbox) {
                            onDraft(draft.copy(context = draft.context + (key to if (on) null else true)))
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        CONTEXT_LABELS[key] ?: key,
                        style = style(13, FontWeight.SemiBold),
                        color = if (on) t.ink else t.ink2,
                        modifier = Modifier
                            .clip(shape)
                            .background(if (on) t.accent.copy(alpha = 0.22f) else Color.Transparent, shape)
                            .border(BorderStroke(1.dp, if (on) t.accent else t.line), shape)
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                    )
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Poznámka", style = style(13), color = t.ink2)
            val shape = RoundedCornerShape(14.dp)
            BasicTextField(
                value = draft.note.orEmpty(),
                onValueChange = { if (it.length <= JournalKeys.NOTE_LIMIT) onDraft(draft.copy(note = it)) },
                enabled = enabled,
                textStyle = style(14).copy(color = t.ink),
                cursorBrush = SolidColor(t.ink),
                minLines = 2,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .clip(shape)
                    .border(BorderStroke(1.dp, t.line), shape)
                    .padding(horizontal = 12.dp, vertical = 10.dp)
                    .testTag("journal-note"),
                decorationBox = { field ->
                    Box {
                        if (draft.note.isNullOrEmpty()) Text("Čo ešte vystihuje tvoj deň?", style = style(14), color = t.muted)
                        field()
                    }
                },
            )
        }
        if (daily.saveError != null) {
            Text(
                daily.saveError,
                style = style(13),
                color = t.ink2,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        if (daily.conflict != null) {
            Box(
                Modifier
                    .heightIn(min = 48.dp)
                    .clickable(role = Role.Button) { onAdopt(day) },
                contentAlignment = Alignment.CenterStart,
            ) {
                Text("Načítať novšie", style = style(14, FontWeight.SemiBold), color = t.accentText)
            }
        }
        if (readOnly) {
            Text("Prezeráš denník iného účtu.", style = style(13), color = t.ink2)
        } else {
            val canSave = !daily.saving && daily.conflict == null
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .alpha(if (canSave) 1f else 0.5f)
                    .clip(RoundedCornerShape(24.dp))
                    .background(t.accent)
                    .clickable(enabled = canSave, role = Role.Button) { onSave(day, normalized(draft)) },
                contentAlignment = Alignment.Center,
            ) {
                Text(if (daily.saving) "Ukladám…" else "Uložiť", style = style(15, FontWeight.Bold), color = ON_ACCENT)
            }
        }
    }
}
