package sk.zdravie.app.ui.screens.today

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import sk.zdravie.app.logic.NightAlert
import sk.zdravie.app.ui.ZIcon
import sk.zdravie.app.ui.ZIcons
import sk.zdravie.app.ui.components.Eyebrow
import sk.zdravie.app.ui.components.MiniBars
import sk.zdravie.app.ui.components.Panel
import sk.zdravie.app.ui.components.ScoreRing
import sk.zdravie.app.ui.components.Sparkline
import sk.zdravie.app.ui.components.StageStrip
import sk.zdravie.app.ui.components.ZoneBar
import sk.zdravie.app.ui.components.stageColor
import sk.zdravie.app.ui.theme.DmMono
import sk.zdravie.app.ui.theme.LocalZTokens
import sk.zdravie.app.ui.theme.Urbanist
import sk.zdravie.app.ui.theme.ZTokens
import sk.zdravie.app.ui.theme.ZType
import sk.zdravie.app.ui.theme.mixOklab

// ---------------------------------------------------------------------------------------------
// Small building blocks (sizes from the artboard inline styles)

internal fun toneColor(t: ZTokens, tone: Tone): Color = when (tone) {
    Tone.ACCENT -> t.accent
    Tone.SLEEP -> t.sleep
    Tone.HEART -> t.heart
    Tone.INK -> t.ink
}

/** `good` as text: in the light theme it is darkened until it keeps 4.5:1 (controller ruling 2). */
internal fun goodText(t: ZTokens): Color = if (t.bg.luminance() > 0.5f) mixOklab(t.good, t.ink, 0.7f) else t.good

private fun urbanist(size: TextUnit, weight: FontWeight = FontWeight.Normal, spacing: Float = 0f, line: Float = 1.3f) =
    TextStyle(fontFamily = Urbanist, fontWeight = weight, fontSize = size, lineHeight = size * line, letterSpacing = spacing.em)

private fun mono(size: TextUnit, spacing: Float = 0f) =
    TextStyle(fontFamily = DmMono, fontWeight = FontWeight.Normal, fontSize = size, lineHeight = size * 1.35f, letterSpacing = spacing.em)

@Composable
internal fun ZPanel(
    modifier: Modifier = Modifier,
    vertical: Dp = 22.dp,
    gap: Dp = 14.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Panel(modifier.fillMaxWidth(), padding = 0.dp) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = vertical),
            verticalArrangement = Arrangement.spacedBy(gap),
            content = content,
        )
    }
}

/** Inner bordered tile (radius 20) used for minis, HRV, night pulse and sleep need. */
@Composable
private fun InnerTile(
    modifier: Modifier = Modifier,
    border: Color = LocalZTokens.current.line,
    horizontal: Dp = 14.dp,
    vertical: Dp = 14.dp,
    gap: Dp = 6.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(20.dp)
    Column(
        modifier.clip(shape).border(BorderStroke(1.dp, border), shape).padding(horizontal = horizontal, vertical = vertical),
        verticalArrangement = Arrangement.spacedBy(gap),
        content = content,
    )
}

@Composable
private fun Dot(color: Color, size: Dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(CircleShape).background(color))
}

/** "posledné dáta: včera": the tile shows an older day than the selected one. */
@Composable
private fun LatestNote(text: String) {
    val t = LocalZTokens.current
    Row(
        Modifier.clip(CircleShape).border(BorderStroke(1.dp, t.line), CircleShape).padding(horizontal = 10.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Dot(t.warn, 6.dp)
        Text(text, style = mono(11.sp, 0.04f), color = t.ink2)
    }
}

private fun Modifier.topRule(color: Color): Modifier = drawBehind {
    drawLine(color, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx())
}

// ---------------------------------------------------------------------------------------------
// Header area

@Composable
internal fun StatusRow(text: String, stale: Boolean) {
    val t = LocalZTokens.current
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Dot(if (stale) t.warn else t.good, 6.dp)
        Text(text.uppercase(), style = mono(11.sp, 0.06f), color = t.ink2)
    }
}

