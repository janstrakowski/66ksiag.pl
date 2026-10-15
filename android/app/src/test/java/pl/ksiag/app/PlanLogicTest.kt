package pl.ksiag.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pl.ksiag.app.model.Book
import pl.ksiag.app.model.Plan
import pl.ksiag.app.model.Verse
import pl.ksiag.app.model.accrued
import pl.ksiag.app.model.advanceCursor
import pl.ksiag.app.model.armed
import pl.ksiag.app.model.buildChapterList
import pl.ksiag.app.model.canMarkBeyondPlan
import pl.ksiag.app.model.canMarkChapter
import pl.ksiag.app.model.chapKey
import pl.ksiag.app.model.dailyQuota
import pl.ksiag.app.model.defaultPlan
import pl.ksiag.app.model.estimateMinutesFromVerses
import pl.ksiag.app.model.isChapterCredited
import pl.ksiag.app.model.isChapterReadToday
import pl.ksiag.app.model.isDailyPlanComplete
import pl.ksiag.app.model.isExtraCredit
import pl.ksiag.app.model.isInGoalRange
import pl.ksiag.app.model.markChapterRead
import pl.ksiag.app.model.nextBeyondPlanTarget
import pl.ksiag.app.model.nextChapterInBible
import pl.ksiag.app.model.prevChapterInBible
import pl.ksiag.app.model.nextMarkTarget
import pl.ksiag.app.model.nextUnreadInGoal
import pl.ksiag.app.model.progressPct
import pl.ksiag.app.model.quotaPreview
import pl.ksiag.app.model.resetPlanAll
import pl.ksiag.app.model.resetPlanProgress
import pl.ksiag.app.model.rolled
import pl.ksiag.app.model.toRoman
import pl.ksiag.app.model.todayAssignment
import pl.ksiag.app.model.todayKey

class PlanLogicTest {
    private fun books() = listOf(
        Book("01-gen", "Genesis", "Gen", emptyList(), "st", 3),
        Book("02-exo", "Exodus", "Exo", emptyList(), "st", 2),
        Book("40-mat", "Matthew", "Mat", emptyList(), "nt", 2),
        Book("66-apo", "Revelation", "Rev", emptyList(), "nt", 2),
    )

    private fun enabled(chapters: Int = 2, goal: String = "bible") =
        defaultPlan().copy(enabled = true, chaptersPerDay = chapters, mode = "chapters", goal = goal)

    @Test
    fun todayAndChapKey() {
        assertTrue(todayKey().matches(Regex("\\d{4}-\\d{2}-\\d{2}")))
        assertEquals("01-gen/3", chapKey("01-gen", 3))
        assertEquals("I", toRoman(1))
        assertEquals("XLIII", toRoman(43))
    }

    @Test
    fun quotaAndEstimate() {
        assertEquals(3, dailyQuota(Plan(mode = "chapters", chaptersPerDay = 3)))
        assertEquals(1, dailyQuota(Plan(mode = "chapters", chaptersPerDay = 0)))
        assertEquals(5, dailyQuota(Plan(mode = "time", minutesPerDay = 15)))
        assertEquals("2 ch", quotaPreview(Plan(mode = "chapters", chaptersPerDay = 2), { "$it ch" }, { m, q -> "$m-$q" }))
        val est = estimateMinutesFromVerses(listOf(Verse(1, "And <i>God</i> said light.")))
        assertEquals(4, est.words)
        assertEquals(1, est.minutes)
    }

    @Test
    fun chapterLists() {
        val books = books()
        val all = buildChapterList(books, Plan(goal = "bible"))
        assertEquals("01-gen/1", all.first())
        assertEquals("66-apo/2", all.last())
        assertEquals(9, all.size)
        assertEquals(listOf("01-gen/1", "01-gen/2", "01-gen/3", "02-exo/1", "02-exo/2"), buildChapterList(books, Plan(goal = "st")))
        assertEquals("40-mat/1", buildChapterList(books, Plan(goal = "nt")).first())
        assertEquals(
            listOf("01-gen/2", "01-gen/3"),
            buildChapterList(books, Plan(goal = "range", fromBook = "01-gen", fromChapter = 2, toBook = "01-gen", toChapter = 3)),
        )
        assertEquals("01-gen", nextChapterInBible(books, "01-gen", 1)?.book)
        assertEquals(2, nextChapterInBible(books, "01-gen", 1)?.chapter)
        assertNull(nextChapterInBible(books, "66-apo", 2))
        assertEquals("01-gen", prevChapterInBible(books, "01-gen", 2)?.book)
        assertEquals(1, prevChapterInBible(books, "01-gen", 2)?.chapter)
        assertEquals("01-gen", prevChapterInBible(books, "02-exo", 1)?.book)
        assertEquals(3, prevChapterInBible(books, "02-exo", 1)?.chapter)
        assertNull(prevChapterInBible(books, "01-gen", 1))
    }

