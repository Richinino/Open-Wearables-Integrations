package sk.zdravie.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sk.zdravie.app.ui.components.BackgroundGlow
import sk.zdravie.app.ui.components.Eyebrow
import sk.zdravie.app.ui.components.Panel
import sk.zdravie.app.ui.components.pressClickable
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.ZType
import sk.zdravie.app.ui.theme.panelColor

/** The four bottom tabs; the account opens from the circle top right. */
enum class AppTab(val title: String) { TODAY("Dnes"), SLEEP("Spánok"), ACTIVITY("Aktivita"), TRENDS("Trendy") }

/** Stroked line icons copied from the artboard SVGs (viewBox sizes kept). */
internal object ZIcons {
    private fun icon(name: String, viewport: Float, stroke: Float, vararg paths: String): ImageVector =
        ImageVector.Builder(name, viewport.dp, viewport.dp, viewport, viewport).apply {
            paths.forEach { data ->
                addPath(
                    pathData = PathParser().parsePathString(data).toNodes(),
                    fill = null,
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = stroke,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()

    val today = icon(
        "today", 20f, 1.6f,
        "M13.6 10a3.6 3.6 0 1 1-7.2 0a3.6 3.6 0 1 1 7.2 0Z",
        "M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4",
    )
    val sleep = icon("sleep", 20f, 1.6f, "M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1Z")
    val activity = icon("activity", 20f, 1.6f, "M2.5 10.5h3l2-5 4 9 2-4h4")
    val trends = icon("trends", 20f, 1.6f, "M3 16.5h14M5 13V9M8.7 13V5.5M12.3 13V8M16 13V3.5")
    val back = icon("back", 16f, 1.6f, "M10 3 5 8l5 5")
    val forward = icon("forward", 16f, 1.6f, "m6 3 5 5-5 5")
    val warning = icon("warning", 16f, 1.5f, "M8 1.5 15 14H1L8 1.5Z", "M8 6v4m0 2v.5")

    fun of(tab: AppTab): ImageVector = when (tab) {
        AppTab.TODAY -> today
        AppTab.SLEEP -> sleep
        AppTab.ACTIVITY -> activity
        AppTab.TRENDS -> trends
    }
}

@Composable
internal fun ZIcon(icon: ImageVector, color: Color, size: Dp, modifier: Modifier = Modifier) {
    Icon(rememberVectorPainter(icon), contentDescription = null, tint = color, modifier = modifier.size(size))
}

/**
 * Background, glow, content and the bottom bar. The bar hides while the keyboard is open so a
 * focused field stays above it.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AppShell(tab: AppTab, showNav: Boolean, onTab: (AppTab) -> Unit, content: @Composable () -> Unit) {
    val t = LocalZTokens.current
    val nav = showNav && !WindowInsets.isImeVisible
    Box(Modifier.fillMaxSize().background(t.bg)) {
        BackgroundGlow()
        Column(Modifier.fillMaxSize()) {
            val insets = if (nav) {
                WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)
            } else {
                WindowInsets.safeDrawing
            }
            Box(Modifier.weight(1f).fillMaxWidth().windowInsetsPadding(insets), contentAlignment = Alignment.TopCenter) {
                content()
            }
            if (nav) BottomNav(tab, onTab)
        }
    }
}

/** Four tabs as in the artboard: icon in a 56 x 30 pill (accent tint when selected) and a 12 sp label. */
@Composable
internal fun BottomNav(selected: AppTab, onSelect: (AppTab) -> Unit) {
    val t = LocalZTokens.current
    Row(
        Modifier
            .fillMaxWidth()
            .background(t.bg.copy(alpha = 0.88f))
            .drawBehind { drawLine(t.line, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) }
            .windowInsetsPadding(WindowInsets.navigationBars.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
            .padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 14.dp)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        AppTab.entries.forEach { tab ->
            val on = tab == selected
            Column(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(16.dp))
                    .selectable(selected = on, role = Role.Tab, onClick = { onSelect(tab) })
                    .padding(vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Box(
                    Modifier
                        .size(56.dp, 30.dp)
                        .clip(RoundedCornerShape(15.dp))
                        .background(if (on) t.accent.copy(alpha = 0.22f) else Color.Transparent),
                    contentAlignment = Alignment.Center,
                ) {
                    ZIcon(ZIcons.of(tab), if (on) t.accentText else t.ink2, 20.dp)
                }
                Text(tab.title, style = ZType.label.copy(fontSize = 12.sp, lineHeight = 16.sp), color = if (on) t.ink else t.ink2)
            }
        }
    }
}

/** 44 dp glass circle with the first initial; the touch area is 48 dp. */
@Composable
internal fun AccountCircle(initial: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val t = LocalZTokens.current
    Box(
        modifier
            .size(48.dp)
            .clip(CircleShape)
            .pressClickable(onClickLabel = "Otvoriť účet", onClick = onClick)
            .semantics { contentDescription = "Účet" },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(44.dp).clip(CircleShape).background(panelColor(t)).border(BorderStroke(1.dp, t.line), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(initial, style = ZType.label.copy(fontSize = 16.sp, lineHeight = 20.sp), color = t.ink)
        }
    }
}

/** 44 dp round icon button (‹ ›) inside a 48 dp touch area. */
@Composable
internal fun CircleIconButton(
    icon: ImageVector,
    description: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val t = LocalZTokens.current
    Box(
        modifier
            .size(48.dp)
            .clip(CircleShape)
            .pressClickable(enabled = enabled, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(44.dp)
                .alpha(if (enabled) 1f else 0.5f)
                .clip(CircleShape)
                .background(if (enabled) panelColor(t) else Color.Transparent)
                .border(BorderStroke(1.dp, t.line), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            ZIcon(icon, if (enabled) t.ink else t.muted, 16.dp)
        }
    }
}

internal fun initialOf(firstName: String): String = firstName.trim().firstOrNull()?.uppercase() ?: "Z"

/** Eyebrow date, a 34 sp title and the account circle, as in the artboard header. */
@Composable
internal fun ScreenHeader(eyebrow: String?, title: String, initial: String, onAccount: () -> Unit, modifier: Modifier = Modifier) {
    val t = LocalZTokens.current
    Row(
        modifier.fillMaxWidth().padding(start = 4.dp, end = 2.dp, top = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (eyebrow != null) Eyebrow(eyebrow)
            Text(title, style = ZType.title, color = t.ink, modifier = Modifier.semantics { heading() })
        }
        AccountCircle(initial, onAccount, Modifier.padding(start = 12.dp))
    }
}

/** Header row of the account screen while it is reached from the circle. */
@Composable
internal fun BackRow(title: String, onBack: () -> Unit) {
    val t = LocalZTokens.current
    Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 16.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        CircleIconButton(ZIcons.back, "Späť", enabled = true, onClick = onBack)
        Text(title, style = ZType.heading, color = t.ink, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 8.dp))
    }
}