@Composable
internal fun NightBanner(alert: NightAlert) {
    val t = LocalZTokens.current
    val color = if (alert.level == "red") t.heart else t.warn
    val shape = RoundedCornerShape(22.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(mixOklab(color, t.bg, 0.12f), shape)
            .border(BorderStroke(1.dp, color.copy(alpha = 0.55f)), shape)
            .padding(horizontal = 18.dp, vertical = 16.dp)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ZIcon(ZIcons.warning, color, 18.dp, Modifier.padding(top = 2.dp))
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Eyebrow("Nočný tep · ${if (alert.level == "red") "červená" else "žltá"}")
            Text(alert.title, style = urbanist(15.sp, FontWeight.SemiBold), color = t.ink)
            Text(alert.text, style = urbanist(13.sp, line = 1.4f), color = t.ink2)
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Hero blocks

private val SENTENCE = TextStyle(fontFamily = Urbanist, fontWeight = FontWeight.Normal, fontSize = 21.sp, lineHeight = 26.sp, letterSpacing = (-0.015).em)

@Composable
internal fun MorningHeroPanel(hero: MorningHero) {
    val t = LocalZTokens.current
    ZPanel(vertical = 24.dp, gap = 22.dp) {
        Eyebrow("Skóre dňa")
        ScoreRing(hero.fraction, t.accent, 220.dp, Modifier.align(Alignment.CenterHorizontally), contentDescription = hero.description) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(hero.valueText, style = ZType.display, color = t.ink, modifier = Modifier.testTag("day-score-value"))
                Text(hero.label, style = urbanist(14.sp), color = t.ink2, modifier = Modifier.padding(top = 6.dp))
            }
        }
        Text(hero.sentence, style = SENTENCE, color = t.ink)
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            hero.rows.forEach { row -> ScoreRow(row) }
            if (hero.rows.isEmpty()) Text("Pre tento deň nie sú dáta.", style = urbanist(13.sp), color = t.muted)
        }
    }
}

@Composable
private fun ScoreRow(row: SubRow) {
    val t = LocalZTokens.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(row.label, style = urbanist(15.sp), color = t.ink2, modifier = Modifier.alignByBaseline())
            Text(row.value, style = urbanist(22.sp, FontWeight.Medium), color = t.ink, modifier = Modifier.alignByBaseline())
        }
        Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(t.track)) {
            Box(Modifier.fillMaxWidth(row.fraction).fillMaxHeight().clip(RoundedCornerShape(2.dp)).background(toneColor(t, row.tone)))
        }
        Text(row.reason, style = urbanist(13.sp), color = t.muted)
    }
}

@Composable
internal fun EveningHeroPanel(hero: EveningHero) {
    val t = LocalZTokens.current
    ZPanel(vertical = 24.dp, gap = 22.dp) {
        Eyebrow("Strain dňa")
        ScoreRing(hero.fraction, t.accent, 220.dp, Modifier.align(Alignment.CenterHorizontally), contentDescription = hero.description) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(hero.strainText, style = ZType.display.copy(fontSize = 84.sp, lineHeight = 76.sp), color = t.ink,
                    modifier = Modifier.testTag("strain-value"))
                Text(hero.label, style = urbanist(14.sp), color = t.ink2, modifier = Modifier.padding(top = 8.dp))
            }
        }
        Text(hero.sentence, style = SENTENCE, color = t.ink)
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            InnerTile(Modifier.weight(1f).fillMaxHeight(), horizontal = 16.dp, vertical = 16.dp) {
                Text("Potreba spánku", style = urbanist(12.sp), color = t.ink2)
                Text(hero.needText, style = urbanist(28.sp, spacing = -0.02f, line = 1.1f), color = t.ink)
                Text("podľa záťaže a minulej noci", style = urbanist(12.sp), color = t.muted)
            }
            InnerTile(Modifier.weight(1f).fillMaxHeight(), border = t.sleep.copy(alpha = 0.5f), horizontal = 16.dp, vertical = 16.dp) {
                Text("Zaspať okolo", style = urbanist(12.sp), color = t.ink2)
                Text(hero.bedtimeText, style = urbanist(28.sp, spacing = -0.02f, line = 1.1f), color = t.sleep,
                    modifier = Modifier.testTag("bedtime-value"))
                Text(hero.wakeNote, style = urbanist(12.sp), color = t.muted)
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Čo sa zmenilo

@Composable
internal fun InsightsPanel(view: InsightsView) {
    val t = LocalZTokens.current
    ZPanel {
        Eyebrow("Čo sa zmenilo")
        view.cards.forEach { card ->
            val shape = RoundedCornerShape(20.dp)
            Column(
                Modifier.fillMaxWidth().clip(shape).border(BorderStroke(1.dp, t.line), shape).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (card.bars.isNotEmpty()) {
                    MiniBars(card.bars, card.highlight, toneColor(t, card.tone), height = 40.dp, contentDescription = "Graf k postrehu")
                }
                if (card.subject != null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Dot(toneColor(t, card.tone), 6.dp)
                        Eyebrow(card.subject)
                    }
                }
                Text(card.text, style = urbanist(17.sp, FontWeight.Medium, -0.01f), color = t.ink)
                if (card.detail != null) Text(card.detail, style = urbanist(13.sp), color = t.muted)
            }
        }
        view.notes.forEach { Text(it, style = urbanist(13.sp), color = t.ink2) }
    }
}

// ---------------------------------------------------------------------------------------------
// Spánok

