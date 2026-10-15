package pl.ksiag.app

import android.app.Application
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pl.ksiag.app.audio.AudioDownloadService
import pl.ksiag.app.audio.DownloadBus
import pl.ksiag.app.audio.DownloadState
import pl.ksiag.app.audio.PlaybackBus
import pl.ksiag.app.audio.PlaybackService
import pl.ksiag.app.data.AudioFiles
import pl.ksiag.app.data.AudioSession
import pl.ksiag.app.data.Cloud
import pl.ksiag.app.data.CloudState
import pl.ksiag.app.data.Repository
import pl.ksiag.app.data.Store
import pl.ksiag.app.model.Assignment
import pl.ksiag.app.model.Book
import pl.ksiag.app.model.ChapterText
import pl.ksiag.app.model.armed
import pl.ksiag.app.model.Edition
import pl.ksiag.app.model.ORIGIN
import pl.ksiag.app.model.Plan
import pl.ksiag.app.model.TimedWord
import pl.ksiag.app.model.isDailyPlanComplete
import pl.ksiag.app.model.pileStatus
import pl.ksiag.app.model.planFinishDate
import pl.ksiag.app.model.readingMinutes
import pl.ksiag.app.model.advanceCursor
import pl.ksiag.app.model.copyFor
import pl.ksiag.app.model.markChapterRead
import pl.ksiag.app.model.nextChapterInBible
import pl.ksiag.app.model.nextMarkTarget
import pl.ksiag.app.model.prevChapterInBible
import pl.ksiag.app.model.progressPct
import pl.ksiag.app.model.resolveBook
import pl.ksiag.app.model.stripTags
import pl.ksiag.app.model.todayAssignment
import pl.ksiag.app.model.toRoman
import pl.ksiag.app.model.wantsNotifications
import pl.ksiag.app.notify.Debt
import pl.ksiag.app.notify.Notifier
import pl.ksiag.app.notify.Reminders

sealed interface Route {
    data object Pick : Route
    data object Home : Route
    data object Books : Route
    data object Plan : Route
    data object Sync : Route
    data object Portion : Route
    data class Read(val bookId: String, val chapter: Int, val verse: Int?) : Route
}

data class ReaderState(val book: Book, val chapter: Int, val text: ChapterText)

data class AudioUi(
    val visible: Boolean = false,
    val playing: Boolean = false,
    val label: String = "",
    val bookId: String? = null,
    val chapter: Int? = null,
)

data class Confirm(
    val title: String,
    val body: String,
    val okLabel: String? = null,
    val cancelLabel: String? = null,
    val onCancel: (() -> Unit)? = null,
    val onOk: () -> Unit,
)

class KsiagModel(app: Application) : AndroidViewModel(app) {
    private val store = Store(app)
    private val repo = Repository(app)

    var route by mutableStateOf<Route>(Route.Pick)
        private set
    var stack by mutableStateOf<List<Route>>(emptyList())
        private set
    var edition by mutableStateOf<Edition?>(null)
        private set
    var books by mutableStateOf<List<Book>>(emptyList())
        private set
    var plan by mutableStateOf(Plan())
        private set
    var reader by mutableStateOf<ReaderState?>(null)
        private set
    var readerError by mutableStateOf<String?>(null)
        private set
    var selectedVerse by mutableStateOf<Int?>(null)
        private set
    var toast by mutableStateOf<String?>(null)
        private set
    var confirm by mutableStateOf<Confirm?>(null)
        private set
    var audioUi by mutableStateOf(AudioUi())
        private set
    var download by mutableStateOf(DownloadState())
        private set
    var askNotify by mutableStateOf(false)
    var askScan by mutableStateOf(false)
    var session by mutableStateOf(AudioSession())
        private set
    var cloud by mutableStateOf(CloudState())
        private set
    var cloudStatus by mutableStateOf("")
        private set
    var spokenVerse by mutableStateOf<Int?>(null)
        private set
    var spokenIndex by mutableStateOf(-1)
        private set

