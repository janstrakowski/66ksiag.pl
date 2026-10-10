package pl.ksiag.app.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import pl.ksiag.app.model.Book
import pl.ksiag.app.model.ORIGIN
import pl.ksiag.app.model.Plan
import pl.ksiag.app.model.accrued
import pl.ksiag.app.model.buildChapterList
import pl.ksiag.app.model.dailyQuota
import pl.ksiag.app.model.todayKey
import java.security.SecureRandom
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.min

/**
 * Ten sam zapis co web/cloud.js: 32 B kodu (16 B slotu + 16 B AES-128-GCM),
 * jawny rekord 24 B, na serwer szyfrogram 29–64 B.
 * Ten sam klucz, przez HKDF, podpisuje żądanie (Ed25519). Serwer żąda podpisu.
 */
object Cloud {
    private const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    private const val TOKEN_BYTES = 32
    private const val ID_BYTES = 16
    private const val PLAIN_V1 = 16
    private const val PLAIN_V2 = 24
    private const val SYNC_MIN = 29
    private const val SYNC_MAX = 64
    private val GOALS = listOf("bible", "st", "nt", "range")
    private val EPOCH_DAY = LocalDate.of(2020, 1, 1)
    private val EPOCH_MS = Instant.parse("2020-01-01T00:00:00Z").toEpochMilli()
    private val octet = "application/octet-stream".toMediaType()
    private val http = OkHttpClient.Builder()
        .callTimeout(8, TimeUnit.SECONDS)
        .build()
    private val random = SecureRandom()

    data class Token(
        val id: ByteArray,
        val key: ByteArray,
        val idHex: String,
        val canonical: String,
    )

    data class Decoded(
        val plan: Plan,
        val updatedMin: Int,
        val places: Map<String, Place?>?,
    )

    fun minutesSinceEpoch(ms: Long = System.currentTimeMillis()): Int =
        max(0, min(0xffffff, ((ms - EPOCH_MS) / 60000).toInt()))

    fun bumpUpdated(prev: Int): Int = min(0xffffff, max(minutesSinceEpoch(), prev + 1))

    fun formatToken(canonical: String): String {
        val text = parseToken(canonical)?.canonical ?: return ""
        return text.chunked(4).joinToString(" ")
    }

    fun pairingUrl(canonical: String) = "$ORIGIN/synchronizacja#$canonical"

    fun parseToken(input: String?): Token? {
        var s = input?.trim().orEmpty()
        if (s.isEmpty()) return null
        val hashAt = s.lastIndexOf('#')
        if (hashAt >= 0) s = s.substring(hashAt + 1)
        s = s.removePrefix("cloud=").removePrefix("CLOUD=")
        s = s.uppercase().replace(Regex("[^0-9A-Z]"), "").replace('O', '0').replace('I', '1').replace('L', '1')
        if (s.length != 52) return null
        val bytes = decodeBase32(s) ?: return null
        val id = bytes.copyOfRange(0, ID_BYTES)
        val key = bytes.copyOfRange(ID_BYTES, TOKEN_BYTES)
        return Token(id, key, id.joinToString("") { "%02x".format(it) }, encodeBase32(bytes))
    }

    fun generateToken(): Token {
        val bytes = ByteArray(TOKEN_BYTES).also { random.nextBytes(it) }
        return parseToken(encodeBase32(bytes))!!
    }

