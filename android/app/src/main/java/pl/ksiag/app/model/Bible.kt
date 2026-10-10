package pl.ksiag.app.model

import org.json.JSONObject

const val ORIGIN = "https://66ksiag.pl"

data class Edition(
    val id: String,
    val translation: String,
    val edition: String,
    val language: String,
    val short: String,
    val path: String,
    val audio: Boolean,
) {
    companion object {
        val BG = Edition("bg-1879", "bg", "1879", "pl", "BG 1879", "/bg/1879", false)
        val KJV = Edition("kjv-1769", "kjv", "1769", "en", "KJV", "/kjv/1769", true)
        val all = listOf(BG, KJV)
        fun find(id: String?): Edition? = all.find { it.id == id }
    }
}

data class Book(
    val id: String,
    val name: String,
    val short: String,
    val aliases: List<String>,
    val testament: String,
    val chapters: Int,
)

data class Verse(val n: Int, val t: String)

data class ChapterText(
    val book: String,
    val chapter: Int,
    val verses: List<Verse>,
)

data class AudioChapter(val book: String, val chapter: Int, val url: String)

fun parseBooks(json: String): List<Book> {
    val arr = JSONObject(json).getJSONArray("books")
    return List(arr.length()) { i ->
        val o = arr.getJSONObject(i)
        val aliases = o.optJSONArray("aliases")
        Book(
            id = o.getString("id"),
            name = o.getString("name"),
            short = o.getString("short"),
            aliases = if (aliases == null) emptyList() else List(aliases.length()) { aliases.getString(it) },
            testament = o.getString("testament"),
            chapters = o.getInt("chapters"),
        )
    }
}

fun parseChapter(json: String): ChapterText {
    val o = JSONObject(json)
    val verses = o.getJSONArray("verses")
    return ChapterText(
        book = o.getString("book"),
        chapter = o.getInt("chapter"),
        verses = List(verses.length()) { i ->
            val v = verses.getJSONObject(i)
            Verse(v.getInt("n"), v.getString("t"))
        },
    )
}

fun parseCatalog(json: String): List<AudioChapter> {
    val arr = JSONObject(json).optJSONArray("chapters") ?: return emptyList()
    return List(arr.length()) { i ->
        val o = arr.getJSONObject(i)
        AudioChapter(o.getString("book"), o.getInt("chapter"), o.getString("url"))
    }
}

fun resolveBook(books: List<Book>, key: String): Book? {
    val k = key.lowercase()
    return books.find { b ->
        b.id == key ||
            b.id.lowercase() == k ||
            b.short.lowercase() == k ||
            b.aliases.any { it.lowercase() == k }
    }
}

fun stripTags(html: String) = html.replace(Regex("<[^>]+>"), "")

data class TimedWord(val verse: Int, val index: Int, val start: Double, val end: Double)

fun parseWords(json: String): List<TimedWord> {
    val arr = JSONObject(json).optJSONArray("words") ?: return emptyList()
    return List(arr.length()) { i ->
        val o = arr.getJSONObject(i)
        TimedWord(o.optInt("v"), o.optInt("i"), o.optDouble("s"), o.optDouble("e"))
    }.filter { it.start.isFinite() && it.end.isFinite() }
}