    private var pending: Route? = null
    private var pendingJoin: String? = null
    private var pendingPlan: Plan? = null
    private var pendingNotifyOnly = false
    private var controller: MediaController? = null
    private var playBook: String? = null
    private var playChapter: Int? = null
    private var audioMode: String = "idle"
    private var lastEndedId: String? = null
    private var readerGen = 0
    private var toastJob: Job? = null
    private var playRequested = false
    private var audioModePreset: String? = null
    private var pushJob: Job? = null
    private var wordJob: Job? = null
    private var lastPull = 0L
    private var spokenWords: List<TimedWord> = emptyList()

    val canBack: Boolean get() = stack.isNotEmpty()

    init {
        edition = store.edition()
        plan = store.plan()
        session = store.audioSession()
        cloud = store.cloud()
        route = if (edition == null) Route.Pick else Route.Home
        if (edition != null) refreshHome()
        if (plan.wantsNotifications()) Reminders.schedule(app)
        Debt.sync(app)
        viewModelScope.launch {
            DownloadBus.state.collectLatest { download = it }
        }
        viewModelScope.launch {
            PlaybackBus.skips.collectLatest { skip ->
                when (skip) {
                    PlaybackBus.Skip.Next -> skipChapter(1)
                    PlaybackBus.Skip.Previous -> skipChapter(-1)
                }
            }
        }
        connectPlayer()
    }

    fun openUri(uri: Uri?) {
        if (uri == null || uri.host != "66ksiag.pl") return
        uri.fragment?.let { frag -> if (Cloud.parseToken(frag) != null) pendingJoin = frag }
        val parts = uri.path.orEmpty().trim('/').split('/').filter { it.isNotEmpty() }
        val target: Route = when (parts.firstOrNull()) {
            null -> if (edition == null) Route.Pick else Route.Home
            "wybor", "choose" -> Route.Pick
            "ksiegi", "books" -> Route.Books
            "plan" -> Route.Plan
            "synchronizacja", "sync" -> Route.Sync
            "porcja", "portion" -> Route.Portion
            "czytaj" -> Route.Read(parts.getOrNull(1) ?: return, parts.getOrNull(2)?.toIntOrNull() ?: 1, parts.getOrNull(3)?.toIntOrNull())
            else -> {
                val ch = parts.getOrNull(1)?.toIntOrNull()
                if (ch == null) return
                Route.Read(parts[0], ch, parts.getOrNull(2)?.toIntOrNull())
            }
        }
        if (edition == null && target !is Route.Pick) {
            pending = target
            route = Route.Pick
            return
        }
        when (target) {
            Route.Pick -> changeEdition()
            Route.Home -> go(Route.Home, push = false)
            Route.Books -> go(Route.Books)
            Route.Plan -> go(Route.Plan)
            Route.Sync -> go(Route.Sync)
            Route.Portion -> openPortion()
            is Route.Read -> openReader(target.bookId, target.chapter, target.verse, push = false)
        }
        consumeJoin()
    }

    fun selectEdition(id: String) {
        val next = Edition.find(id) ?: return
        edition = next
        store.saveEdition(next)
        Debt.sync(getApplication())
        books = emptyList()
        reader = null
        stack = emptyList()
        val queued = pending
        pending = null
        route = Route.Home
        when (queued) {
            is Route.Read -> openReader(queued.bookId, queued.chapter, queued.verse, push = false)
            Route.Books -> go(Route.Books)
            Route.Plan -> go(Route.Plan)
            Route.Sync -> go(Route.Sync)
            Route.Portion -> openPortion()
            else -> refreshHome()
        }
        consumeJoin()
    }

    fun changeEdition() {
        edition = null
        books = emptyList()
        reader = null
        store.saveEdition(null)
        stack = emptyList()
        route = Route.Pick
    }

    fun go(next: Route, push: Boolean = true) {
        if (push && route != next) stack = stack + route
        route = next
        if (next == Route.Home) refreshHome()
        if (next == Route.Books || next == Route.Plan || next == Route.Sync) {
            viewModelScope.launch {
                try {
                    ensureBooks()
                    if (next == Route.Sync) pullCloud(force = true)
                } catch (e: Exception) {
                    readerError = e.message
                }
            }
        }
    }