    @Test
    fun markingOrder() {
        val books = books()
        var plan = enabled()
        assertEquals("off", markChapterRead(defaultPlan(), "01-gen", 1).kind)
        var r = markChapterRead(plan, "01-gen", 1)
        assertEquals("plan", r.kind)
        plan = r.plan
        r = markChapterRead(plan, "01-gen", 2)
        assertEquals("plan", r.kind)
        plan = r.plan
        assertTrue(isDailyPlanComplete(plan))
        assertEquals(100, progressPct(plan))
        r = markChapterRead(plan, "01-gen", 3, books)
        assertEquals("extra", r.kind)
        assertTrue(isExtraCredit(r.plan, "01-gen", 3))
        assertEquals("skip", markChapterRead(plan, "01-gen", 5, books).kind)
        assertEquals("already", markChapterRead(r.plan, "01-gen", 1).kind)
    }

    @Test
    fun assignmentFollowsCreditNotBrowse() {
        val books = books()
        var plan = enabled(chapters = 3)
        plan = markChapterRead(plan, "01-gen", 1, books).plan
        plan = advanceCursor(plan, books)
        val asg = todayAssignment(books, plan, ::toRoman)
        assertEquals(false, asg?.done)
        assertEquals("/porcja/01-gen/2", asg?.href)
        assertEquals(true, asg?.started)
        assertEquals("01-gen", nextMarkTarget(books, plan)?.book)
        assertEquals(2, nextMarkTarget(books, plan)?.chapter)
        val next = nextUnreadInGoal(books, plan)
        assertEquals(2, next?.chapter)
    }

    @Test
    fun onlyNextAfterFurthest() {
        val books = books()
        var plan = enabled()
        assertFalse(canMarkChapter(books, plan, "01-gen", 2))
        assertEquals("skip", markChapterRead(plan, "01-gen", 2, books).kind)
        plan = markChapterRead(plan, "01-gen", 1, books).plan
        plan = markChapterRead(plan, "01-gen", 2, books).plan
        assertTrue(isDailyPlanComplete(plan))
        assertEquals(3, nextBeyondPlanTarget(books, plan)?.chapter)
        assertTrue(canMarkBeyondPlan(books, plan, "01-gen", 3))
        assertEquals("skip", markChapterRead(plan, "02-exo", 1, books).kind)
        plan = markChapterRead(plan, "01-gen", 3, books).plan
        assertEquals("02-exo", nextMarkTarget(books, plan)?.book)
    }

    @Test
    fun resetAndCursorAcrossDays() {
        val books = books()
        var plan = enabled(chapters = 9)
        plan = markChapterRead(plan, "01-gen", 1).plan
        plan = resetPlanProgress(plan)
        assertTrue(plan.readToday.isEmpty())
        assertEquals(9, plan.chaptersPerDay)
        assertEquals("01-gen", nextMarkTarget(books, plan)?.book)
        assertEquals(1, nextMarkTarget(books, plan)?.chapter)

        plan = enabled(goal = "nt")
        assertFalse(isInGoalRange(books, plan, "01-gen", 1))
        assertTrue(isInGoalRange(books, plan, "40-mat", 1))
        plan = markChapterRead(plan, "40-mat", 1, books).plan
        plan = advanceCursor(plan, books)
        plan = plan.copy(readToday = emptyList())
        assertTrue(isChapterCredited(books, plan, "40-mat", 1))
        assertEquals(2, nextMarkTarget(books, plan)?.chapter)
        assertTrue(isChapterReadToday(plan.copy(readToday = listOf("40-mat/1")), "40-mat", 1))
        assertNull(progressPct(defaultPlan()))
        assertFalse(resetPlanAll().enabled)
    }

    @Test
    fun dayRolloverClearsTodayWithoutTouchingCursor() {
        val plan = defaultPlan().copy(
            enabled = true,
            chaptersPerDay = 7,
            day = "2000-01-01",
            readToday = listOf("01-gen/1"),
            cursor = 4,
        ).rolled()
        assertTrue(plan.enabled)
        assertEquals(7, plan.chaptersPerDay)
        assertEquals(todayKey(), plan.day)
        assertTrue(plan.readToday.isEmpty())
        assertEquals(4, plan.cursor)
    }

    @Test
    fun debtStartsWithThePortionAndClearsWhenPaid() {
        val books = books()
        var plan = enabled(chapters = 2).armed()
        assertEquals(2, plan.owed)
        assertEquals(2, plan.pile)
        plan = markChapterRead(plan, "01-gen", 1, books).plan
        assertEquals(1, plan.owed)
        assertFalse(isDailyPlanComplete(plan))
        plan = markChapterRead(plan, "01-gen", 2, books).plan
        assertEquals(0, plan.owed)
        assertTrue(isDailyPlanComplete(plan))
        assertEquals(100, progressPct(plan))
    }

    @Test
    fun missedDaysAddToTheDebt() {
        val plan = enabled(chapters = 2).copy(day = "2000-01-01", owed = 2, pile = 2).accrued("2000-01-03")
        assertEquals("2000-01-03", plan.day)
        assertEquals(6, plan.owed)
        assertEquals(6, plan.pile)
        assertTrue(plan.readToday.isEmpty())
        val again = plan.accrued("2000-01-03")
        assertEquals(6, again.owed)
    }
}
