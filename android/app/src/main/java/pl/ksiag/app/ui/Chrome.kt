package pl.ksiag.app.ui

import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.RadialGradient
import android.graphics.Shader
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.Spacer
import com.caverock.androidsvg.SVG
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.Dp

@Composable
fun KsiagPage(
    center: Boolean,
    bottomReserve: Dp = 0.dp,
    banner: (@Composable () -> Unit)? = null,
    audioBar: (@Composable () -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val palette = LocalPalette.current
    Box(Modifier.fillMaxSize().background(palette.paperDeep)) {
        Paper(palette)
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val scroll = rememberScrollState()
            Column(
                Modifier
                    .align(Alignment.TopCenter)
                    .widthIn(max = rem(26f))
                    .fillMaxWidth()
                    .verticalScroll(scroll)
                    .heightIn(min = maxHeight)
                    .padding(
                        start = rem(0.55f),
                        end = rem(0.55f),
                        top = rem(0.55f),
                        bottom = rem(1.75f) + bottomReserve,
                    ),
                verticalArrangement = if (center) Arrangement.Center else Arrangement.Top,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                content()
            }
        }
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth()) {
            audioBar?.invoke()
            banner?.invoke()
        }
    }
}

@Composable
private fun Paper(palette: Palette) {
    Canvas(Modifier.fillMaxSize()) {
        // radial-gradient(ellipse at 50% 0%, wash 0%, paper-deep 62%), farthest-corner
        drawIntoCanvas { canvas ->
            val w = size.width
            val h = size.height
            // Chromium: elipsa farthest-corner ma proporcje farthest-side
            // i przechodzi przez najdalszy róg. Środek jest na górze.
            val sideX = maxOf(w / 2f, w / 2f)
            val sideY = maxOf(0f, h)
            val aspect = sideX / sideY
            val cornerX = w / 2f
            val cornerY = h
            val rx = sqrt(cornerX * cornerX + cornerY * cornerY * aspect * aspect)
            val ry = rx / aspect
            val shader = RadialGradient(
                w / 2f,
                0f,
                rx,
                intArrayOf(palette.wash.toArgb(), palette.paperDeep.toArgb(), palette.paperDeep.toArgb()),
                floatArrayOf(0f, 0.62f, 1f),
                Shader.TileMode.CLAMP,
            )
            val matrix = Matrix()
            matrix.setScale(1f, ry / rx, w / 2f, 0f)
            shader.setLocalMatrix(matrix)
            val paint = android.graphics.Paint().apply { this.shader = shader }
            canvas.nativeCanvas.drawRect(0f, 0f, w, h, paint)
        }
    }
}

fun DrawScope.drawHatch(ink: Color) {
    // repeating-linear-gradient(-42deg, transparent 0 1px, ink 1px 2px)
    // CSS: 0deg w górę, kąt rośnie zgodnie ze wskazówkami zegara.
    val theta = Math.toRadians(-42.0)
    val gx = sin(theta).toFloat()
    val gy = -cos(theta).toFloat()
    val px = -gy
    val py = gx
    val period = 2.dp.toPx()
    val band = 1.dp.toPx()
    val corners = arrayOf(
        0f to 0f,
        size.width to 0f,
        0f to size.height,
        size.width to size.height,
    )
    val origin = corners.minOf { (x, y) -> x * gx + y * gy }
    val far = corners.maxOf { (x, y) -> x * gx + y * gy }
    val reach = hypot(size.width, size.height)
    val argb = ink.copy(alpha = 0.11f).toArgb()
    drawIntoCanvas { canvas ->
        val paint = android.graphics.Paint().apply {
            isAntiAlias = false
            color = argb
            strokeWidth = band
            strokeCap = android.graphics.Paint.Cap.BUTT
        }
        var dist = band + band / 2f
        while (origin + dist < far + period) {
            val along = origin + dist
            val cx = gx * along
            val cy = gy * along
            canvas.nativeCanvas.drawLine(
                cx - px * reach,
                cy - py * reach,
                cx + px * reach,
                cy + py * reach,
                paint,
            )
            dist += period
        }
    }
}

fun Modifier.hatch(ink: Color): Modifier = drawBehind { drawHatch(ink) }