    fun back() {
        val prev = stack.lastOrNull() ?: return
        stack = stack.dropLast(1)
        route = prev
        if (prev == Route.Home) refreshHome()
    }

    fun openReader(
        bookKey: String,
        chapter: Int,
        verse: Int?,
        push: Boolean = true,
        autoplay: Boolean = false,
        portion: Boolean = false,
    ) {
        if (portion) {
            if (push && route != Route.Portion) stack = stack + route
            route = Route.Portion
        } else {
            if (push && route !is Route.Read) stack = stack + route
            route = Route.Read(bookKey, chapter, verse)
        }
        val gen = ++readerGen
        val ed = edition ?: return
        viewModelScope.launch {
            val copy = copyFor(ed)
            try {
                val list = ensureBooks()
                val book = resolveBook(list, bookKey) ?: error(copy.unknownBook(bookKey))
                if (chapter < 1 || chapter > book.chapters) error(copy.missingChapter(chapter))
                val text = withContext(Dispatchers.IO) { repo.chapter(ed, book.id, chapter) }
                if (gen != readerGen) return@launch
                reader = ReaderState(book, chapter, text)
                readerError = null
                selectedVerse = if (portion) null else verse
                if (!portion) store.rememberPlace(ed.id, book.id, chapter)
                if (autoplay) startPlayback()
            } catch (e: Exception) {
                if (gen != readerGen) return@launch
                reader = null
                readerError = e.message ?: copy.loadFailed
            }
        }
    }

    fun selectVerse(n: Int) {
        selectedVerse = n
    }

    fun neighbor(delta: Int) {
        val r = reader ?: return
        val list = books
        val next = if (delta < 0) {
            prevChapterInBible(list, r.book.id, r.chapter)
        } else {
            nextChapterInBible(list, r.book.id, r.chapter)
        } ?: return
        openReader(next.book, next.chapter, null, push = false)
    }

    fun markRead() = markPortion()

    fun markPortion() {
        val r = reader ?: return
        if (books.isEmpty()) return
        val result = markChapterRead(plan, r.book.id, r.chapter, books, payDebt = true)
        if (result.kind == "already" || result.kind == "off" || result.kind == "skip") return
        persistMarked(advanceCursor(result.plan, books), result.kind)
        val owed = plan.owed
        if (owed != null && owed <= 0 && !plan.beyond) {
            askBeyondPortion()
            return
        }
        openPortion(push = false)
    }

    fun openPortion(push: Boolean = true) {
        viewModelScope.launch {
            val list = try {
                ensureBooks()
            } catch (_: Exception) {
                return@launch
            }
            if (!plan.enabled) {
                go(Route.Home, push = false)
                return@launch
            }
            if (plan.owed != null && plan.owed!! <= 0 && !plan.beyond) {
                askBeyondPortion()
                return@launch
            }
            val target = nextMarkTarget(list, plan)
            if (target == null) {
                go(Route.Home, push = false)
                return@launch
            }
            openReader(target.book, target.chapter, null, push = push, portion = true)
        }
    }

    fun readingPlace() = edition?.id?.let { store.place(it) }

    fun portionLine(): String {
        if (books.isEmpty()) return ""
        val copy = copyFor(edition)
        val finish = planFinishDate(books, plan)
        val finishText = if (finish == null) "" else copy.planFinish(finish.dayOfMonth, finish.monthValue - 1, finish.year)
        if (plan.beyond) return listOf(copy.beyondPlan, finishText).filter { it.isNotEmpty() }.joinToString(" · ")
        val st = pileStatus(plan)
        if (st.owed <= 0) return ""
        val mins = readingMinutes(st.owed, plan)
        return listOf(
            copy.pileProgress(st.done, st.pile),
            if (st.behind > 0) copy.behindToday(st.behind, st.quota) else "",
            if (mins != null) copy.etaMinutes(mins) else "",
            finishText,
        ).filter { it.isNotEmpty() }.joinToString(" · ")
    }

    fun finishText(): String {
        val finish = planFinishDate(books, plan) ?: return ""
        return copyFor(edition).planFinish(finish.dayOfMonth, finish.monthValue - 1, finish.year)
    }

