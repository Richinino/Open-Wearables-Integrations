package sk.zdravie.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.ZType

/** Joined segmented control (e.g. Ráno / Večer). Each segment is at least 48 dp tall. */
@Composable
fun Segmented(
    options: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val t = LocalZTokens.current
    val shape = RoundedCornerShape(22.dp)
    Row(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(t.track, shape)
            .border(BorderStroke(1.dp, t.line), shape)
            .padding(3.dp),
    ) {
        options.forEachIndexed { i, label ->
            val on = i == selected
            Box(
                Modifier
                    .weight(1f)
                    .heightIn(min = 48.dp)
                    .clip(RoundedCornerShape(19.dp))
                    .background(if (on) t.accent.copy(alpha = 0.22f) else Color.Transparent)
                    .clickable(role = Role.Tab) { onSelect(i) }
                    .semantics { this.selected = on },
                contentAlignment = Alignment.Center,
            ) {
                Text(label, style = ZType.label, color = if (on) t.accentText else t.ink2)
            }
        }
    }
}