@Composable
fun Moulding(content: @Composable BoxScope.() -> Unit) {
    val ink = LocalPalette.current.ink
    val paper = LocalPalette.current.paper
    // Cień jest poza border-boxem: 1px atrament, 3px papier, 1px atrament.
    // W środku: 1px border, 3px padding, 1px moulding-inner.
    Box(
        Modifier
            .fillMaxWidth()
            .drawBehind {
                val px = 1.dp.toPx()
                fun ring(spread: Float, color: Color) {
                    drawRect(
                        color,
                        topLeft = Offset(-spread, -spread),
                        size = androidx.compose.ui.geometry.Size(size.width + spread * 2, size.height + spread * 2),
                    )
                }
                ring(5f * px, ink)
                ring(4f * px, paper)
                ring(px, ink)
            }
            .background(ink)
            .padding(1.dp)
            .background(paper)
            .padding(3.dp)
            .background(ink)
            .padding(1.dp)
            .background(paper)
            .clipToBounds(),
        content = content,
    )
}

@Composable
fun Underplate(pick: Boolean = false, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val p = LocalPalette.current
    val plate = mix(p.paper, Color.White, 0.88f)
    Column(
        modifier
            .fillMaxWidth()
            .background(plate)
            .hatch(p.ink)
            .padding(
                start = rem(0.85f),
                end = rem(0.85f),
                top = rem(if (pick) 1.1f else 1f),
                bottom = rem(if (pick) 1.15f else 1.05f),
            ),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        content()
    }
}

@Composable
fun Fleurons(bottom: Dp = rem(0.85f), modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val alpha = LocalPalette.current.fleuronAlpha
    val bitmap = remember {
        context.assets.open("orn-pair.png").use { BitmapFactory.decodeStream(it).asImageBitmap() }
    }
    BoxWithConstraints(modifier.fillMaxWidth().padding(bottom = bottom), contentAlignment = Alignment.Center) {
        val width = minOf(maxWidth * 0.96f, rem(19f))
        Image(
            bitmap = bitmap,
            contentDescription = null,
            modifier = Modifier.width(width),
            contentScale = ContentScale.FillWidth,
            alpha = alpha,
        )
    }
}

@Composable
fun Rules(pick: Boolean = false) {
    val ink = LocalPalette.current.ink
    val top = if (pick) rem(0.15f) else rem(0.6f)
    val bottom = if (pick) rem(0.75f) else rem(0.5f)
    Canvas(Modifier.padding(top = top, bottom = bottom).width(rem(7f)).height(6.dp)) {
        val hair = 1.dp.toPx()
        val mid = 1.25.dp.toPx()
        drawRect(ink, Offset(0f, -hair / 2f), androidx.compose.ui.geometry.Size(size.width, hair))
        drawRect(ink, Offset(0f, size.height / 2f - mid / 2f), androidx.compose.ui.geometry.Size(size.width, mid))
        drawRect(ink, Offset(0f, size.height - hair / 2f), androidx.compose.ui.geometry.Size(size.width, hair))
    }
}

@Composable
fun Tablet(
    main: String,
    sub: String? = null,
    ital: Boolean = false,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val p = LocalPalette.current
    val fonts = LocalFonts.current
    val interaction = remember { MutableInteractionSource() }
    val pressed = interaction.collectIsPressedAsState().value
    val bg = when {
        ital && pressed -> Color.Transparent
        pressed -> p.ink
        ital -> Color.Transparent
        else -> mix(p.paper, p.paperDeep, 0.7f)
    }
    val fg = if (!ital && pressed) p.paper else p.ink
    val ring = p.paper.copy(alpha = 0.8f)
    Column(
        modifier
            .fillMaxWidth()
            .alpha(if (enabled) 1f else 0.4f)
            .then(if (ital && pressed && enabled) Modifier.hatch(p.ink) else Modifier)
            .background(bg)
            .drawBehind {
                val px = 1.dp.toPx()
                fun frame(color: Color) {
                    drawRect(color, Offset(0f, 0f), androidx.compose.ui.geometry.Size(size.width, px))
                    drawRect(color, Offset(0f, size.height - px), androidx.compose.ui.geometry.Size(size.width, px))
                    drawRect(color, Offset(0f, 0f), androidx.compose.ui.geometry.Size(px, size.height))
                    drawRect(color, Offset(size.width - px, 0f), androidx.compose.ui.geometry.Size(px, size.height))
                }
                if (ital || pressed) {
                    if (!pressed) frame(p.ink)
                    return@drawBehind
                }
                // border 1px, potem 2px papieru nad atramentem cienia, potem 1px atramentu
                drawRect(p.ink)
                drawRect(ring, Offset(px, px), androidx.compose.ui.geometry.Size(size.width - 2 * px, size.height - 2 * px))
                drawRect(p.ink, Offset(3 * px, 3 * px), androidx.compose.ui.geometry.Size(size.width - 6 * px, size.height - 6 * px))
                drawRect(bg, Offset(4 * px, 4 * px), androidx.compose.ui.geometry.Size(size.width - 8 * px, size.height - 8 * px))
            }
            .then(
                if (enabled) {
                    Modifier.clickable(interactionSource = interaction, indication = null, onClick = onClick)
                } else {
                    Modifier
                },
            )
            .padding(horizontal = rem(0.5f), vertical = rem(0.7f)),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        androidx.compose.foundation.text.BasicText(
            text = if (ital) main else plUpper(main),
            style = if (ital) {
                cssText(fonts.cardo, 1.05f, fg, style = FontStyle.Italic, trackingEm = 0.02f, lineHeightRatio = 1.2f)
            } else {
                cssText(fonts.cinzel, 0.68f, fg, weight = FontWeight.SemiBold, trackingEm = 0.14f, lineHeightRatio = 1.2f)
            },
        )
        if (sub != null) {
            Spacer(Modifier.height(rem(0.28f)))
            androidx.compose.foundation.text.BasicText(
                text = sub,
                style = cssText(
                    fonts.cardo,
                    if (ital) 0.9f else 0.95f,
                    fg.copy(alpha = if (ital) 0.85f else 0.9f),
                    style = FontStyle.Italic,
                    trackingEm = 0.02f,
                ),
            )
        }
    }
}

