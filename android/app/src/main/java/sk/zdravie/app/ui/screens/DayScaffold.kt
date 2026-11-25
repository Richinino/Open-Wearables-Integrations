package sk.zdravie.app.ui.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import sk.zdravie.app.logic.Dates
import sk.zdravie.app.logic.Format
import sk.zdravie.app.ui.CircleIconButton
import sk.zdravie.app.ui.ScreenHeader
import sk.zdravie.app.ui.ZIcons
import sk.zdravie.app.ui.components.ZMotion
import sk.zdravie.app.ui.components.rememberReducedMotion
import sk.zdravie.app.ui.screens.today.mono
import sk.zdravie.app.ui.theme.LocalZTokens

/**
 * Header, ‹ date › and a list, shared by Spánok and Aktivita. Moving to another day slides the
 * content the way you go (16 dp, 220 ms), as on Dnes; the bottom bar never moves.
 */
@Composable
internal fun DayScaffold(
    title: String,
    date: String,
    firstDay: String?,
    today: String,
    initial: String,
    onDate: (String) -> Unit,
    onAccount: () -> Unit,
    tag: String,
    content: LazyListScope.() -> Unit,
) {
    val t = LocalZTokens.current
    val slide = remember { Animatable(0f) }
    var shown by remember { mutableStateOf(date) }
    val reduced = rememberReducedMotion()
    LaunchedEffect(date) {
        if (date == shown) return@LaunchedEffect
        val direction = if (date > shown) 1f else -1f
        shown = date
        if (reduced) return@LaunchedEffect
        slide.snapTo(direction)
        slide.animateTo(0f, tween(220, easing = ZMotion.EaseOut))
    }
    val canBack = firstDay == null || date > firstDay
    val canForward = date < today
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        LazyColumn(
            modifier = Modifier
                .widthIn(max = 640.dp)
                .fillMaxSize()
                .graphicsLayer {
                    translationX = slide.value * 16.dp.toPx()
                    alpha = 1f - abs(slide.value)
                }
                .testTag(tag),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item(key = "header") { ScreenHeader(Format.formatDayLong(date), title, initial, onAccount) }
            item(key = "nav") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        CircleIconButton(ZIcons.back, "Predošlý deň", canBack, { onDate(Dates.addDays(date, -1)) })
                        CircleIconButton(ZIcons.forward, "Ďalší deň", canForward, { onDate(Dates.addDays(date, 1)) })
                    }
                    Text(if (date == today) "dnes" else Format.formatDay(date), style = mono(12.sp, 0.04f), color = t.ink2)
                }
            }
            content()
            item(key = "end") { Spacer(Modifier.fillMaxWidth().height(1.dp).testTag("screen-end")) }
        }
    }
}
