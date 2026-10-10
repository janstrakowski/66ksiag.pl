package pl.ksiag.app.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import java.util.Locale

/** 1rem = 16px CSS = 16dp. Na mdpi 1dp = 1 piksel zrzutu. */
fun rem(n: Float): Dp = (n * 16f).dp

fun remSp(n: Float): TextUnit = (n * 16f).sp

private val polish = Locale.forLanguageTag("pl-PL")

fun plUpper(text: String): String = text.uppercase(polish)

fun cssText(
    family: FontFamily,
    sizeRem: Float,
    color: Color,
    weight: FontWeight = FontWeight.Normal,
    style: FontStyle = FontStyle.Normal,
    trackingEm: Float = 0f,
    lineHeightRatio: Float? = null,
    align: TextAlign = TextAlign.Center,
): TextStyle = TextStyle(
    fontFamily = family,
    fontWeight = weight,
    fontStyle = style,
    fontSize = remSp(sizeRem),
    letterSpacing = trackingEm.em,
    lineHeight = if (lineHeightRatio == null) TextUnit.Unspecified else remSp(sizeRem * lineHeightRatio),
    lineHeightStyle = LineHeightStyle(
        alignment = LineHeightStyle.Alignment.Proportional,
        trim = LineHeightStyle.Trim.None,
    ),
    platformStyle = PlatformTextStyle(includeFontPadding = false),
    color = color,
    textAlign = align,
)