@Composable
fun Linkish(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val fonts = LocalFonts.current
    androidx.compose.foundation.text.BasicText(
        text = text,
        modifier = modifier.clickable(onClick = onClick),
        style = cssText(
            fonts.cardo,
            0.92f,
            p.ink2,
            style = FontStyle.Italic,
            align = TextAlign.Start,
        ).copy(textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline),
    )
}

@Composable
fun TopBar(title: String, link: String, onLink: () -> Unit, extra: (@Composable () -> Unit)? = null) {
    val fonts = LocalFonts.current
    val p = LocalPalette.current
    Row(
        Modifier.fillMaxWidth().padding(bottom = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Bottom,
    ) {
        androidx.compose.foundation.text.BasicText(
            text = title.uppercase(),
            style = androidx.compose.ui.text.TextStyle(
                fontFamily = fonts.cinzel,
                fontWeight = FontWeight.SemiBold,
                fontSize = 10.9.sp,
                letterSpacing = 0.16.em,
                color = p.ink,
            ),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Bottom) {
            extra?.invoke()
            Linkish(link, onLink)
        }
    }
}

@Composable
fun Banner(text: String) {
    val p = LocalPalette.current
    val fonts = LocalFonts.current
    Box(Modifier.fillMaxWidth().background(p.ink).padding(vertical = 9.dp, horizontal = 12.dp)) {
        androidx.compose.foundation.text.BasicText(
            text = text.uppercase(),
            modifier = Modifier.align(Alignment.Center),
            style = androidx.compose.ui.text.TextStyle(
                fontFamily = fonts.cinzel,
                fontWeight = FontWeight.SemiBold,
                fontSize = 10.sp,
                letterSpacing = 0.08.em,
                color = p.paper,
                textAlign = TextAlign.Center,
            ),
        )
    }
}

@Composable
fun AudioStrip(label: String, action: String, onAction: () -> Unit) {
    val p = LocalPalette.current
    val fonts = LocalFonts.current
    Row(
        Modifier
            .fillMaxWidth()
            .background(mix(p.paperDeep, p.ink, 0.7f))
            .border(androidx.compose.foundation.BorderStroke(1.dp, p.ink))
            .padding(horizontal = 14.dp, vertical = 7.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        androidx.compose.foundation.text.BasicText(
            text = label.uppercase(),
            style = androidx.compose.ui.text.TextStyle(
                fontFamily = fonts.cinzel,
                fontSize = 10.sp,
                letterSpacing = 0.1.em,
                color = p.ink,
            ),
        )
        Linkish(action, onAction)
    }
}

@Composable
fun ToastLine(text: String) {
    val p = LocalPalette.current
    val fonts = LocalFonts.current
    Box(Modifier.fillMaxWidth().padding(bottom = 14.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.background(p.ink).padding(horizontal = 12.dp, vertical = 7.dp)) {
            androidx.compose.foundation.text.BasicText(
                text = text.uppercase(),
                style = androidx.compose.ui.text.TextStyle(
                    fontFamily = fonts.cinzel,
                    fontSize = 9.3.sp,
                    letterSpacing = 0.1.em,
                    color = p.paper,
                ),
            )
        }
    }
}
