package pl.ksiag.app.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import pl.ksiag.app.KsiagModel
import pl.ksiag.app.Route
import pl.ksiag.app.data.Cloud
import pl.ksiag.app.model.copyFor
import pl.ksiag.app.model.nextMarkTarget
import pl.ksiag.app.model.toRoman
import pl.ksiag.app.notify.Notifier

@Composable
fun KsiagRoot(model: KsiagModel) {
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        model.onNotifyPermission(it)
    }
    LaunchedEffect(model.askNotify) {
        if (!model.askNotify) return@LaunchedEffect
        model.askNotify = false
        if (Build.VERSION.SDK_INT >= 33) launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        else model.onNotifyPermission(true)
    }
    val edition = model.edition
    val copy = copyFor(edition)
    val scan = rememberLauncherForActivityResult(ScanContract()) { result ->
        val raw = result.contents
        if (!raw.isNullOrBlank()) model.joinCloud(raw)
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) {
            model.noteScanUnavailable()
            return@rememberLauncherForActivityResult
        }
        scan.launch(
            ScanOptions()
                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setBeepEnabled(false)
                .setPrompt(copy.cloudScan),
        )
    }
    LaunchedEffect(model.askScan) {
        if (!model.askScan) return@LaunchedEffect
        model.askScan = false
        camera.launch(Manifest.permission.CAMERA)
    }
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
                Route.Plan -> PlanRoute(model, copy)
                Route.Sync -> SyncRoute(model, copy)
                Route.Portion -> PortionRoute(model, copy)
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
    val asg = model.assignment()
    val session = model.session
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
    val finish = model.finishText()
    val portionSub = if (asg == null || asg.done) {
        finish.ifEmpty { copy.portionContinue }
    } else {
        listOf(
            if (asg.behind > 0) copy.behindToday(asg.behind, asg.pile - asg.behind) else "",
            if (asg.minutes > 0) copy.etaMinutes(asg.minutes) else "",
            asg.range.orEmpty(),
            finish,
        ).filter { it.isNotEmpty() }.joinToString(" · ")
    }
    HomeScreen(
        copy = copy,
        readMain = readMain,
        readSub = readSub,
        showPortion = model.plan.enabled,
        portionMain = if (asg == null || asg.done) copy.homePlanDone else copy.homePlan,
        portionSub = portionSub,
        showAudio = model.edition?.audio == true,
        showContinue = model.edition?.audio == true && session.offerContinue && session.nextBook != null,
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
        onPortion = { model.openPortion() },
        onBooks = { model.go(Route.Books) },
        onPlan = { model.go(Route.Plan) },
        onSync = { model.go(Route.Sync) },
        onChangeEdition = { model.changeEdition() },
        onContinue = { model.continueListening() },
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
private fun PlanRoute(model: KsiagModel, copy: pl.ksiag.app.model.Copy) {
    val asg = model.assignment()
    val next = nextMarkTarget(model.books, model.plan)
    val (main, sub) = when {
        model.plan.enabled && asg != null && !asg.done ->
            (if (asg.started) copy.continueRead else copy.startRead) to copy.minutesWithRange(asg.minutes, asg.range ?: "")
        model.plan.enabled && next != null -> copy.homePlanDone to copy.portionContinue
        else -> copy.startRead to copy.startGenesis
    }
    PlanScreen(
        copy = copy,
        plan = model.plan,
        books = model.books,
        notifyAllowed = Notifier.allowed(androidx.compose.ui.platform.LocalContext.current),
        statusLine = if (model.plan.enabled) model.portionLine() else "",
        onHome = { model.go(Route.Home) },
        onAppoint = { model.appointPlan(it) },
        onAbandon = { model.abandonPlan() },
        onNotifications = { model.setNotifications(it) },
        onRead = {
            if (model.plan.enabled) model.openPortion()
            else model.openReader("01-gen", 1, null)
        },
        onNotifySettings = { model.openNotifySettings() },
        continueMain = main,
        continueSub = sub,
    )
}

@Composable
private fun ReaderRoute(model: KsiagModel, copy: pl.ksiag.app.model.Copy, route: Route.Read) {
    val reader = model.reader?.takeIf { it.book.id == route.bookId && it.chapter == route.chapter }
    val book = reader?.book
    val chapter = reader?.chapter ?: route.chapter
    val verses = reader?.text?.verses.orEmpty()
    val mark = pl.ksiag.app.model.MarkUi(hidden = true)
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
        mark = mark,
        showAudio = model.edition?.audio == true,
        playing = model.audioUi.playing && model.audioUi.visible,
        portion = false,
        banner = null,
        spokenVerse = model.spokenVerse,
        spokenIndex = model.spokenIndex,
        onBack = { model.go(Route.Books) },
        onPlan = { model.go(Route.Plan) },
        onShare = { model.share() },
        onSelect = { model.selectVerse(it) },
        onMark = { model.markRead() },
        onPrev = { model.neighbor(-1) },
        onNext = { model.neighbor(1) },
        prevLabel = prev,
        nextLabel = next,
        onPlay = { model.onPlay() },
        onStop = { model.stopAudio() },
    )
}

@Composable
private fun PortionRoute(model: KsiagModel, copy: pl.ksiag.app.model.Copy) {
    val reader = model.reader
    val book = reader?.book
    val chapter = reader?.chapter ?: 1
    ReaderScreen(
        copy = copy,
        editionShort = model.edition?.short ?: "",
        book = book,
        chapter = chapter,
        verses = reader?.text?.verses.orEmpty(),
        selected = null,
        error = model.readerError,
        mark = pl.ksiag.app.model.MarkUi(hidden = true),
        showAudio = model.edition?.audio == true,
        playing = model.audioUi.playing && model.audioUi.visible,
        portion = true,
        banner = model.portionLine().ifEmpty { null },
        spokenVerse = model.spokenVerse,
        spokenIndex = model.spokenIndex,
        onBack = { model.go(Route.Home) },
        onPlan = { model.go(Route.Plan) },
        onShare = { model.share() },
        onSelect = { model.selectVerse(it) },
        onMark = { model.markPortion() },
        onPrev = {},
        onNext = {},
        prevLabel = null,
        nextLabel = null,
        onPlay = { model.onPlay() },
        onStop = { model.stopAudio() },
    )
}

@Composable
private fun SyncRoute(model: KsiagModel, copy: pl.ksiag.app.model.Copy) {
    val clipboard = LocalClipboardManager.current
    val token = model.cloud.token
    SyncScreen(
        copy = copy,
        enabled = model.cloud.enabled && token.isNotEmpty(),
        code = if (token.isEmpty()) "" else Cloud.formatToken(token),
        pairing = if (token.isEmpty()) "" else Cloud.pairingUrl(token),
        status = model.cloudMessage(model.cloudStatus),
        onHome = { model.go(Route.Home) },
        onToggle = { model.setCloudEnabled(it) },
        onCopy = {
            clipboard.setText(AnnotatedString(Cloud.formatToken(token)))
            model.noteCopied()
        },
        onNew = { model.askNewCloudCode() },
        onJoin = { model.joinCloud(it) },
        onScan = { model.askScan = true },
    )
}
