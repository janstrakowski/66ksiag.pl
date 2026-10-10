package pl.ksiag.app.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.KeyboardCapitalization
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.Hyphens
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import pl.ksiag.app.model.Assignment
import pl.ksiag.app.model.Book
import pl.ksiag.app.model.Copy
import pl.ksiag.app.model.MarkUi
import pl.ksiag.app.model.Plan
import pl.ksiag.app.model.Verse
import pl.ksiag.app.model.estimateMinutesFromVerses
import pl.ksiag.app.model.quotaPreview
import pl.ksiag.app.model.toRoman

@Composable
fun PickScreen(copy: Copy, onPick: (String) -> Unit) {
    KsiagPage(center = true) {
        Moulding {
            Underplate(pick = true) {
                Fleurons(bottom = rem(0.35f))
                Rules(pick = true)
                Column(verticalArrangement = Arrangement.spacedBy(rem(0.4f))) {
                    Tablet(copy.pickBg, copy.pickBgHint) { onPick("bg-1879") }
                    Tablet(copy.pickKjv, copy.pickKjvHint, ital = true) { onPick("kjv-1769") }
                }
            }
        }
    }
}

@Composable
fun HomeScreen(
    copy: Copy,
    readMain: String,
    readSub: String,
    showPortion: Boolean,
    portionMain: String,
    portionSub: String,
    showAudio: Boolean,
    showContinue: Boolean,
    downloadLabel: String,
    downloadButton: String,
    downloadEnabled: Boolean,
    showMeter: Boolean,
    meterPct: Int,
    showClear: Boolean,
    clearLabel: String,
    onRead: () -> Unit,
    onPortion: () -> Unit,
    onBooks: () -> Unit,
    onPlan: () -> Unit,
    onSync: () -> Unit,
    onChangeEdition: () -> Unit,
    onContinue: () -> Unit,
    onDownload: () -> Unit,
    onClearAudio: () -> Unit,
    sourceName: String,
    onSource: () -> Unit,
) {
    KsiagPage(center = true) {
        Moulding {
            Underplate {
                Fleurons()
                Eyebrow(copy.homeEyebrow)
                Title(copy.homeTitle)
                Subtitle(copy.homeSub)
                Rules()
                Meta(copy.homeMeta)
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(rem(0.4f))) {
                    Tablet(readMain, readSub, onClick = onRead)
                    if (showPortion) Tablet(portionMain, portionSub, onClick = onPortion)
                    if (showContinue) Tablet(copy.audioContinueMain, copy.audioContinueSub, ital = true, onClick = onContinue)
                    if (showAudio) {
                        Tablet(
                            downloadButton,
                            ital = true,
                            enabled = downloadEnabled,
                            onClick = onDownload,
                        )
                        if (showMeter) AudioMeter(meterPct)
                        Hint(downloadLabel, faint = true)
                        if (showClear) Linkish(clearLabel, onClearAudio)
                    }
                    Tablet(copy.booksLink, ital = true, onClick = onBooks)
                    Tablet(copy.planLink, ital = true, onClick = onPlan)
                    Tablet(copy.syncLink, ital = true, onClick = onSync)
                    Linkish(copy.changeEdition, onChangeEdition, modifier = Modifier.padding(top = rem(0.35f)))
                }
            }
        }
        Colophon(copy.homeColophon, sourceName, onSource)
    }
}