    fun encodePlan(plan: Plan, updatedMin: Int, places: Map<String, Place?>): ByteArray {
        val bytes = ByteArray(PLAIN_V2)
        val goal = GOALS.indexOf(plan.goal).let { if (it < 0) 0 else it }
        bytes[0] = 2
        bytes[1] = (goal or
            (if (plan.mode == "time") 4 else 0) or
            (if (plan.enabled) 8 else 0) or
            (if (plan.beyond) 16 else 0)).toByte()
        bytes[2] = clamp(plan.chaptersPerDay, 1, 255).toByte()
        bytes[3] = clamp(plan.minutesPerDay, 1, 255).toByte()
        bytes[4] = bookIndex(plan.fromBook).toByte()
        bytes[5] = clamp(plan.fromChapter, 1, 255).toByte()
        bytes[6] = bookIndex(plan.toBook).toByte()
        bytes[7] = clamp(plan.toChapter, 1, 255).toByte()
        writeU16(bytes, 8, plan.cursor)
        writeU16(bytes, 10, dayNumber(plan.day.ifEmpty { todayKey() }))
        val doneCount = plan.readToday.size
        val quota = dailyQuota(plan)
        val owed = plan.owed ?: max(0, quota - min(doneCount, quota))
        val pile = plan.pile?.takeIf { it != 0 } ?: (owed + min(doneCount, quota))
        bytes[12] = clamp(doneCount, 0, 255).toByte()
        writeU16(bytes, 13, owed)
        writeU16(bytes, 15, pile)
        writeU24(bytes, 17, updatedMin)
        writePlace(bytes, 20, places["bg-1879"])
        writePlace(bytes, 22, places["kjv-1769"])
        return bytes
    }

    fun decodePlan(bytes: ByteArray?, books: List<Book>, local: Plan): Decoded? {
        if (bytes == null || (bytes[0].toInt() != 1 && bytes[0].toInt() != 2)) return null
        if (bytes[0].toInt() == 1 && bytes.size < PLAIN_V1) return null
        if (bytes[0].toInt() == 2 && bytes.size < PLAIN_V2) return null
        val goal = GOALS.getOrElse(bytes[1].toInt() and 3) { "bible" }
        val cursor = readU16(bytes, 8)
        val day = dayKey(readU16(bytes, 10))
        var plan = local.copy(
            enabled = bytes[1].toInt() and 8 != 0,
            goal = goal,
            mode = if (bytes[1].toInt() and 4 != 0) "time" else "chapters",
            chaptersPerDay = clamp(bytes[2].toInt() and 255, 1, 255),
            minutesPerDay = clamp(bytes[3].toInt() and 255, 1, 255),
            fromBook = bookIdAt(books, bytes[4].toInt() and 255, local.fromBook),
            fromChapter = clamp(bytes[5].toInt() and 255, 1, 255),
            toBook = bookIdAt(books, bytes[6].toInt() and 255, local.toBook),
            toChapter = clamp(bytes[7].toInt() and 255, 1, 255),
            cursor = cursor,
            day = day,
            readToday = emptyList(),
            notifications = local.notifications,
            startNotifiedDay = local.startNotifiedDay,
        )
        val count = bytes[12].toInt() and 255
        var places: Map<String, Place?>? = null
        if (bytes[0].toInt() == 2) {
            plan = plan.copy(
                beyond = bytes[1].toInt() and 16 != 0,
                doneToday = count,
                owed = readU16(bytes, 13),
                pile = readU16(bytes, 15),
            )
            places = mapOf(
                "bg-1879" to readPlace(books, bytes, 20),
                "kjv-1769" to readPlace(books, bytes, 22),
            )
        }
        val updated = if (bytes[0].toInt() == 1) readU24(bytes, 13) else readU24(bytes, 17)
        return Decoded(finishDecoded(plan, count, books), updated, places)
    }

    fun enable(store: Store): String {
        val state = store.cloud()
        if (state.token.isEmpty()) {
            val token = generateToken()
            store.saveCloud(CloudState(true, token.canonical, bumpUpdated(0)))
            return pushNow(store)
        }
        store.saveCloud(state.copy(enabled = true))
        return "on"
    }

    fun disable(store: Store) {
        val state = store.cloud()
        store.saveCloud(state.copy(enabled = false))
    }

    fun rotate(store: Store): String {
        val token = generateToken()
        store.saveCloud(CloudState(true, token.canonical, bumpUpdated(0)))
        return pushNow(store)
    }

