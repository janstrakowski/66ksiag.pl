package pl.ksiag.app.model

import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.round

const val WPM = 160
const val AVG_CHAPTER_MIN = 3

data class Plan(
    val enabled: Boolean = false,
    val goal: String = "bible",
    val fromBook: String = "01-gen",
    val fromChapter: Int = 1,
    val toBook: String = "66-apo",
    val toChapter: Int = 22,
    val mode: String = "chapters",
    val chaptersPerDay: Int = 3,
    val minutesPerDay: Int = 15,
    val notifications: Boolean = false,
    val day: String = todayKey(),
    val readToday: List<String> = emptyList(),
    val cursor: Int = 0,
    val owed: Int? = null,
    val pile: Int? = null,
    val beyond: Boolean = false,
    val doneToday: Int = 0,
    val startNotifiedDay: String? = null,
)

data class MarkResult(val plan: Plan, val kind: String)

data class ChapterRef(val book: String, val chapter: Int, val index: Int = -1)

data class Assignment(
    val done: Boolean,
    val started: Boolean = false,
    val minutes: Int = 0,
    val range: String? = null,
    val href: String? = null,
    val behind: Int = 0,
    val pile: Int = 0,
    val owed: Int = 0,
)

data class PileStatus(
    val quota: Int,
    val owed: Int,
    val pile: Int,
    val done: Int,
    val behind: Int,
)

data class ReadEstimate(val minutes: Int, val words: Int)

data class MarkUi(
    val hidden: Boolean,
    val done: Boolean = false,
    val extra: Boolean = false,
    val extraAction: Boolean = false,
)

fun todayKey(date: LocalDate = LocalDate.now()): String =
    "%04d-%02d-%02d".format(date.year, date.monthValue, date.dayOfMonth)

fun chapKey(bookId: String, chapter: Int) = "$bookId/$chapter"

fun defaultPlan() = Plan()

fun Plan.rolled(today: String = todayKey()): Plan =
    if (day == today) this else copy(day = today, readToday = emptyList())

fun daysBetween(fromKey: String, toKey: String): Int {
    fun parse(key: String) = try {
        LocalDate.parse(key)
    } catch (_: Exception) {
        null
    }
    val a = parse(fromKey) ?: return 0
    val b = parse(toKey) ?: return 0
    return max(0, ChronoUnit.DAYS.between(a, b).toInt())
}

/** Dolicza zaległe dni. Reszta zostaje, każdy nowy dzień dokłada jedną porcję. */
fun Plan.accrued(today: String = todayKey()): Plan {
    if (!enabled) {
        if (day == today) return this
        return copy(day = today, readToday = emptyList(), beyond = false, doneToday = 0)
    }
    val quota = dailyQuota(this)
    var debt = owed
    if (debt == null) {
        val done = min(readToday.size, quota)
        debt = max(0, quota - done)
    }
    if (day == today) {
        return copy(owed = debt, pile = pile ?: debt + min(readToday.size, quota))
    }
    debt = min(1189, debt + quota * daysBetween(day, today))
    return copy(
        owed = debt,
        pile = debt,
        beyond = false,
        readToday = emptyList(),
        doneToday = 0,
        day = today,
    )
}

/** Zapis formularza: dzisiejsza porcja od nowa, więc dług zaczyna się od razu. */
fun Plan.armed(): Plan {
    val q = dailyQuota(this)
    return copy(
        day = todayKey(),
        readToday = emptyList(),
        cursor = 0,
        beyond = false,
        doneToday = 0,
        owed = if (enabled) q else null,
        pile = if (enabled) q else null,
    )
}

fun Plan.wantsNotifications() = enabled && notifications

fun toRoman(n: Int): String {
    val map = listOf(
        1000 to "M", 900 to "CM", 500 to "D", 400 to "CD",
        100 to "C", 90 to "XC", 50 to "L", 40 to "XL",
        10 to "X", 9 to "IX", 5 to "V", 4 to "IV", 1 to "I",
    )
    var x = n
    val out = StringBuilder()
    for ((v, s) in map) {
        while (x >= v) {
            out.append(s)
            x -= v
        }
    }
    return out.toString()
}