@Composable
fun BooksScreen(copy: Copy, books: List<Book>, error: String?, onHome: () -> Unit, onBook: (Book) -> Unit) {
    val st = books.filter { it.testament == "st" }
    val nt = books.filter { it.testament == "nt" }
    KsiagPage(center = false) {
        TopBar(copy.index, copy.titleCard, onHome)
        Moulding {
            Column(Modifier.fillMaxWidth().background(LocalPalette.current.paper)) {
                Column(
                    Modifier.fillMaxWidth().hatch(LocalPalette.current.ink).padding(top = 11.dp, bottom = 9.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Fleurons(bottom = 0.dp)
                    Spacer(Modifier.height(6.dp))
                    BasicText(
                        copy.booksHeading.uppercase(),
                        style = cinzel(0.6f, 0.2f, LocalPalette.current.ink),
                    )
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(LocalPalette.current.ink))
                if (error != null && books.isEmpty()) {
                    Hint(error, Modifier.padding(16.dp))
                } else if (books.isEmpty()) {
                    Hint(copy.loadingBooks, Modifier.padding(16.dp))
                } else {
                    Testament(copy.testamentOt, st, onBook)
                    Testament(copy.testamentNt, nt, onBook)
                }
            }
        }
    }
}

@Composable
private fun Testament(label: String, books: List<Book>, onBook: (Book) -> Unit) {
    val p = LocalPalette.current
    val fonts = LocalFonts.current
    BasicText(
        label.uppercase(),
        modifier = Modifier.padding(start = 11.dp, top = 9.dp, bottom = 2.dp),
        style = cinzel(0.55f, 0.18f, p.faint),
    )
    books.forEachIndexed { i, b ->
        if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(p.ink.copy(alpha = 0.3f)))
        Row(
            Modifier
                .fillMaxWidth()
                .clickable { onBook(b) }
                .padding(horizontal = 11.dp, vertical = 10.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            BasicText(
                toRoman(b.id.take(2).toIntOrNull() ?: 0),
                modifier = Modifier.width(37.dp),
                style = cinzel(0.65f, 0.05f, p.faint),
            )
            BasicText(
                b.name,
                modifier = Modifier.weight(1f),
                style = TextStyle(fontFamily = fonts.cardo, fontSize = 17.6.sp, color = p.ink),
            )
            BasicText(
                b.short,
                style = TextStyle(fontFamily = fonts.cardo, fontStyle = FontStyle.Italic, fontSize = 17.6.sp, color = p.faint),
            )
        }
    }
}

@Composable
fun ReaderScreen(
    copy: Copy,
    editionShort: String,
    book: Book?,
    chapter: Int,
    verses: List<Verse>,
    selected: Int?,
    error: String?,
    mark: MarkUi,
    showAudio: Boolean,
    playing: Boolean,
    portion: Boolean,
    banner: String?,
    spokenVerse: Int?,
    spokenIndex: Int,
    onBack: () -> Unit,
    onPlan: () -> Unit,
    onShare: () -> Unit,
    onSelect: (Int) -> Unit,
    onMark: () -> Unit,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    prevLabel: String?,
    nextLabel: String?,
    onPlay: () -> Unit,
    onStop: () -> Unit,
) {
    val p = LocalPalette.current
    val fonts = LocalFonts.current
    KsiagPage(center = false, bottomReserve = 72.dp) {
        Row(
            Modifier.fillMaxWidth().padding(bottom = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom,
        ) {
            Linkish(if (portion) copy.backTitle else copy.backBooks, onBack)
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Linkish(copy.plan, onPlan)
                Linkish(copy.share, onShare)
            }
        }
        Moulding {
            Column(Modifier.fillMaxWidth().background(p.paper).padding(horizontal = 13.dp, vertical = 12.dp)) {
                if (error != null && book == null) {
                    Hint(error)
                } else if (book == null) {
                    Hint(copy.loading)
                } else {
                    Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), verticalAlignment = Alignment.Bottom) {
                        BasicText(copy.chapterAbbrev(toRoman(chapter)).uppercase(), Modifier.weight(1f), style = cinzel(0.56f, 0.12f, p.ink2))
                        BasicText(book.short.uppercase(), style = cinzel(0.56f, 0.18f, p.ink))
                        BasicText(
                            editionShort.uppercase(),
                            Modifier.weight(1f),
                            style = cinzel(0.56f, 0.12f, p.ink2).copy(textAlign = TextAlign.End),
                        )
                    }
                    Box(Modifier.fillMaxWidth().height(1.dp).background(p.ink))
                    Spacer(Modifier.height(12.dp))
                    BasicText(
                        "${copy.chapterWord} ${toRoman(chapter)}".uppercase(),
                        modifier = Modifier.fillMaxWidth(),
                        style = cinzel(1.05f, 0.14f, p.ink).copy(textAlign = TextAlign.Center, fontWeight = FontWeight.Bold),
                    )
                    BasicText(
                        book.name,
                        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                        style = TextStyle(
                            fontFamily = fonts.cardo,
                            fontStyle = FontStyle.Italic,
                            fontSize = 15.2.sp,
                            color = p.ink2,
                            textAlign = TextAlign.Center,
                        ),
                    )
                    val est = estimateMinutesFromVerses(verses)
                    BasicText(
                        "${copy.readingEta} · ${copy.etaMinutes(est.minutes)}".uppercase(),
                        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                        style = cinzel(0.58f, 0.14f, p.faint).copy(textAlign = TextAlign.Center),
                    )
                    if (!banner.isNullOrEmpty()) {
                        BasicText(
                            banner,
                            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                            style = TextStyle(
                                fontFamily = fonts.cardo,
                                fontStyle = FontStyle.Italic,
                                fontSize = 14.sp,
                                color = p.ink2,
                                textAlign = TextAlign.Center,
                            ),
                        )
                    }
                    if (showAudio) {
                        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally)) {
                            Box(Modifier.weight(1f, fill = false)) {
                                Tablet(copy.audioListen, onClick = onPlay)
                            }
                            if (playing) {
                                Box(Modifier.weight(1f, fill = false)) {
                                    Tablet(copy.audioStop, ital = true, onClick = onStop)
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    verses.forEach { v ->
                        val sel = selected == v.n
                        BasicText(
                            verseAnnotated(v, p, fonts, if (spokenVerse == v.n) spokenIndex else -1),
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 7.dp)
                                .then(if (sel) Modifier.border(1.dp, p.ink).hatch(p.ink) else Modifier)
                                .clickable { onSelect(v.n) }
                                .padding(horizontal = 2.dp, vertical = 2.dp),
                            style = TextStyle(
                                fontFamily = fonts.cardo,
                                fontSize = 17.3.sp,
                                lineHeight = 24.5.sp,
                                color = p.ink,
                                textAlign = TextAlign.Justify,
                                hyphens = Hyphens.Auto,
                            ),
                        )
                    }
                    if (portion) {
                        Spacer(Modifier.height(8.dp))
                        Tablet(copy.chapterDone, onClick = onMark)
                    } else if (!mark.hidden) {
                        val label = when {
                            mark.done -> copy.markedPlan
                            mark.extraAction -> copy.markExtra
                            else -> copy.markRead
                        }
                        Spacer(Modifier.height(8.dp))
                        if (mark.done) {
                            BasicText(
                                label,
                                modifier = Modifier.fillMaxWidth(),
                                style = TextStyle(
                                    fontFamily = fonts.cardo,
                                    fontStyle = FontStyle.Italic,
                                    fontSize = 16.sp,
                                    color = p.faint,
                                    textAlign = TextAlign.Center,
                                ),
                            )
                        } else {
                            Tablet(label, ital = mark.extraAction, onClick = onMark)
                        }
                    }
                    if (!portion) Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(Modifier.weight(1f)) {
                            if (prevLabel != null) Tablet(prevLabel, ital = true, onClick = onPrev)
                        }
                        Box(Modifier.weight(1f)) {
                            if (nextLabel != null) Tablet(nextLabel, ital = true, onClick = onNext)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun PlanScreen(
    copy: Copy,
    plan: Plan,
    books: List<Book>,
    notifyAllowed: Boolean,
    onHome: () -> Unit,
    onSave: (Plan) -> Unit,
    onRead: () -> Unit,
    onResetProgress: () -> Unit,
    onResetAll: () -> Unit,
    onNotifySettings: () -> Unit,
    continueMain: String,
    continueSub: String,
) {
    var draft by remember(plan) { mutableStateOf(plan) }
    val preview = quotaPreview(draft, copy.quotaChapters, copy.quotaTime)
    KsiagPage(center = false, bottomReserve = 48.dp) {
        TopBar(copy.plan, copy.titleCard, onHome)
        Moulding {
            Column(Modifier.fillMaxWidth().background(LocalPalette.current.paper)) {
                Box(Modifier.fillMaxWidth().hatch(LocalPalette.current.ink).padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                    BasicText(copy.dailyPlan.uppercase(), style = cinzel(0.6f, 0.2f, LocalPalette.current.ink))
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(LocalPalette.current.ink))
                Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    CheckRow(copy.enablePlan, draft.enabled) { draft = draft.copy(enabled = it) }
                    Fieldset(copy.goal) {
                        RadioRow(copy.wholeBible, draft.goal == "bible") { draft = draft.copy(goal = "bible") }
                        RadioRow(copy.oldTestament, draft.goal == "st") { draft = draft.copy(goal = "st") }
                        RadioRow(copy.newTestament, draft.goal == "nt") { draft = draft.copy(goal = "nt") }
                        RadioRow(copy.range, draft.goal == "range") { draft = draft.copy(goal = "range") }
                        if (draft.goal == "range") {
                            RangeRow(copy.from, books, draft.fromBook, draft.fromChapter, { draft = draft.copy(fromBook = it) }) {
                                draft = draft.copy(fromChapter = it)
                            }
                            RangeRow(copy.to, books, draft.toBook, draft.toChapter, { draft = draft.copy(toBook = it) }) {
                                draft = draft.copy(toChapter = it)
                            }
                        }
                    }
                    Fieldset(copy.daily) {
                        RadioRow(copy.byChapters, draft.mode == "chapters") { draft = draft.copy(mode = "chapters") }
                        if (draft.mode == "chapters") {
                            NumberRow(draft.chaptersPerDay, copy.chaptersUnit) { draft = draft.copy(chaptersPerDay = it) }
                        }
                        RadioRow(copy.byTime, draft.mode == "time") { draft = draft.copy(mode = "time") }
                        if (draft.mode == "time") {
                            NumberRow(draft.minutesPerDay, copy.minutesUnit) { draft = draft.copy(minutesPerDay = it) }
                        }
                        Hint(preview)
                        Hint(copy.timeHint, faint = true)
                    }
                    Fieldset(copy.notifications) {
                        RadioRow(copy.on, draft.notifications) { draft = draft.copy(notifications = true) }
                        RadioRow(copy.off, !draft.notifications) { draft = draft.copy(notifications = false) }
                        Hint(copy.notifyHint, faint = true)
                        if (draft.notifications && !notifyAllowed) {
                            Hint(copy.notifyDeniedHint)
                            Linkish(copy.notifySettings, onNotifySettings)
                        }
                    }
                    Tablet(copy.savePlan) { onSave(draft) }
                    Tablet(continueMain, continueSub, ital = true, onClick = onRead)
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(LocalPalette.current.ink.copy(alpha = 0.3f)))
                BasicText(
                    copy.reset.uppercase(),
                    modifier = Modifier.padding(start = 14.dp, top = 12.dp),
                    style = cinzel(0.55f, 0.18f, LocalPalette.current.faint),
                )
                Column(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Tablet(copy.resetProgress, ital = true, onClick = onResetProgress)
                    Hint(copy.resetProgressHint, faint = true)
                    Tablet(copy.resetAll, ital = true, onClick = onResetAll)
                    Hint(copy.resetAllHint, faint = true)
                }
            }
        }
    }
}

@Composable
fun SyncScreen(
    copy: Copy,
    enabled: Boolean,
    code: String,
    pairing: String,
    status: String,
    onHome: () -> Unit,
    onToggle: (Boolean) -> Unit,
    onCopy: () -> Unit,
    onNew: () -> Unit,
    onJoin: (String) -> Unit,
    onScan: () -> Unit,
) {
    var join by remember { mutableStateOf("") }
    val p = LocalPalette.current
    val fonts = LocalFonts.current
    KsiagPage(center = false) {
        TopBar(copy.syncNav, copy.titleCard, onHome)
        Moulding {
            Column(Modifier.fillMaxWidth().background(p.paper).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                BasicText(copy.cloudTitle.uppercase(), style = cinzel(0.62f, 0.16f, p.ink))
                Tablet(copy.cloudEnable, if (enabled) copy.on else copy.off) { onToggle(!enabled) }
                Hint(copy.cloudHint, faint = true)
                if (enabled && code.isNotEmpty()) {
                    Hint(copy.cloudKeep, faint = true)
                    BasicText(
                        code,
                        modifier = Modifier.fillMaxWidth(),
                        style = TextStyle(
                            fontFamily = fonts.cardo,
                            fontSize = 16.sp,
                            letterSpacing = 0.04.em,
                            color = p.ink,
                            textAlign = TextAlign.Center,
                        ),
                    )
                    QrMark(pairing, copy.cloudQr)
                    Tablet(copy.cloudCopy, ital = true, onClick = onCopy)
                    Tablet(copy.cloudNew, ital = true, onClick = onNew)
                    Hint(copy.cloudJoinLabel)
                    BasicTextField(
                        value = join,
                        onValueChange = { join = it },
                        modifier = Modifier.fillMaxWidth().border(1.dp, p.ink).padding(8.dp),
                        textStyle = TextStyle(fontFamily = fonts.cardo, fontSize = 16.sp, color = p.ink),
                        cursorBrush = SolidColor(p.ink),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                    )
                    Tablet(copy.cloudJoin) { onJoin(join) }
                    Tablet(copy.cloudScan, ital = true, onClick = onScan)
                    if (status.isNotEmpty()) Hint(status)
                }
            }
        }
    }
}

@Composable
private fun QrMark(text: String, description: String) {
    val p = LocalPalette.current
    val bitmap = remember(text, p.ink, p.paper) {
        val size = 512
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size)
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val fg = p.ink.toArgb()
        val bg = p.paper.toArgb()
        for (x in 0 until size) {
            for (y in 0 until size) bmp.setPixel(x, y, if (matrix.get(x, y)) fg else bg)
        }
        bmp.asImageBitmap()
    }
    Image(
        bitmap,
        contentDescription = description,
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        contentScale = ContentScale.FillWidth,
    )
}

@Composable
fun ConfirmDialog(title: String, body: String, ok: String, cancel: String, onOk: () -> Unit, onCancel: () -> Unit) {
    val p = LocalPalette.current
    Dialog(onDismissRequest = onCancel) {
        Box(Modifier.fillMaxWidth().background(p.ink.copy(alpha = 0.45f))) {
            Moulding {
                Column(Modifier.background(p.paper).padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    BasicText(title.uppercase(), style = cinzel(0.62f, 0.16f, p.ink).copy(textAlign = TextAlign.Center))
                    Spacer(Modifier.height(10.dp))
                    BasicText(
                        body,
                        style = TextStyle(fontFamily = LocalFonts.current.cardo, fontSize = 16.8.sp, lineHeight = 23.sp, color = p.ink2, textAlign = TextAlign.Center),
                    )
                    Spacer(Modifier.height(14.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(Modifier.weight(1f)) { Tablet(cancel, ital = true, onClick = onCancel) }
                        Box(Modifier.weight(1f)) { Tablet(ok, onClick = onOk) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Eyebrow(text: String) {
    BasicText(
        plUpper(text),
        style = cssText(
            LocalFonts.current.cinzel,
            0.58f,
            LocalPalette.current.ink,
            weight = FontWeight.SemiBold,
            trackingEm = 0.22f,
        ),
    )
}

@Composable
private fun Title(text: String) {
    val width = LocalConfiguration.current.screenWidthDp
    val sizeRem = (width * 0.055f / 16f).coerceIn(1.15f, 1.4f)
    BasicText(
        plUpper(text),
        modifier = Modifier.padding(top = rem(0.45f)),
        style = cssText(
            LocalFonts.current.cinzel,
            sizeRem,
            LocalPalette.current.ink,
            weight = FontWeight.Bold,
            trackingEm = LocalPalette.current.titleTracking,
            lineHeightRatio = 1.15f,
        ),
    )
}

@Composable
private fun Subtitle(text: String) {
    BasicText(
        text,
        modifier = Modifier.padding(top = rem(0.35f)),
        style = cssText(
            LocalFonts.current.cardo,
            1.02f,
            LocalPalette.current.ink2,
            style = FontStyle.Italic,
            lineHeightRatio = 1.35f,
        ),
    )
}

@Composable
private fun Meta(text: String) {
    BasicText(
        plUpper(text),
        modifier = Modifier.padding(bottom = rem(0.85f)),
        style = cssText(
            LocalFonts.current.cinzel,
            0.56f,
            LocalPalette.current.ink2,
            weight = FontWeight.SemiBold,
            trackingEm = 0.16f,
            lineHeightRatio = 1.5f,
        ),
    )
}

@Composable
private fun Colophon(text: String, sourceName: String, onSource: () -> Unit) {
    val style = cssText(
        LocalFonts.current.cardo,
        0.72f,
        LocalPalette.current.faint,
        style = FontStyle.Italic,
        lineHeightRatio = 1.35f,
    )
    if (sourceName.isEmpty()) {
        BasicText(text, modifier = Modifier.padding(start = rem(0.15f), end = rem(0.15f), top = rem(0.55f)), style = style)
        return
    }
    Row(Modifier.padding(start = rem(0.15f), end = rem(0.15f), top = rem(0.55f))) {
        BasicText("$text · ", style = style)
        BasicText(sourceName, modifier = Modifier.clickable(onClick = onSource), style = style.copy(textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline))
    }
}

@Composable
private fun AudioMeter(pct: Int) {
    val p = LocalPalette.current
    Box(
        Modifier
            .fillMaxWidth()
            .height(rem(0.45f))
            .border(1.dp, p.ink)
            .background(mix(p.paper, p.paperDeep, 0.7f)),
    ) {
        Box(
            Modifier
                .fillMaxHeight()
                .fillMaxWidth(pct.coerceIn(0, 100) / 100f)
                .background(p.ink),
        )
    }
}

@Composable
private fun Hint(text: String, modifier: Modifier = Modifier, faint: Boolean = false) {
    val p = LocalPalette.current
    BasicText(
        text,
        modifier = modifier,
        style = TextStyle(
            fontFamily = LocalFonts.current.cardo,
            fontStyle = FontStyle.Italic,
            fontSize = if (faint) 13.1.sp else 14.7.sp,
            lineHeight = 18.sp,
            color = if (faint) p.faint else p.ink2,
        ),
    )
}

@Composable
private fun Fieldset(legend: String, content: @Composable () -> Unit) {
    val p = LocalPalette.current
    Column(
        Modifier.fillMaxWidth().border(1.dp, p.ink.copy(alpha = 0.35f)).padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        BasicText(legend.uppercase(), style = cinzel(0.55f, 0.16f, p.ink))
        content()
    }
}

@Composable
private fun CheckRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val p = LocalPalette.current
    Row(
        Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .width(16.dp)
                .height(16.dp)
                .border(1.dp, p.ink)
                .background(if (checked) p.ink else Color.Transparent),
        )
        Spacer(Modifier.width(8.dp))
        BasicText(label, style = TextStyle(fontFamily = LocalFonts.current.cardo, fontSize = 16.sp, color = p.ink))
    }
}

@Composable
private fun RadioRow(label: String, selected: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.width(16.dp).height(16.dp).border(1.dp, p.ink),
            contentAlignment = Alignment.Center,
        ) {
            if (selected) Box(Modifier.width(8.dp).height(8.dp).background(p.ink))
        }
        Spacer(Modifier.width(8.dp))
        BasicText(label, style = TextStyle(fontFamily = LocalFonts.current.cardo, fontSize = 16.sp, color = p.ink))
    }
}

@Composable
private fun NumberRow(value: Int, unit: String, onChange: (Int) -> Unit) {
    val p = LocalPalette.current
    var text by remember(value) { mutableStateOf(value.toString()) }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
        BasicTextField(
            value = text,
            onValueChange = {
                text = it.filter { ch -> ch.isDigit() }.take(3)
                onChange(text.toIntOrNull() ?: 1)
            },
            textStyle = TextStyle(fontFamily = LocalFonts.current.cardo, fontSize = 16.sp, color = p.ink),
            cursorBrush = SolidColor(p.ink),
            keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
            modifier = Modifier.width(64.dp).border(1.dp, p.ink).background(mix(p.paper, Color.White, 0.7f)).padding(6.dp),
        )
        Spacer(Modifier.width(8.dp))
        BasicText(unit, style = TextStyle(fontFamily = LocalFonts.current.cardo, fontSize = 16.sp, color = p.ink))
    }
}

@Composable
private fun RangeRow(
    label: String,
    books: List<Book>,
    bookId: String,
    chapter: Int,
    onBook: (String) -> Unit,
    onChapter: (Int) -> Unit,
) {
    val p = LocalPalette.current
    var open by remember { mutableStateOf(false) }
    val short = books.find { it.id == bookId }?.short ?: bookId
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        BasicText(label, modifier = Modifier.width(36.dp), style = TextStyle(fontFamily = LocalFonts.current.cardo, fontSize = 15.sp, color = p.ink))
        BasicText(
            short,
            modifier = Modifier
                .weight(1f)
                .border(1.dp, p.ink)
                .background(mix(p.paper, Color.White, 0.7f))
                .clickable { open = true }
                .padding(6.dp),
            style = TextStyle(fontFamily = LocalFonts.current.cardo, fontSize = 16.sp, color = p.ink),
        )
        Spacer(Modifier.width(6.dp))
        var text by remember(chapter) { mutableStateOf(chapter.toString()) }
        BasicTextField(
            value = text,
            onValueChange = {
                text = it.filter { ch -> ch.isDigit() }.take(3)
                onChapter(text.toIntOrNull()?.coerceAtLeast(1) ?: 1)
            },
            textStyle = TextStyle(fontFamily = LocalFonts.current.cardo, fontSize = 16.sp, color = p.ink),
            cursorBrush = SolidColor(p.ink),
            keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
            modifier = Modifier.width(52.dp).border(1.dp, p.ink).background(mix(p.paper, Color.White, 0.7f)).padding(6.dp),
        )
    }
    if (open) {
        Dialog(onDismissRequest = { open = false }) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(p.paper)
                    .border(1.dp, p.ink)
                    .padding(8.dp),
            ) {
                books.forEach { b ->
                    BasicText(
                        b.short,
                        modifier = Modifier.fillMaxWidth().clickable {
                            onBook(b.id)
                            open = false
                        }.padding(vertical = 6.dp, horizontal = 8.dp),
                        style = TextStyle(fontFamily = LocalFonts.current.cardo, fontSize = 16.sp, color = p.ink),
                    )
                }
            }
        }
    }
}

private val spokenWord = Regex("[A-Za-z']+")

private fun verseAnnotated(verse: Verse, palette: Palette, fonts: Fonts, spokenIndex: Int = -1) = buildAnnotatedString {
    withStyle(
        SpanStyle(
            fontFamily = fonts.cinzel,
            fontWeight = FontWeight.SemiBold,
            fontSize = 8.8.sp,
            baselineShift = BaselineShift.Superscript,
            color = palette.faint,
            letterSpacing = 0.02.em,
        ),
    ) { append(verse.n.toString()) }
    append(" ")
    val raw = verse.t
    val re = Regex("(?i)</?i>")
    var i = 0
    var italic = false
    val word = intArrayOf(0)
    for (m in re.findAll(raw)) {
        appendStyled(raw.substring(i, m.range.first), italic, spokenIndex, word, palette)
        italic = !m.value.startsWith("</")
        i = m.range.last + 1
    }
    appendStyled(raw.substring(i), italic, spokenIndex, word, palette)
}

private fun androidx.compose.ui.text.AnnotatedString.Builder.appendStyled(
    text: String,
    italic: Boolean,
    spokenIndex: Int,
    word: IntArray,
    palette: Palette,
) {
    if (text.isEmpty()) return
    if (spokenIndex < 0) {
        writeRun(text, italic, false, palette)
        return
    }
    var last = 0
    for (m in spokenWord.findAll(text)) {
        writeRun(text.substring(last, m.range.first), italic, false, palette)
        writeRun(m.value, italic, word[0] == spokenIndex, palette)
        word[0] += 1
        last = m.range.last + 1
    }
    writeRun(text.substring(last), italic, false, palette)
}

private fun androidx.compose.ui.text.AnnotatedString.Builder.writeRun(
    text: String,
    italic: Boolean,
    spoken: Boolean,
    palette: Palette,
) {
    if (text.isEmpty()) return
    val style = SpanStyle(
        fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal,
        background = if (spoken) palette.ink.copy(alpha = 0.18f) else Color.Transparent,
    )
    withStyle(style) { append(text) }
}

@Composable
private fun cinzel(rem: Float, tracking: Float, color: Color): TextStyle {
    val fonts = LocalFonts.current
    return TextStyle(
        fontFamily = fonts.cinzel,
        fontWeight = FontWeight.SemiBold,
        fontSize = (rem * 16f).sp,
        letterSpacing = tracking.em,
        color = color,
    )
}