    fun pushNow(store: Store): String {
        val state = store.cloud()
        if (!state.enabled || state.token.isEmpty()) return "off"
        val parsed = parseToken(state.token) ?: return "bad"
        var updated = state.updatedMin
        if (updated == 0) {
            updated = minutesSinceEpoch()
            store.saveCloud(state.copy(updatedMin = updated))
        }
        val plain = encodePlan(store.plan(), updated, store.places())
        val sealed = seal(plain, parsed.key, parsed.id)
        if (sealed.size > SYNC_MAX) return "error"
        return try {
            http.newCall(syncCall("PUT", parsed, sealed)).execute().use { res ->
                if (res.isSuccessful) "saved" else "error"
            }
        } catch (_: Exception) {
            "offline"
        }
    }

    fun pull(store: Store, books: List<Book>): String {
        val state = store.cloud()
        if (!state.enabled || state.token.isEmpty()) return "off"
        val parsed = parseToken(state.token) ?: return "bad"
        val res = try {
            http.newCall(syncCall("GET", parsed, ByteArray(0))).execute()
        } catch (_: Exception) {
            return "offline"
        }
        res.use { response ->
            if (response.code == 404) {
                val pushed = pushNow(store)
                return if (pushed == "saved") "uploaded" else pushed
            }
            if (!response.isSuccessful) return "error"
            val blob = response.body?.bytes() ?: return "error"
            val plain = openSeal(blob, parsed.key, parsed.id) ?: return "bad"
            val decoded = decodePlan(plain, books, store.plan()) ?: return "bad"
            if (decoded.updatedMin > state.updatedMin) {
                applyRemote(store, decoded)
                return "remote"
            }
            if (state.updatedMin > decoded.updatedMin) {
                val pushed = pushNow(store)
                return if (pushed == "saved") "local" else pushed
            }
            return "same"
        }
    }

    fun join(store: Store, text: String, books: List<Book>): String {
        val parsed = parseToken(text) ?: return "bad"
        val res = try {
            http.newCall(syncCall("GET", parsed, ByteArray(0))).execute()
        } catch (_: Exception) {
            return "offline"
        }
        res.use { response ->
            if (response.code == 404) {
                store.saveCloud(CloudState(true, parsed.canonical, bumpUpdated(store.cloud().updatedMin)))
                val pushed = pushNow(store)
                return if (pushed == "saved") "uploaded" else pushed
            }
            if (!response.isSuccessful) return "error"
            val blob = response.body?.bytes() ?: return "error"
            val plain = openSeal(blob, parsed.key, parsed.id) ?: return "bad"
            val decoded = decodePlan(plain, books, store.plan()) ?: return "bad"
            store.saveCloud(CloudState(true, parsed.canonical, decoded.updatedMin))
            store.savePlan(decoded.plan)
            decoded.places?.let { store.savePlaces(it) }
            return "joined"
        }
    }

    private fun syncCall(method: String, token: Token, body: ByteArray): Request {
        val builder = Request.Builder()
            .url("$ORIGIN/api/sync/${token.idHex}")
            .header("User-Agent", "66ksiag-android/2.0")
        for ((name, value) in SyncSign.headers(method, token.id, token.key, token.idHex, body)) {
            builder.header(name, value)
        }
        if (method == "PUT") builder.put(body.toRequestBody(octet))
        return builder.build()
    }

    private fun applyRemote(store: Store, decoded: Decoded) {
        store.savePlan(decoded.plan)
        decoded.places?.let { store.savePlaces(it) }
        val state = store.cloud()
        store.saveCloud(state.copy(updatedMin = decoded.updatedMin))
    }

    private fun finishDecoded(plan: Plan, count: Int, books: List<Book>): Plan {
        val today = todayKey()
        var next = plan
        if (next.day != today && next.owed == null) {
            val quota = dailyQuota(next)
            next = next.copy(owed = max(0, quota - min(count, quota)))
        }
        next = next.copy(readToday = if (next.day == today) readTodayFrom(books, next, count) else emptyList())
        return next.accrued()
    }

    private fun readTodayFrom(books: List<Book>, plan: Plan, count: Int): List<String> {
        if (books.isEmpty() || count == 0 || plan.day != todayKey()) return emptyList()
        val list = buildChapterList(books, plan)
        val cursor = plan.cursor
        val n = min(count, min(cursor, list.size))
        if (n <= 0) return emptyList()
        return list.subList(cursor - n, cursor)
    }