    fun setCloudEnabled(on: Boolean) {
        viewModelScope.launch {
            if (!on) {
                pushJob?.cancel()
                Cloud.disable(store)
                cloud = store.cloud()
                cloudStatus = ""
                return@launch
            }
            val code = withContext(Dispatchers.IO) { Cloud.enable(store) }
            cloud = store.cloud()
            cloudStatus = code
            if (code == "on") pullCloud(force = true)
            val text = cloudMessage(code)
            if (text.isNotEmpty()) flash(text)
        }
    }

    fun askNewCloudCode() {
        val copy = copyFor(edition)
        confirm = Confirm(copy.cloudNewTitle, copy.cloudNewBody) {
            confirm = null
            viewModelScope.launch {
                val code = withContext(Dispatchers.IO) { Cloud.rotate(store) }
                cloud = store.cloud()
                cloudStatus = code
                val text = cloudMessage(code)
                if (text.isNotEmpty()) flash(text)
            }
        }
    }

    fun joinCloud(raw: String) {
        viewModelScope.launch {
            val list = try {
                ensureBooks()
            } catch (_: Exception) {
                cloudStatus = "offline"
                return@launch
            }
            val code = withContext(Dispatchers.IO) { Cloud.join(store, raw, list) }
            plan = store.plan()
            cloud = store.cloud()
            cloudStatus = code
            Debt.sync(getApplication())
            val text = cloudMessage(code)
            if (text.isNotEmpty()) flash(text)
        }
    }

    fun cloudMessage(code: String): String {
        val copy = copyFor(edition)
        return when (code) {
            "saved", "remote", "local", "same" -> copy.cloudStatusSaved
            "joined" -> copy.cloudStatusJoined
            "uploaded" -> copy.cloudStatusUploaded
            "offline" -> copy.cloudStatusOffline
            "bad" -> copy.cloudStatusBad
            "error" -> copy.cloudStatusError
            else -> ""
        }
    }

    fun noteScanUnavailable() = flash(copyFor(edition).cloudScanUnavailable)

    fun noteCopied() = flash(copyFor(edition).cloudCopied)