fun dailyQuota(plan: Plan): Int {
    return if (plan.mode == "time") {
        max(1, round(plan.minutesPerDay / AVG_CHAPTER_MIN.toDouble()).toInt())
    } else {
        max(1, round((plan.chaptersPerDay.toDouble()).let { if (plan.chaptersPerDay == 0) 1.0 else it }).toInt())
    }
}

fun quotaPreview(plan: Plan, chapters: (Int) -> String, time: (Int, Int) -> String): String {
    val q = dailyQuota(plan)
    return if (plan.mode == "time") time(plan.minutesPerDay, q) else chapters(q)
}

fun estimateMinutesFromVerses(verses: List<Verse>): ReadEstimate {
    val text = verses.joinToString(" ") { stripTags(it.t) }
    val words = if (text.isBlank()) 0 else text.trim().split(Regex("\\s+")).size
    val mins = words / WPM.toDouble()
    if (mins < 1.5) return ReadEstimate(1, words)
    return ReadEstimate(max(1, round(mins).toInt()), words)
}

private data class Bounds(val fromId: String, val toId: String, val fromCh: Int, val toCh: Int)

private fun goalBounds(books: List<Book>, plan: Plan): Bounds {
    if (plan.goal == "st") {
        val st = books.filter { it.testament == "st" }
        return Bounds(st.first().id, st.last().id, 1, st.last().chapters)
    }
    if (plan.goal == "nt") {
        val nt = books.filter { it.testament == "nt" }
        return Bounds(nt.first().id, nt.last().id, 1, nt.last().chapters)
    }
    if (plan.goal == "range") {
        return Bounds(plan.fromBook, plan.toBook, plan.fromChapter.coerceAtLeast(1), plan.toChapter.coerceAtLeast(1))
    }
    return Bounds(books.first().id, books.last().id, 1, books.last().chapters)
}

fun buildChapterList(books: List<Book>, plan: Plan): List<String> {
    if (books.isEmpty()) return emptyList()
    val (fromId, toId, fromCh, toCh) = goalBounds(books, plan)
    val fromIdx = books.indexOfFirst { it.id == fromId }
    val toIdx = books.indexOfFirst { it.id == toId }
    if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) return emptyList()
    val list = ArrayList<String>()
    for (i in fromIdx..toIdx) {
        val b = books[i]
        val start = if (i == fromIdx) fromCh else 1
        val end = if (i == toIdx) minOf(toCh, b.chapters) else b.chapters
        for (c in start..end) list += chapKey(b.id, c)
    }
    return list
}

fun isDailyPlanComplete(plan: Plan): Boolean {
    if (!plan.enabled) return false
    if (plan.owed != null) return plan.owed <= 0
    return plan.readToday.size >= dailyQuota(plan)
}

fun progressPct(plan: Plan): Int? {
    if (!plan.enabled) return null
    val pile = plan.pile
    val owed = plan.owed
    if (owed != null && pile != null && pile > 0) {
        val done = max(0, pile - owed)
        return minOf(100, round(done.toDouble() / pile * 100).toInt())
    }
    val q = dailyQuota(plan)
    return minOf(100, round(plan.readToday.size.toDouble() / q * 100).toInt())
}

fun isChapterReadToday(plan: Plan, bookId: String, chapter: Int) =
    chapKey(bookId, chapter) in plan.readToday

fun isInGoalRange(books: List<Book>, plan: Plan, bookId: String, chapter: Int): Boolean {
    if (!plan.enabled || books.isEmpty()) return false
    return chapKey(bookId, chapter) in buildChapterList(books, plan)
}

fun isChapterCredited(books: List<Book>, plan: Plan, bookId: String, chapter: Int): Boolean {
    val list = buildChapterList(books, plan)
    val idx = list.indexOf(chapKey(bookId, chapter))
    if (idx < 0) return false
    if (idx < plan.cursor) return true
    return chapKey(bookId, chapter) in plan.readToday
}

