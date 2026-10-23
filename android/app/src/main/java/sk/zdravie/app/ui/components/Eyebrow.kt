package sk.zdravie.app.ui.components

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.ZType

/** Section label: DM Mono 11, upper case, 0.1 em tracking, ink2. */
@Composable
fun Eyebrow(text: String, modifier: Modifier = Modifier, color: Color = LocalZTokens.current.ink2) {
    Text(text.uppercase(), modifier = modifier, style = ZType.eyebrow, color = color)
}
