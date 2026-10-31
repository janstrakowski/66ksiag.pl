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
import pl.ksiag.app.data.Repository
import pl.ksiag.app.data.Store
import pl.ksiag.app.model.Book
import pl.ksiag.app.model.ChapterText
import pl.ksiag.app.model.Edition
import pl.ksiag.app.model.ORIGIN
import pl.ksiag.app.model.TimedWord
import pl.ksiag.app.model.copyFor
import pl.ksiag.app.model.nextChapterInBible
import pl.ksiag.app.model.prevChapterInBible
import pl.ksiag.app.model.resolveBook
import pl.ksiag.app.model.stripTags

sealed interface Route {
    data object Pick : Route
    data object Home : Route
    data object Books : Route
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
    var spokenVerse by mutableStateOf<Int?>(null)
        private set
    var spokenIndex by mutableStateOf(-1)
        private set

    private var pending: Route? = null
    private var controller: MediaController? = null
    private var playBook: String? = null
    private var playChapter: Int? = null
    private var lastEndedId: String? = null
    private var readerGen = 0
    private var toastJob: Job? = null
    private var playRequested = false
    private var wordJob: Job? = null
    private var spokenWords: List<TimedWord> = emptyList()

    val canBack: Boolean get() = stack.isNotEmpty()

    init {
        edition = store.edition()
        route = if (edition == null) Route.Pick else Route.Home
        if (edition != null) refreshHome()
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
        val parts = uri.path.orEmpty().trim('/').split('/').filter { it.isNotEmpty() }
        val target: Route = when (parts.firstOrNull()) {
            null -> if (edition == null) Route.Pick else Route.Home
            "wybor", "choose" -> Route.Pick
            "ksiegi", "books" -> Route.Books
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
            is Route.Read -> openReader(target.bookId, target.chapter, target.verse, push = false)
        }
    }

    fun selectEdition(id: String) {
        val next = Edition.find(id) ?: return
        edition = next
        store.saveEdition(next)
        books = emptyList()
        reader = null
        stack = emptyList()
        val queued = pending
        pending = null
        route = Route.Home
        when (queued) {
            is Route.Read -> openReader(queued.bookId, queued.chapter, queued.verse, push = false)
            Route.Books -> go(Route.Books)
            else -> refreshHome()
        }
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
        if (next == Route.Books) {
            viewModelScope.launch {
                try {
                    ensureBooks()
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
    ) {
        if (push && route !is Route.Read) stack = stack + route
        route = Route.Read(bookKey, chapter, verse)
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
                selectedVerse = verse
                store.rememberPlace(ed.id, book.id, chapter)
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

    fun readingPlace() = edition?.id?.let { store.place(it) }

    fun openSource() {
        val url = copyFor(edition).homeSourceUrl
        if (url.isEmpty()) return
        getApplication<Application>().startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
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
            openReader(next.book, next.chapter, null, push = false, autoplay = true)
        }
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

    private fun refreshHome() {
        viewModelScope.launch {
            try {
                ensureBooks()
            } catch (_: Exception) {
            }
            if (edition?.audio == true && !DownloadBus.state.value.running) {
                val have = withContext(Dispatchers.IO) { AudioFiles.count(getApplication()) }
                val catalog = withContext(Dispatchers.IO) { repo.cachedCatalog()?.size ?: 0 }
                download = DownloadState(have = have, catalog = catalog)
                DownloadBus.state.value = download
            }
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
                flash(copyFor(edition).audioUnavailable)
                return@launch
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
            val list = try {
                ensureBooks()
            } catch (_: Exception) {
                return@launch
            }
            val next = nextChapterInBible(list, bookId, chapter)
            if (next != null) {
                openReader(next.book, next.chapter, null, push = false, autoplay = true)
                return@launch
            }
            stopAudio()
            flash(copyFor(edition).audioBibleEnded)
        }
    }

    fun stopAudio() {
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
