package sk.zdravie.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import sk.zdravie.app.R

/** One variable Urbanist file (axis wght), instanced per weight; minSdk 26 supports variable fonts. */
val Urbanist = FontFamily(
    listOf(300, 400, 500, 600, 700).map { w ->
        Font(
            R.font.urbanist_variable,
            weight = FontWeight(w),
            variationSettings = FontVariation.Settings(FontVariation.weight(w)),
        )
    },
)

val DmMono = FontFamily(
    Font(R.font.dm_mono_regular, FontWeight.Normal),
    Font(R.font.dm_mono_medium, FontWeight.Medium),
)

/** Values copied from the artboard inline styles (px -> sp, letter-spacing in em). */
object ZType {
    val display = TextStyle(fontFamily = Urbanist, fontWeight = FontWeight.Light, fontSize = 92.sp, lineHeight = 83.sp, letterSpacing = (-0.05).em)
    val figureLarge = TextStyle(fontFamily = Urbanist, fontWeight = FontWeight.Light, fontSize = 58.sp, lineHeight = 58.sp, letterSpacing = (-0.045).em)
    val figure = TextStyle(fontFamily = Urbanist, fontWeight = FontWeight.Light, fontSize = 46.sp, lineHeight = 46.sp, letterSpacing = (-0.03).em)
    val title = TextStyle(fontFamily = Urbanist, fontWeight = FontWeight.Medium, fontSize = 34.sp, lineHeight = 37.sp, letterSpacing = (-0.02).em)
    val heading = TextStyle(fontFamily = Urbanist, fontWeight = FontWeight.Medium, fontSize = 22.sp, lineHeight = 28.sp)
    val body = TextStyle(fontFamily = Urbanist, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 21.sp)
    val label = TextStyle(fontFamily = Urbanist, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 18.sp)
    val caption = TextStyle(fontFamily = Urbanist, fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 17.sp)
    val eyebrow = TextStyle(fontFamily = DmMono, fontWeight = FontWeight.Normal, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.1.em)
    val time = TextStyle(fontFamily = DmMono, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 16.sp)
}

/** Maps the A2 styles onto Material so stock components and legacy screens pick up the fonts. */
internal fun zMaterialTypography(): Typography = Typography(
    displayLarge = ZType.display,
    displayMedium = ZType.figureLarge,
    displaySmall = ZType.figure,
    headlineLarge = ZType.title,
    headlineMedium = ZType.title.copy(fontSize = 28.sp, lineHeight = 32.sp),
    headlineSmall = ZType.heading,
    titleLarge = ZType.heading,
    titleMedium = ZType.label.copy(fontSize = 16.sp, lineHeight = 22.sp),
    titleSmall = ZType.label,
    bodyLarge = ZType.body.copy(fontSize = 16.sp, lineHeight = 23.sp),
    bodyMedium = ZType.body,
    bodySmall = ZType.caption,
    labelLarge = ZType.label,
    labelMedium = ZType.caption.copy(fontWeight = FontWeight.SemiBold, fontSize = 12.sp),
    labelSmall = ZType.eyebrow,
)
