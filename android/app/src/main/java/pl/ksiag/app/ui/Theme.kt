package pl.ksiag.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import pl.ksiag.app.R

@Immutable
data class Palette(
    val paper: Color,
    val paperDeep: Color,
    val ink: Color,
    val ink2: Color,
    val faint: Color,
    val wash: Color,
    val fleuronAlpha: Float,
    val titleTracking: Float,
)

val BgPalette = Palette(
    paper = Color(0xFFE4D7BC),
    paperDeep = Color(0xFFCFC0A4),
    ink = Color(0xFF100C09),
    ink2 = Color(0xFF2C241D),
    faint = Color(0xFF5A4D40),
    wash = Color(0xFFEADEC8),
    fleuronAlpha = 1f,
    titleTracking = 0.14f,
)

val KjvPalette = Palette(
    paper = Color(0xFFE8DFC8),
    paperDeep = Color(0xFFC9B896),
    ink = Color(0xFF1A1510),
    ink2 = Color(0xFF3A3228),
    faint = Color(0xFF5A4D40),
    wash = Color(0xFFEADEC8),
    fleuronAlpha = 0.85f,
    titleTracking = 0.18f,
)

@Immutable
data class Fonts(
    val cardo: FontFamily,
    val cardoBold: FontFamily,
    val cinzel: FontFamily,
)

val LocalPalette = staticCompositionLocalOf { BgPalette }
val LocalFonts = staticCompositionLocalOf {
    Fonts(FontFamily.Serif, FontFamily.Serif, FontFamily.Serif)
}

@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
private fun cinzelFace(weight: FontWeight, axis: Int) = Font(
    R.font.cinzel,
    weight = weight,
    style = FontStyle.Normal,
    variationSettings = FontVariation.Settings(FontVariation.weight(axis)),
)

@Composable
fun rememberFonts(): Fonts {
    val cardo = FontFamily(
        Font(R.font.cardo_regular, FontWeight.Normal, FontStyle.Normal),
        Font(R.font.cardo_bold, FontWeight.Bold, FontStyle.Normal),
        Font(R.font.cardo_italic, FontWeight.Normal, FontStyle.Italic),
    )
    val cinzel = FontFamily(
        cinzelFace(FontWeight.Medium, 500),
        cinzelFace(FontWeight.SemiBold, 600),
        cinzelFace(FontWeight.Bold, 700),
    )
    return Fonts(cardo, cardo, cinzel)
}

@Composable
fun KsiagTheme(kjv: Boolean, content: @Composable () -> Unit) {
    val fonts = rememberFonts()
    CompositionLocalProvider(
        LocalPalette provides if (kjv) KjvPalette else BgPalette,
        LocalFonts provides fonts,
        content = content,
    )
}

fun mix(a: Color, b: Color, amountA: Float): Color = Color(
    red = a.red * amountA + b.red * (1f - amountA),
    green = a.green * amountA + b.green * (1f - amountA),
    blue = a.blue * amountA + b.blue * (1f - amountA),
    alpha = 1f,
)