fun isExtraCredit(plan: Plan, bookId: String, chapter: Int): Boolean {
    val idx = plan.readToday.indexOf(chapKey(bookId, chapter))
    if (idx < 0) return false
    return idx >= (plan.pile ?: dailyQuota(plan))
}

fun nextChapterInBible(books: List<Book>, bookId: String, chapter: Int): ChapterRef? {
    val i = books.indexOfFirst { it.id == bookId }
    if (i < 0) return null
    val book = books[i]
    if (chapter < book.chapters) return ChapterRef(bookId, chapter + 1)
    if (i + 1 >= books.size) return null
    return ChapterRef(books[i + 1].id, 1)
}

private fun furthestCredited(books: List<Book>, plan: Plan): ChapterRef? {
    var bestScore = -1
    var best: ChapterRef? = null
    for (key in plan.readToday) {
        val parts = key.split("/")
        if (parts.size != 2) continue
        val bookId = parts[0]
        val ch = parts[1].toIntOrNull() ?: continue
        val bi = books.indexOfFirst { it.id == bookId }
        if (bi < 0) continue
        val score = bi * 100_000 + ch
        if (score > bestScore) {
            bestScore = score
            best = ChapterRef(bookId, ch)
        }
    }
    return best
}

fun nextMarkTarget(books: List<Book>, plan: Plan): ChapterRef? {
    if (!plan.enabled || books.isEmpty()) return null
    val list = buildChapterList(books, plan)
    if (list.isEmpty()) return null
    val last = furthestCredited(books, plan)
    if (last != null) {
        val next = nextChapterInBible(books, last.book, last.chapter) ?: return null
        if (!isInGoalRange(books, plan, next.book, next.chapter)) return null
        return next
    }
    val idx = plan.cursor
    if (idx >= list.size) return null
    val parts = list[idx].split("/")
    return ChapterRef(parts[0], parts[1].toInt())
}

fun canMarkChapter(books: List<Book>, plan: Plan, bookId: String, chapter: Int): Boolean {
    val next = nextMarkTarget(books, plan) ?: return false
    return next.book == bookId && next.chapter == chapter
}

fun nextBeyondPlanTarget(books: List<Book>, plan: Plan): ChapterRef? {
    if (!plan.enabled || !isDailyPlanComplete(plan)) return null
    return nextMarkTarget(books, plan)
}

fun canMarkBeyondPlan(books: List<Book>, plan: Plan, bookId: String, chapter: Int) =
    isDailyPlanComplete(plan) && canMarkChapter(books, plan, bookId, chapter)

fun markChapterRead(
    plan: Plan,
    bookId: String,
    chapter: Int,
    books: List<Book>? = null,
    payDebt: Boolean = true,
): MarkResult {
    if (!plan.enabled) return MarkResult(plan, "off")
    val fresh = plan.accrued()
    val key = chapKey(bookId, chapter)
    if (key in fresh.readToday) return MarkResult(fresh, "already")
    if (books != null && !canMarkChapter(books, fresh, bookId, chapter)) return MarkResult(fresh, "skip")
    if (isDailyPlanComplete(fresh)) {
        if (books == null) return MarkResult(fresh, "skip")
        return MarkResult(fresh.copy(readToday = fresh.readToday + key), "extra")
    }
    val marked = fresh.copy(readToday = fresh.readToday + key)
    val paid = if (payDebt && marked.owed != null && marked.owed > 0) {
        marked.copy(owed = marked.owed - 1, doneToday = marked.doneToday + 1)
    } else {
        marked
    }
    return MarkResult(paid, "plan")
}

fun pileStatus(plan: Plan): PileStatus {
    val quota = dailyQuota(plan)
    val owed = plan.owed ?: max(0, quota - plan.readToday.size)
    val pile = plan.pile?.takeIf { it != 0 } ?: max(quota, owed)
    val done = max(0, pile - owed)
    val behind = max(0, pile - quota)
    return PileStatus(quota, owed, pile, done, behind)
}

fun readingMinutes(chapters: Int, plan: Plan): Int? {
    if (chapters <= 0) return null
    val quota = dailyQuota(plan)
    val raw = if (plan.mode == "time") (plan.minutesPerDay.toDouble() / quota) * chapters else chapters * AVG_CHAPTER_MIN.toDouble()
    return max(1, ceil(raw).toInt())
}

