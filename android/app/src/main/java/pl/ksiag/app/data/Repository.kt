package pl.ksiag.app.data

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import pl.ksiag.app.model.AudioChapter
import pl.ksiag.app.model.Book
import pl.ksiag.app.model.ChapterText
import pl.ksiag.app.model.Edition
import pl.ksiag.app.model.ORIGIN
import pl.ksiag.app.model.parseBooks
import pl.ksiag.app.model.parseCatalog
import pl.ksiag.app.model.TimedWord
import pl.ksiag.app.model.parseChapter
import pl.ksiag.app.model.parseWords
import java.io.File
import java.util.concurrent.TimeUnit

class Repository(context: Context) {
    private val app = context.applicationContext
    private val dir = File(app.filesDir, "offline").apply { mkdirs() }
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(40, TimeUnit.SECONDS)
        .build()
    private val chapters = object : LinkedHashMap<String, ChapterText>(48, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ChapterText>?) = size > 48
    }

    fun books(edition: Edition): List<Book> {
        val asset = bundledEdition(edition, "books.json")
        if (asset != null) return parseBooks(asset)
        val file = File(dir, "books-${edition.id}.json")
        return parseBooks(fetch("${edition.path}/books.json", file))
    }

    fun cachedBooks(edition: Edition): List<Book>? {
        bundledEdition(edition, "books.json")?.let {
            return try {
                parseBooks(it)
            } catch (_: Exception) {
                null
            }
        }
        val file = File(dir, "books-${edition.id}.json")
        if (!file.exists()) return null
        return try {
            parseBooks(file.readText())
        } catch (_: Exception) {
            null
        }
    }

    fun chapter(edition: Edition, bookId: String, chapter: Int): ChapterText {
        val key = "${edition.path}/$bookId/$chapter"
        chapters[key]?.let { return it }
        val asset = bundledEdition(edition, "$bookId/$chapter.json")
        if (asset != null) {
            val text = parseChapter(asset)
            chapters[key] = text
            return text
        }
        val file = File(dir, "${edition.id}-$bookId-$chapter.json")
        val text = parseChapter(fetch("$key.json", file))
        chapters[key] = text
        return text
    }

    fun catalog(): List<AudioChapter> {
        bundled("audio-catalog.json")?.let { return parseCatalog(it) }
        val file = File(dir, "audio-catalog.json")
        return parseCatalog(fetch("/audio-catalog.json", file))
    }

    fun words(edition: Edition, bookId: String, chapter: Int): List<TimedWord> {
        val file = File(dir, "${edition.id}-$bookId-$chapter.words.json")
        return try {
            parseWords(fetch("/${edition.translation}/${edition.edition}/$bookId/$chapter.words.json", file))
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun cachedCatalog(): List<AudioChapter>? {
        bundled("audio-catalog.json")?.let {
            return try {
                parseCatalog(it)
            } catch (_: Exception) {
                null
            }
        }
        val file = File(dir, "audio-catalog.json")
        if (!file.exists()) return null
        return try {
            parseCatalog(file.readText())
        } catch (_: Exception) {
            null
        }
    }

    /** APK assets stay at bible/{tr}/{ed}/. `edition.path` is the public /api URL. */
    private fun bundledEdition(edition: Edition, relative: String): String? =
        bundled("bible/${edition.translation}/${edition.edition}/$relative")

    private fun bundled(assetPath: String): String? = try {
        app.assets.open(assetPath).bufferedReader().use { it.readText() }
    } catch (_: Exception) {
        null
    }

    private val lock = Any()

    private fun fetch(path: String, file: File): String = synchronized(lock) {
        try {
            val req = Request.Builder()
                .url(ORIGIN + path)
                .header("User-Agent", "66ksiag-android/2.0")
                .build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) error("HTTP ${res.code}")
                val body = res.body?.string() ?: error("empty")
                file.writeText(body)
                return body
            }
        } catch (e: Exception) {
            if (file.exists()) return file.readText()
            throw e
        }
    }
}

object AudioFiles {
    fun file(context: Context, book: String, chapter: Int): File =
        File(context.applicationContext.filesDir, "audio/kjv/1769/$book/$chapter.mp3")

    fun count(context: Context): Int {
        val root = File(context.applicationContext.filesDir, "audio/kjv/1769")
        if (!root.exists()) return 0
        return root.walkTopDown().count { it.isFile && it.extension == "mp3" && it.length() > 1000 }
    }

    fun clear(context: Context) {
        File(context.applicationContext.filesDir, "audio").deleteRecursively()
    }
}
