package sk.zdravie.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.panelColor

/** Glass panel: solid glass-over-bg fill and a 1 dp `line` border. Radius 28 (large) or 24 (mini). */
@Composable
fun Panel(
    modifier: Modifier = Modifier,
    radius: Dp = 28.dp,
    padding: Dp = 22.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val t = LocalZTokens.current
    val shape = RoundedCornerShape(radius)
    Column(
        modifier = modifier
            .clip(shape)
            .background(panelColor(t), shape)
            .border(BorderStroke(1.dp, t.line), shape)
            .padding(padding),
        content = content,
    )
}