fun planFinishDate(books: List<Book>, plan: Plan, today: LocalDate = LocalDate.now()): LocalDate? {
    val list = buildChapterList(books, plan)
    val remaining = max(0, list.size - plan.cursor)
    if (remaining == 0) return null
    val days = max(1, ceil(remaining.toDouble() / dailyQuota(plan)).toInt())
    return today.plusDays((days - 1).toLong())
}

fun advanceCursor(plan: Plan, books: List<Book>): Plan {
    val list = buildChapterList(books, plan)
    var cursor = plan.cursor
    while (cursor < list.size && list[cursor] in plan.readToday) cursor += 1
    return plan.copy(cursor = cursor)
}

fun resetPlanProgress(plan: Plan): Plan {
    val q = dailyQuota(plan)
    return plan.copy(
        day = todayKey(),
        readToday = emptyList(),
        cursor = 0,
        beyond = false,
        doneToday = 0,
        owed = if (plan.enabled) q else null,
        pile = if (plan.enabled) q else null,
        startNotifiedDay = null,
    )
}

fun resetPlanAll() = defaultPlan()

fun nextUnreadInGoal(books: List<Book>, plan: Plan): ChapterRef? {
    val list = buildChapterList(books, plan)
    if (list.isEmpty()) return null
    val start = minOf(plan.cursor, list.size - 1)
    fun ref(i: Int): ChapterRef {
        val parts = list[i].split("/")
        return ChapterRef(parts[0], parts[1].toInt(), i)
    }
    for (i in start until list.size) {
        if (list[i] !in plan.readToday) return ref(i)
    }
    for (i in 0 until start) {
        if (list[i] !in plan.readToday) return ref(i)
    }
    val idx = minOf(plan.cursor + dailyQuota(plan), list.size - 1)
    return ref(idx)
}

private fun refLabel(books: List<Book>, key: String, toRoman: (Int) -> String): String {
    val parts = key.split("/")
    val b = books.find { it.id == parts[0] }
    val n = parts[1].toInt()
    return "${b?.short ?: parts[0]} ${toRoman(n)}"
}

fun todayAssignment(books: List<Book>, plan: Plan, toRoman: (Int) -> String): Assignment? {
    if (!plan.enabled) return null
    val list = buildChapterList(books, plan)
    if (list.isEmpty()) return null
    val status = pileStatus(plan)
    if (status.owed <= 0) return Assignment(done = true, started = true, pile = status.pile, owed = 0)
    val target = nextMarkTarget(books, plan) ?: return null
    val startKey = chapKey(target.book, target.chapter)
    val startIdx = list.indexOf(startKey)
    if (startIdx < 0) return null
    val slice = list.subList(startIdx, minOf(startIdx + status.owed, list.size))
    if (slice.isEmpty()) return null
    val start = refLabel(books, slice.first(), toRoman)
    val end = refLabel(books, slice.last(), toRoman)
    val range = if (start == end) start else "$start–$end"
    return Assignment(
        done = false,
        started = status.done > 0,
        minutes = readingMinutes(slice.size, plan) ?: 0,
        range = range,
        href = "/porcja/${target.book}/${target.chapter}",
        behind = status.behind,
        pile = status.pile,
        owed = status.owed,
    )
}

fun markUi(plan: Plan, books: List<Book>, bookId: String, chapter: Int): MarkUi {
    if (!plan.enabled || books.isEmpty()) return MarkUi(hidden = true)
    if (!isInGoalRange(books, plan, bookId, chapter)) return MarkUi(hidden = true)
    if (isChapterCredited(books, plan, bookId, chapter)) {
        return MarkUi(hidden = false, done = true, extra = isExtraCredit(plan, bookId, chapter))
    }
    if (!canMarkChapter(books, plan, bookId, chapter)) return MarkUi(hidden = true)
    if (isDailyPlanComplete(plan)) return MarkUi(hidden = false, extraAction = true)
    return MarkUi(hidden = false)
}
