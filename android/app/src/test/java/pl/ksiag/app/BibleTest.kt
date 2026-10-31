package pl.ksiag.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import pl.ksiag.app.model.Book
import pl.ksiag.app.model.Verse
import pl.ksiag.app.model.estimateMinutesFromVerses
import pl.ksiag.app.model.nextChapterInBible
import pl.ksiag.app.model.prevChapterInBible
import pl.ksiag.app.model.resolveBook
import pl.ksiag.app.model.toRoman

class BibleTest {
    private fun books() = listOf(
        Book("01-gen", "Genesis", "Gen", listOf("rdz", "gen"), "st", 3),
        Book("02-exo", "Exodus", "Exo", listOf("wj", "exo"), "st", 2),
        Book("40-mat", "Matthew", "Mat", listOf("mt", "mat"), "nt", 2),
        Book("66-apo", "Revelation", "Rev", listOf("ap", "rev"), "nt", 2),
    )

    @Test
    fun romanAndEstimate() {
        assertEquals("I", toRoman(1))
        assertEquals("XLIII", toRoman(43))
        val est = estimateMinutesFromVerses(listOf(Verse(1, "And <i>God</i> said light.")))
        assertEquals(4, est.words)
        assertEquals(1, est.minutes)
    }

    @Test
    fun chapterNavigationAndResolve() {
        val books = books()
        assertEquals("01-gen", resolveBook(books, "rdz")?.id)
        assertEquals("01-gen", resolveBook(books, "Gen")?.id)
        assertEquals("01-gen", nextChapterInBible(books, "01-gen", 1)?.book)
        assertEquals(2, nextChapterInBible(books, "01-gen", 1)?.chapter)
        assertEquals("02-exo", nextChapterInBible(books, "01-gen", 3)?.book)
        assertEquals(1, nextChapterInBible(books, "01-gen", 3)?.chapter)
        assertNull(nextChapterInBible(books, "66-apo", 2))
        assertEquals("01-gen", prevChapterInBible(books, "01-gen", 2)?.book)
        assertEquals(1, prevChapterInBible(books, "01-gen", 2)?.chapter)
        assertEquals("01-gen", prevChapterInBible(books, "02-exo", 1)?.book)
        assertEquals(3, prevChapterInBible(books, "02-exo", 1)?.chapter)
        assertNull(prevChapterInBible(books, "01-gen", 1))
    }
}