    private fun seal(plain: ByteArray, key: ByteArray, id: ByteArray): ByteArray {
        val iv = ByteArray(12).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        cipher.updateAAD(id)
        return iv + cipher.doFinal(plain)
    }

    private fun openSeal(blob: ByteArray, key: ByteArray, id: ByteArray): ByteArray? {
        if (blob.size < SYNC_MIN || blob.size > SYNC_MAX) return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, blob.copyOfRange(0, 12)))
            cipher.updateAAD(id)
            cipher.doFinal(blob.copyOfRange(12, blob.size))
        } catch (_: Exception) {
            null
        }
    }

    private fun encodeBase32(bytes: ByteArray): String {
        var bits = 0
        var value = 0
        val out = StringBuilder()
        for (b in bytes) {
            value = (value shl 8) or (b.toInt() and 255)
            bits += 8
            while (bits >= 5) {
                bits -= 5
                out.append(ALPHABET[(value shr bits) and 31])
            }
        }
        if (bits > 0) out.append(ALPHABET[(value shl (5 - bits)) and 31])
        return out.toString()
    }

    private fun decodeBase32(text: String): ByteArray? {
        var bits = 0
        var value = 0
        val out = ArrayList<Byte>(TOKEN_BYTES)
        for (c in text) {
            val idx = ALPHABET.indexOf(c)
            if (idx < 0) return null
            value = (value shl 5) or idx
            bits += 5
            if (bits >= 8) {
                bits -= 8
                out.add(((value shr bits) and 255).toByte())
            }
        }
        return if (out.size == TOKEN_BYTES) out.toByteArray() else null
    }

    private fun bookIndex(id: String): Int {
        val n = id.take(2).toIntOrNull() ?: return 0
        return if (n in 1..66) n - 1 else 0
    }

    private fun bookIdAt(books: List<Book>, index: Int, fallback: String): String =
        books.find { bookIndex(it.id) == index }?.id ?: fallback

    private fun writePlace(buf: ByteArray, off: Int, place: Place?) {
        if (place == null) {
            buf[off] = 255.toByte()
            buf[off + 1] = 0
            return
        }
        buf[off] = bookIndex(place.book).toByte()
        buf[off + 1] = clamp(place.chapter, 1, 255).toByte()
    }

    private fun readPlace(books: List<Book>, buf: ByteArray, off: Int): Place? {
        val index = buf[off].toInt() and 255
        val chapter = buf[off + 1].toInt() and 255
        if (index == 255 || chapter == 0) return null
        val book = books.find { bookIndex(it.id) == index }?.id ?: return null
        return Place(book, chapter)
    }

    private fun dayNumber(key: String): Int {
        val date = try {
            LocalDate.parse(key)
        } catch (_: Exception) {
            return 0
        }
        return max(0, min(0xffff, ChronoUnit.DAYS.between(EPOCH_DAY, date).toInt()))
    }

    private fun dayKey(n: Int): String = EPOCH_DAY.plusDays(n.toLong()).toString()

    private fun clamp(n: Int, minV: Int, maxV: Int) = max(minV, min(maxV, n))

    private fun writeU16(buf: ByteArray, off: Int, n: Int) {
        val v = clamp(n, 0, 0xffff)
        buf[off] = (v and 255).toByte()
        buf[off + 1] = ((v shr 8) and 255).toByte()
    }

    private fun readU16(buf: ByteArray, off: Int) =
        (buf[off].toInt() and 255) or ((buf[off + 1].toInt() and 255) shl 8)

    private fun writeU24(buf: ByteArray, off: Int, n: Int) {
        val v = clamp(n, 0, 0xffffff)
        buf[off] = (v and 255).toByte()
        buf[off + 1] = ((v shr 8) and 255).toByte()
        buf[off + 2] = ((v shr 16) and 255).toByte()
    }

    private fun readU24(buf: ByteArray, off: Int) =
        (buf[off].toInt() and 255) or ((buf[off + 1].toInt() and 255) shl 8) or ((buf[off + 2].toInt() and 255) shl 16)
}