    fun openSource() {
        val url = copyFor(edition).homeSourceUrl
        if (url.isEmpty()) return
        getApplication<Application>().startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    fun appointPlan(draft: Plan) {
        val copy = copyFor(edition)
        if (plan.notifications) {
            commitAppointed(draft, notifications = true)
            return
        }
        confirm = Confirm(
            title = copy.notifyOfferTitle,
            body = copy.notifyOfferBody,
            okLabel = copy.notifyOfferYes,
            cancelLabel = copy.notifyOfferNo,
            onCancel = {
                confirm = null
                commitAppointed(draft, notifications = false)
            },
        ) {
            confirm = null
            commitAppointed(draft, notifications = true)
        }
    }

    fun abandonPlan() {
        val copy = copyFor(edition)
        confirm = Confirm(
            title = copy.abandonTitle,
            body = copy.abandonBody,
            okLabel = copy.abandonPlan,
        ) {
            confirm = null
            val next = plan.copy(enabled = false).armed()
            plan = next
            store.savePlan(next)
            Reminders.sync(getApplication(), false)
            Debt.sync(getApplication())
            scheduleCloudPush()
            flash(copy.planDisabled)
        }
    }

    /** Przełącznik powiadomień, niezależny od Ustaw. Ta sama flaga co pytanie przy ustawianiu. */
    fun setNotifications(on: Boolean) {
        if (plan.notifications == on) return
        if (!on) {
            persistNotifications(on = false, granted = true)
            return
        }
        if (!Notifier.allowed(getApplication())) {
            pendingNotifyOnly = true
            val next = plan.copy(notifications = true)
            pendingPlan = next
            plan = next
            store.savePlan(next)
            Reminders.sync(getApplication(), next.wantsNotifications())
            Debt.sync(getApplication())
            scheduleCloudPush()
            askNotify = true
            return
        }
        persistNotifications(on = true, granted = true)
    }

    fun onNotifyPermission(granted: Boolean) {
        val draft = pendingPlan ?: return
        val notifyOnly = pendingNotifyOnly
        pendingPlan = null
        pendingNotifyOnly = false
        if (notifyOnly) {
            persistNotifications(on = true, granted = granted)
            return
        }
        commitPlan(draft, granted, appoint = true)
    }

    private fun commitAppointed(draft: Plan, notifications: Boolean) {
        val next = draft.copy(enabled = true, notifications = notifications)
        if (notifications && !Notifier.allowed(getApplication())) {
            pendingNotifyOnly = false
            pendingPlan = next
            askNotify = true
            return
        }
        commitPlan(next, granted = !notifications || Notifier.allowed(getApplication()), appoint = true)
    }

    private fun persistNotifications(on: Boolean, granted: Boolean) {
        val copy = copyFor(edition)
        var next = plan.copy(notifications = on)
        if (on && granted) next = next.copy(startNotifiedDay = null)
        plan = next
        store.savePlan(next)
        Reminders.sync(getApplication(), next.wantsNotifications())
        Debt.sync(getApplication())
        scheduleCloudPush()
        if (!on) return
        if (!granted) flash(copy.notifyDeniedFlash)
        else flash(if (Notifier.allowed(getApplication())) copy.notifyEnabledFlash else copy.notifyFailedFlash)
    }

    fun dismissConfirm() {
        confirm = null
    }

    fun share() {
        val r = reader ?: return
        val ed = edition ?: return
        val n = selectedVerse ?: r.text.verses.firstOrNull()?.n ?: return
        val verse = r.text.verses.find { it.n == n } ?: return
        val alias = r.book.aliases.firstOrNull() ?: r.book.short.lowercase()
        val path = "/$alias/${r.chapter}/$n"
        val text = "${r.book.short} ${r.chapter},$n (${ed.short})\n${stripTags(verse.t)}\n$ORIGIN$path"
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
        getApplication<Application>().startActivity(
            Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    fun onPlay() {
        val c = controller
        val r = reader
        if (c != null && r != null && playBook == r.book.id && playChapter == r.chapter &&
            c.playbackState != Player.STATE_IDLE && c.playbackState != Player.STATE_ENDED
        ) {
            if (c.isPlaying) c.pause() else c.play()
            return
        }
        if (c == null) {
            playRequested = true
            return
        }
        startPlayback()
    }

    fun onBarToggle() {
        val c = controller ?: return
        if (c.isPlaying) c.pause() else c.play()
    }

    /** Lock-screen / notification next·previous chapter. */
    private fun skipChapter(delta: Int) {
        val bookId = playBook ?: reader?.book?.id ?: return
        val chapter = playChapter ?: reader?.chapter ?: return
        viewModelScope.launch {
            val list = try {
                ensureBooks()
            } catch (_: Exception) {
                return@launch
            }
            val next = if (delta < 0) {
                prevChapterInBible(list, bookId, chapter)
            } else {
                nextChapterInBible(list, bookId, chapter)
            } ?: return@launch
            if (audioMode == "idle") audioModePreset = "single"
            else audioModePreset = audioMode
            val portion = route == Route.Portion || audioMode == "plan" || audioMode == "portion"
            openReader(next.book, next.chapter, null, push = false, autoplay = true, portion = portion)
        }
    }

    fun continueListening() {
        val s = session
        val book = s.nextBook ?: return
        val ch = s.nextChapter ?: return
        session = AudioSession()
        store.saveAudioSession(session)
        audioModePreset = "beyond"
        openReader(book, ch, null, push = true, autoplay = true)
    }

    fun startDownload() {
        AudioDownloadService.start(getApplication())
    }

    fun cancelDownload() {
        AudioDownloadService.cancel(getApplication())
    }

    fun askClearAudio() {
        val copy = copyFor(edition)
        confirm = Confirm(copy.audioClear, copy.audioClear) {
            confirm = null
            AudioFiles.clear(getApplication())
            if (!download.running) {
                download = download.copy(have = 0)
                DownloadBus.state.value = download
            }
            flash(copy.audioCleared)
        }
    }

    fun openNotifySettings() {
        Notifier.settings(getApplication())
    }

    fun assignment(): Assignment? {
        val list = books
        if (!plan.enabled || list.isEmpty()) return null
        return todayAssignment(list, plan, ::toRoman)
    }

    private fun commitPlan(draft: Plan, granted: Boolean, appoint: Boolean = false) {
        val copy = copyFor(edition)
        val wasOn = plan.notifications
        var next = plan.copy(
            enabled = draft.enabled,
            goal = draft.goal,
            mode = draft.mode,
            fromBook = draft.fromBook,
            toBook = draft.toBook,
            fromChapter = draft.fromChapter,
            toChapter = draft.toChapter,
            chaptersPerDay = draft.chaptersPerDay,
            minutesPerDay = draft.minutesPerDay,
            notifications = draft.notifications,
        ).armed()
        val turnedOn = next.notifications && granted && !wasOn
        if (next.notifications && granted) next = next.copy(startNotifiedDay = null)
        plan = next
        store.savePlan(next)
        Reminders.sync(getApplication(), next.wantsNotifications())
        Debt.sync(getApplication())
        scheduleCloudPush()
        when {
            next.notifications && !granted -> flash(copy.notifyDeniedFlash)
            turnedOn && next.enabled ->
                flash(if (Notifier.allowed(getApplication())) copy.notifyEnabledFlash else copy.notifyFailedFlash)
            appoint && next.enabled ->
                flash(copy.planSaved(pl.ksiag.app.model.quotaPreview(next, copy.quotaChapters, copy.quotaTime)))
            !next.enabled -> flash(copy.planDisabled)
        }
    }

    private fun refreshHome() {
        viewModelScope.launch {
            try {
                ensureBooks()
                plan = store.plan()
                Debt.sync(getApplication())
                pullCloud()
            } catch (_: Exception) {
            }
            if (edition?.audio == true && !DownloadBus.state.value.running) {
                val have = withContext(Dispatchers.IO) { AudioFiles.count(getApplication()) }
                val catalog = withContext(Dispatchers.IO) { repo.cachedCatalog()?.size ?: 0 }
                download = DownloadState(have = have, catalog = catalog)
                DownloadBus.state.value = download
            }
            session = store.audioSession()
        }
    }

    private suspend fun ensureBooks(): List<Book> {
        if (books.isNotEmpty()) return books
        val ed = edition ?: return emptyList()
        val list = withContext(Dispatchers.IO) { repo.books(ed) }
        books = list
        return list
    }

    private fun connectPlayer() {
        val app = getApplication<Application>()
        val token = SessionToken(app, ComponentName(app, PlaybackService::class.java))
        val future = MediaController.Builder(app, token).buildAsync()
        future.addListener(
            {
                val c = try {
                    future.get()
                } catch (_: Exception) {
                    null
                } ?: return@addListener
                controller = c
                c.addListener(object : Player.Listener {
                    override fun onIsPlayingChanged(isPlaying: Boolean) = syncAudio()
                    override fun onPlaybackStateChanged(playbackState: Int) {
                        syncAudio()
                        if (playbackState == Player.STATE_ENDED) onAudioEnded()
                    }

                    override fun onPlayerError(error: PlaybackException) {
                        flash(copyFor(edition).audioUnavailable)
                        syncAudio()
                    }
                })
                if (playRequested) {
                    playRequested = false
                    startPlayback()
                }
            },
            ContextCompat.getMainExecutor(app),
        )
    }

    private fun startPlayback() {
        val r = reader ?: return
        val ed = edition ?: return
        if (!ed.audio) return
        val c = controller ?: run {
            playRequested = true
            return
        }
        viewModelScope.launch {
            val local = AudioFiles.file(getApplication(), r.book.id, r.chapter)
            val hasLocal = withContext(Dispatchers.IO) { local.exists() && local.length() > 1000 }
            val inCatalog = if (hasLocal) true else withContext(Dispatchers.IO) {
                try {
                    (repo.cachedCatalog() ?: repo.catalog()).any { it.book == r.book.id && it.chapter == r.chapter }
                } catch (_: Exception) {
                    false
                }
            }
            if (!inCatalog) {
                audioModePreset = null
                flash(copyFor(edition).audioUnavailable)
                return@launch
            }
            audioMode = audioModePreset ?: when {
                route == Route.Portion && (plan.beyond || isDailyPlanComplete(plan)) -> "portion"
                route == Route.Portion -> "plan"
                else -> "single"
            }
            audioModePreset = null
            if (audioMode == "plan") {
                session = AudioSession()
                store.saveAudioSession(session)
            }
            lastEndedId = null
            trackWords(ed, r.book.id, r.chapter)
            playBook = r.book.id
            playChapter = r.chapter
            val uri = if (hasLocal) Uri.fromFile(local) else Uri.parse("$ORIGIN${ed.path}/${r.book.id}/${r.chapter}.mp3")
            val item = MediaItem.Builder()
                .setUri(uri)
                .setMediaId("${r.book.id}/${r.chapter}")
                .setMediaMetadata(
                    MediaMetadata.Builder()
                        .setTitle("${r.book.short} ${r.chapter}")
                        .setArtist("Alexander Scourby")
                        .build(),
                )
                .build()
            c.setMediaItem(item)
            c.prepare()
            c.play()
            syncAudio()
        }
    }

    private fun onAudioEnded() {
        val bookId = playBook ?: return
        val chapter = playChapter ?: return
        val id = "$bookId/$chapter"
        if (id == lastEndedId) return
        lastEndedId = id
        viewModelScope.launch {
            val endedMode = audioMode
            creditFromAudio(bookId, chapter, payDebt = endedMode == "plan" || endedMode == "portion")
            val list = try {
                ensureBooks()
            } catch (_: Exception) {
                return@launch
            }
            if (endedMode == "portion" && plan.enabled) {
                val next = nextMarkTarget(list, plan)
                if (next != null) {
                    openReader(next.book, next.chapter, null, push = false, autoplay = true, portion = true)
                    return@launch
                }
                stopAudio()
                return@launch
            }
            val copy = copyFor(edition)
            if (endedMode == "plan" && plan.enabled) {
                if (isDailyPlanComplete(plan)) {
                    val next = nextChapterInBible(list, bookId, chapter)
                    session = AudioSession(offerContinue = next != null, nextBook = next?.book, nextChapter = next?.chapter)
                    store.saveAudioSession(session)
                    audioMode = "idle"
                    stopAudio()
                    flash(copy.audioSessionEnded)
                    return@launch
                }
                val next = nextMarkTarget(list, plan)
                if (next != null) {
                    openReader(next.book, next.chapter, null, push = false, autoplay = true, portion = true)
                    return@launch
                }
            }
            if (endedMode == "single" || endedMode == "beyond" || (endedMode == "plan" && !plan.enabled)) {
                val next = nextChapterInBible(list, bookId, chapter)
                if (next != null) {
                    openReader(next.book, next.chapter, null, push = false, autoplay = true)
                    return@launch
                }
                session = AudioSession()
                store.saveAudioSession(session)
                audioMode = "idle"
                stopAudio()
                flash(copy.audioBibleEnded)
                return@launch
            }
            stopAudio()
        }
    }

    private fun creditFromAudio(bookId: String, chapter: Int, payDebt: Boolean) {
        if (books.isEmpty()) return
        val result = markChapterRead(plan, bookId, chapter, books, payDebt = payDebt)
        if (result.kind == "already" || result.kind == "off" || result.kind == "skip") return
        persistMarked(advanceCursor(result.plan, books), result.kind)
    }

    fun stopAudio() {
        audioMode = "idle"
        playBook = null
        playChapter = null
        controller?.stop()
        controller?.clearMediaItems()
        wordJob?.cancel()
        spokenWords = emptyList()
        spokenVerse = null
        spokenIndex = -1
        syncAudio()
    }

    private fun syncAudio() {
        val c = controller
        val active = playBook != null && c != null &&
            c.playbackState != Player.STATE_IDLE && c.playbackState != Player.STATE_ENDED
        val copy = copyFor(edition)
        audioUi = AudioUi(
            visible = active && edition?.audio == true,
            playing = c?.isPlaying == true,
            label = if (c?.isPlaying == true) copy.audioBarListening else copy.audioBarPaused,
            bookId = playBook,
            chapter = playChapter,
        )
    }

    private fun flash(msg: String) {
        toast = msg
        toastJob?.cancel()
        toastJob = viewModelScope.launch {
            delay(2200)
            if (toast == msg) toast = null
        }
    }

    private fun persistMarked(next: Plan, kind: String) {
        plan = next
        store.savePlan(next)
        val copy = copyFor(edition)
        val pct = progressPct(plan)
        if (kind == "extra") flash(copy.beyondPlan)
        else {
            Debt.sync(getApplication())
            if (pct != null && pct >= 100) flash(copy.planFinished) else if (pct != null) flash(copy.planPct(pct))
        }
        scheduleCloudPush()
    }

    private fun askBeyondPortion() {
        val copy = copyFor(edition)
        confirm = Confirm(
            title = copy.portionDoneTitle,
            body = copy.portionDoneBody,
            okLabel = copy.portionContinue,
            cancelLabel = copy.portionHome,
            onCancel = {
                confirm = null
                go(Route.Home, push = false)
            },
        ) {
            confirm = null
            plan = plan.copy(beyond = true)
            store.savePlan(plan)
            scheduleCloudPush()
            openPortion(push = false)
        }
    }

    private fun scheduleCloudPush() {
        val state = store.cloud()
        if (state.token.isEmpty()) return
        store.saveCloud(state.copy(updatedMin = Cloud.bumpUpdated(state.updatedMin)))
        cloud = store.cloud()
        if (!cloud.enabled) return
        pushJob?.cancel()
        pushJob = viewModelScope.launch {
            delay(400)
            val code = withContext(Dispatchers.IO) { Cloud.pushNow(store) }
            cloudStatus = code
        }
    }

    private fun pullCloud(force: Boolean = false) {
        val state = store.cloud()
        if (!state.enabled || state.token.isEmpty()) return
        val now = System.currentTimeMillis()
        if (!force && now - lastPull < 15_000) return
        lastPull = now
        viewModelScope.launch {
            val list = try {
                ensureBooks()
            } catch (_: Exception) {
                lastPull = 0
                return@launch
            }
            val code = withContext(Dispatchers.IO) { Cloud.pull(store, list) }
            if (code == "remote") {
                plan = store.plan()
                Debt.sync(getApplication())
            }
            cloud = store.cloud()
            if (code == "offline" || code == "error" || code == "bad") cloudStatus = code
            else if (code == "saved" || code == "uploaded" || code == "remote") cloudStatus = code
        }
    }

    private fun consumeJoin() {
        val raw = pendingJoin ?: return
        if (edition == null) return
        pendingJoin = null
        joinCloud(raw)
    }

    private fun trackWords(ed: pl.ksiag.app.model.Edition, bookId: String, chapter: Int) {
        wordJob?.cancel()
        spokenVerse = null
        spokenIndex = -1
        spokenWords = emptyList()
        wordJob = viewModelScope.launch {
            spokenWords = withContext(Dispatchers.IO) { repo.words(ed, bookId, chapter) }
            while (true) {
                val c = controller
                if (c == null || playBook != bookId) break
                val t = c.currentPosition / 1000.0
                val hit = spokenAt(spokenWords, t)
                spokenVerse = hit?.first
                spokenIndex = hit?.second ?: -1
                delay(80)
            }
        }
    }

    private fun spokenAt(words: List<TimedWord>, t: Double): Pair<Int, Int>? {
        if (words.isEmpty()) return null
        val direct = words.indexOfFirst { t >= it.start && t < it.end }
        val hit = if (direct >= 0) {
            direct
        } else {
            var prev = -1
            for (i in words.indices) {
                if (words[i].start > t) break
                prev = i
            }
            if (prev >= 0 && t - words[prev].end <= 0.35) prev else -1
        }
        if (hit < 0) return null
        return words[hit].verse to words[hit].index
    }

    override fun onCleared() {
        controller?.release()
        controller = null
        super.onCleared()
    }
}