@Composable
internal fun SleepPanel(block: SleepBlock, onOpen: () -> Unit) {
    val t = LocalZTokens.current
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).clickable(role = Role.Button, onClickLabel = "Detail noci", onClick = onOpen)) {
        ZPanel {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Eyebrow("Spánok")
                if (block.clock != null) Text(block.clock, style = mono(12.sp), color = t.ink2)
            }
            if (block.latest != null) LatestNote(block.latest)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                Text(block.duration, style = ZType.figure, color = t.ink, modifier = Modifier.weight(1f, fill = false))
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.padding(start = 12.dp)) {
                    if (block.scoreText != null) Text(block.scoreText, style = urbanist(24.sp, FontWeight.Medium, line = 1.1f), color = t.ink)
                    Text(block.scoreCaption, style = urbanist(12.sp), color = t.muted)
                    if (block.learning != null) Text(block.learning, style = urbanist(12.sp), color = t.ink2)
                }
            }
            StageStrip(block.segments, contentDescription = block.stripDescription)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                block.legend.chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                        pair.forEach { item ->
                            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Box(Modifier.size(9.dp).clip(RoundedCornerShape(3.dp)).background(stageColor(t, item.stage)))
                                Text(item.label, style = urbanist(14.sp), color = t.ink2)
                                Spacer(Modifier.weight(1f))
                                Text(item.value, style = urbanist(14.sp, FontWeight.SemiBold), color = t.ink)
                            }
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(block.footer, style = urbanist(13.sp), color = t.muted, modifier = Modifier.weight(1f))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(start = 8.dp)) {
                    Text("Detail noci", style = urbanist(13.sp, FontWeight.SemiBold), color = t.ink2)
                    ZIcon(ZIcons.forward, t.ink2, 14.dp)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Aktivita

@Composable
private fun StepsRing(fraction: Float, text: String, description: String, modifier: Modifier = Modifier) {
    val t = LocalZTokens.current
    Box(modifier.size(56.dp).clearAndSetSemantics { contentDescription = description }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(56.dp)) {
            val stroke = 6.dp.toPx()
            val inset = stroke / 2
            val arc = Size(size.width - stroke, size.height - stroke)
            drawArc(t.track, -90f, 360f, false, Offset(inset, inset), arc, style = Stroke(stroke))
            if (fraction > 0f) drawArc(t.accent, -90f, 360f * fraction, false, Offset(inset, inset), arc, style = Stroke(stroke, cap = StrokeCap.Butt))
        }
        Text(text, style = mono(11.sp), color = t.ink2)
    }
}

@Composable
private fun RowScope.MiniTile(mini: Mini) {
    val t = LocalZTokens.current
    InnerTile(Modifier.weight(1f).fillMaxHeight(), horizontal = 12.dp, vertical = 14.dp, gap = 10.dp) {
        Text(mini.label, style = urbanist(12.sp), color = t.ink2, maxLines = 1)
        BasicText(
            mini.value,
            style = urbanist(20.sp, FontWeight.Medium, -0.02f, line = 1.1f).copy(color = t.ink),
            maxLines = 1,
            autoSize = TextAutoSize.StepBased(minFontSize = 12.sp, maxFontSize = 20.sp),
        )
        MiniBars(mini.bars, setOf(mini.bars.lastIndex), t.accent, height = 28.dp, contentDescription = mini.description)
        Text(mini.note, style = urbanist(11.sp), color = t.muted)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ActivityPanel(block: ActivityBlock) {
    val t = LocalZTokens.current
    ZPanel(gap = 16.dp) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Eyebrow(block.title)
                Text(block.steps, style = ZType.figureLarge, color = t.ink, modifier = Modifier.testTag("steps-value"))
                Text(block.averageLine, style = urbanist(13.sp), color = if (block.above) goodText(t) else t.ink2)
                if (block.latest != null) LatestNote(block.latest)
            }
            StepsRing(block.ringFraction, block.ringText, block.ringDescription, Modifier.padding(start = 12.dp, top = 6.dp))
        }
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            block.minis.forEach { MiniTile(it) }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Zóny tepu", style = urbanist(13.sp), color = t.ink2)
                Text(block.zoneTotal, style = mono(12.sp), color = t.ink2)
            }
            ZoneBar(block.light, block.moderate, block.vigorous, contentDescription = block.zoneDescription)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                block.zoneLegend.forEach { Text(it, style = urbanist(12.sp), color = t.muted) }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Srdce

