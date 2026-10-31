package pl.ksiag.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import pl.ksiag.app.KsiagModel
import pl.ksiag.app.Route
import pl.ksiag.app.model.copyFor
import pl.ksiag.app.model.toRoman

@Composable
fun KsiagRoot(model: KsiagModel) {
    val edition = model.edition
    val copy = copyFor(edition)
    KsiagTheme(kjv = edition?.language == "en") {
        BackHandler(enabled = model.canBack) { model.back() }
        Box(Modifier.fillMaxSize()) {
            when (val route = model.route) {
                Route.Pick -> PickScreen(copy) { model.selectEdition(it) }
                Route.Home -> HomeRoute(model, copy)
                Route.Books -> BooksScreen(
                    copy = copy,
                    books = model.books,
                    error = model.readerError,
                    onHome = { model.go(Route.Home) },
                    onBook = { model.openReader(it.id, 1, null) },
                )
                is Route.Read -> ReaderRoute(model, copy, route)
            }
            Column(Modifier.align(Alignment.BottomCenter)) {
                if (model.toast != null) ToastLine(model.toast!!)
                if (model.audioUi.visible) {
                    AudioStrip(
                        label = model.audioUi.label,
                        action = if (model.audioUi.playing) copy.audioPause else copy.audioResume,
                        onAction = { model.onBarToggle() },
                    )
                }
            }
            val confirm = model.confirm
            if (confirm != null) {
                ConfirmDialog(
                    title = confirm.title,
                    body = confirm.body,
                    ok = confirm.okLabel ?: copy.confirmOk,
                    cancel = confirm.cancelLabel ?: copy.confirmCancel,
                    onOk = confirm.onOk,
                    onCancel = { confirm.onCancel?.invoke() ?: model.dismissConfirm() },
                )
            }
        }
    }
}

@Composable
private fun HomeRoute(model: KsiagModel, copy: pl.ksiag.app.model.Copy) {
    val dl = model.download
    val complete = !dl.running && dl.catalog > 0 && dl.have >= dl.catalog
    val partial = dl.have > 0 && !complete
    val pct = if (dl.catalog == 0) 0 else (dl.have * 100 / dl.catalog)
    val label = when {
        dl.running || partial -> copy.audioDownloadProgress(
            dl.have,
            dl.catalog,
            pct,
            if (dl.running) dl.eta else null,
        )
        complete -> copy.audioDownloadDone(dl.catalog)
        else -> copy.audioDownloadHint
    }
    val downloadButton = when {
        dl.running -> copy.audioDownloadCancel
        partial -> copy.audioDownloadResume
        complete -> copy.audioDownloadDone(dl.catalog)
        else -> copy.audioDownload
    }
    val place = model.readingPlace()
    val placeBook = place?.let { p -> model.books.find { it.id == p.book } }
    val readMain = if (placeBook != null) copy.continueRead else copy.startRead
    val readSub = if (place != null && placeBook != null) "${placeBook.name} ${toRoman(place.chapter)}" else copy.startGenesis
    HomeScreen(
        copy = copy,
        readMain = readMain,
        readSub = readSub,
        showAudio = model.edition?.audio == true,
        downloadLabel = label,
        downloadButton = downloadButton,
        downloadEnabled = !complete,
        showMeter = dl.running && dl.catalog > 0,
        meterPct = if (dl.catalog == 0) 0 else (dl.have * 100 / dl.catalog),
        showClear = !dl.running && dl.have > 0,
        clearLabel = copy.audioClear,
        onRead = {
            if (place != null) model.openReader(place.book, place.chapter, null)
            else model.openReader("01-gen", 1, null)
        },
        onBooks = { model.go(Route.Books) },
        onChangeEdition = { model.changeEdition() },
        onDownload = {
            when {
                complete -> Unit
                dl.running -> model.cancelDownload()
                else -> model.startDownload()
            }
        },
        onClearAudio = { model.askClearAudio() },
        sourceName = copy.homeSourceName,
        onSource = { model.openSource() },
    )
}

@Composable
private fun ReaderRoute(model: KsiagModel, copy: pl.ksiag.app.model.Copy, route: Route.Read) {
    val reader = model.reader?.takeIf { it.book.id == route.bookId && it.chapter == route.chapter }
    val book = reader?.book
    val chapter = reader?.chapter ?: route.chapter
    val verses = reader?.text?.verses.orEmpty()
    val prev = if (book != null && chapter > 1) "← Cap. ${toRoman(chapter - 1)}" else null
    val next = when {
        book == null -> null
        chapter < book.chapters -> "Cap. ${toRoman(chapter + 1)} →"
        else -> {
            val i = model.books.indexOfFirst { it.id == book.id }
            val n = model.books.getOrNull(i + 1)
            if (n != null) "${n.short} →" else null
        }
    }
    ReaderScreen(
        copy = copy,
        editionShort = model.edition?.short ?: "",
        book = book,
        chapter = chapter,
        verses = verses,
        selected = model.selectedVerse,
        error = model.readerError,
        showAudio = model.edition?.audio == true,
        playing = model.audioUi.playing &&
            model.audioUi.visible &&
            model.audioUi.bookId == book?.id &&
            model.audioUi.chapter == chapter,
        paused = !model.audioUi.playing &&
            model.audioUi.visible &&
            model.audioUi.bookId == book?.id &&
            model.audioUi.chapter == chapter,
        spokenVerse = model.spokenVerse,
        spokenIndex = model.spokenIndex,
        onBack = { model.go(Route.Books) },
        onShare = { model.share() },
        onSelect = { model.selectVerse(it) },
        onPrev = { model.neighbor(-1) },
        onNext = { model.neighbor(1) },
        prevLabel = prev,
        nextLabel = next,
        onPlay = { model.onPlay() },
        onStop = { model.stopAudio() },
    )
}
