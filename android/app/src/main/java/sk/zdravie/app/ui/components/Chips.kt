package sk.zdravie.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.ZType

/** Wrapping pill options, one selected. Touch target is at least 48 dp tall. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChoiceChips(
    options: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val t = LocalZTokens.current
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEachIndexed { i, label ->
            val on = i == selected
            val shape = RoundedCornerShape(20.dp)
            Box(
                Modifier
                    .heightIn(min = 48.dp)
                    .clickable(role = Role.RadioButton) { onSelect(i) }
                    .semantics { this.selected = on },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    style = ZType.label.copy(fontSize = 13.sp),
                    color = if (on) t.accentText else t.ink2,
                    modifier = Modifier
                        .clip(shape)
                        .background(if (on) t.accent.copy(alpha = 0.22f) else t.track, shape)
                        .border(BorderStroke(1.dp, if (on) t.accent.copy(alpha = 0.5f) else t.line), shape)
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
        }
    }
}