@Composable
internal fun HeartPanel(block: HeartBlock) {
    val t = LocalZTokens.current
    ZPanel {
        Eyebrow("Srdce")
        if (block.latest != null) LatestNote(block.latest)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(block.resting, style = ZType.figure, color = t.ink, modifier = Modifier.alignByBaseline())
            Text(block.restingCaption, style = urbanist(14.sp), color = t.ink2, modifier = Modifier.alignByBaseline())
        }
        Sparkline(block.series, t.heart, height = 56.dp, contentDescription = block.seriesDescription)
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            InnerTile(Modifier.weight(1f).fillMaxHeight()) {
                Text(block.hrvLabel, style = urbanist(12.sp), color = t.ink2)
                Text(block.hrv, style = urbanist(24.sp, FontWeight.Medium, -0.02f, line = 1.15f), color = t.ink)
                Text(block.hrvNote, style = urbanist(12.sp), color = t.muted)
            }
            InnerTile(Modifier.weight(1f).fillMaxHeight()) {
                Text("Nočný tep", style = urbanist(12.sp), color = t.ink2)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(block.night, style = urbanist(24.sp, FontWeight.Medium, -0.02f, line = 1.15f), color = t.ink)
                    val dot = when (block.nightLevel) {
                        "green" -> t.good
                        "yellow" -> t.warn
                        "red" -> t.heart
                        else -> t.muted
                    }
                    Dot(dot, 8.dp, Modifier.semantics { contentDescription = block.nightWord })
                }
                Text(block.nightNote, style = urbanist(12.sp), color = t.muted)
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Záťaž

/** Ratio axis of the load bar: 0.5 to 1.5, so Polar's thresholds 0.8, 1.0 and 1.3 split it 3 : 2 : 3 : 2. */
private const val LOAD_FROM = 0.5
private const val LOAD_SPAN = 1.0

@Composable
internal fun LoadPanel(block: LoadBlock) {
    val t = LocalZTokens.current
    ZPanel {
        Eyebrow("Záťaž")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(block.status, style = urbanist(30.sp, spacing = -0.02f, line = 1.1f), color = t.ink)
                Text(block.line, style = urbanist(13.sp), color = t.ink2)
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.padding(start = 12.dp)) {
                Text(block.vo2max, style = urbanist(24.sp, FontWeight.Medium, line = 1.1f), color = t.ink)
                Text("VO2max", style = urbanist(12.sp), color = t.muted)
            }
        }
        BoxWithConstraints(Modifier.fillMaxWidth().height(18.dp).semantics { contentDescription = block.description }) {
            val colors = listOf(t.track, mixOklab(t.accent, t.bg, 0.38f), mixOklab(t.accent, t.bg, 0.68f), mixOklab(t.heart, t.bg, 0.7f))
            val weights = listOf(3f, 2f, 3f, 2f)
            Row(Modifier.fillMaxWidth().height(8.dp).align(Alignment.Center), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                weights.forEachIndexed { i, w ->
                    val shape = when (i) {
                        0 -> RoundedCornerShape(topStart = 4.dp, bottomStart = 4.dp)
                        weights.lastIndex -> RoundedCornerShape(topEnd = 4.dp, bottomEnd = 4.dp)
                        else -> RoundedCornerShape(0.dp)
                    }
                    Box(Modifier.weight(w).fillMaxHeight().clip(shape).background(colors[i]))
                }
            }
            if (block.ratio != null) {
                val share = ((block.ratio - LOAD_FROM) / LOAD_SPAN).coerceIn(0.0, 1.0).toFloat()
                Box(
                    Modifier
                        .offset(x = (maxWidth - 3.dp) * share)
                        .width(3.dp)
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(2.dp))
                        .background(t.ink),
                )
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            listOf("oddych", "udržiavanie", "produktívna", "preťaženie").forEach {
                Text(it, style = urbanist(11.sp), color = t.muted)
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Tréningy

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun WorkoutsPanel(block: WorkoutsBlock) {
    val t = LocalZTokens.current
    ZPanel(gap = 6.dp) {
        Row(
            Modifier.fillMaxWidth().padding(bottom = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Eyebrow(block.title)
            if (block.summary != null) Text(block.summary, style = urbanist(13.sp), color = t.ink2)
        }
        if (block.rows.isEmpty()) {
            Text(block.empty, style = urbanist(14.sp), color = t.ink2, modifier = Modifier.fillMaxWidth().topRule(t.line).padding(vertical = 14.dp))
        }
        block.rows.forEach { row ->
            Column(
                Modifier.fillMaxWidth().topRule(t.line).padding(top = 14.dp, bottom = 6.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(row.type, style = urbanist(17.sp, FontWeight.SemiBold), color = t.ink, modifier = Modifier.alignByBaseline().weight(1f, fill = false))
                    Text(row.duration, style = urbanist(17.sp, FontWeight.Medium), color = t.ink, modifier = Modifier.alignByBaseline().padding(start = 12.dp))
                }
                ZoneBar(row.light, row.moderate, row.vigorous, height = 6.dp, contentDescription = row.zoneDescription)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    row.meta.forEach { Text(it, style = mono(12.sp), color = t.ink2) }
                }
            }
        }
    }
}
