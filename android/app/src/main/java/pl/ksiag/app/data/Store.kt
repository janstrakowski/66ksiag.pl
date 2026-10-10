package pl.ksiag.app.data

import android.content.Context
import pl.ksiag.app.model.Edition
import pl.ksiag.app.model.Plan
import pl.ksiag.app.model.planFromJson
import pl.ksiag.app.model.toJson

class Store(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("ksiag", Context.MODE_PRIVATE)

    fun edition(): Edition? = Edition.find(prefs.getString(KEY_EDITION, null))

    fun saveEdition(edition: Edition?) {
        prefs.edit().apply {
            if (edition == null) remove(KEY_EDITION) else putString(KEY_EDITION, edition.id)
        }.apply()
    }

    fun plan(): Plan = planFromJson(prefs.getString(KEY_PLAN, null))

    fun savePlan(plan: Plan) {
        prefs.edit().putString(KEY_PLAN, plan.toJson()).apply()
    }

    fun audioSession(): AudioSession = AudioSession(
        offerContinue = prefs.getBoolean(KEY_OFFER, false),
        nextBook = prefs.getString(KEY_NEXT_BOOK, null),
        nextChapter = prefs.getInt(KEY_NEXT_CH, 0).takeIf { it > 0 },
    )

    fun saveAudioSession(session: AudioSession) {
        prefs.edit()
            .putBoolean(KEY_OFFER, session.offerContinue)
            .putString(KEY_NEXT_BOOK, session.nextBook)
            .putInt(KEY_NEXT_CH, session.nextChapter ?: 0)
            .apply()
    }

    fun cloud(): CloudState = CloudState(
        enabled = prefs.getBoolean(KEY_CLOUD_ON, false),
        token = prefs.getString(KEY_CLOUD_TOKEN, "").orEmpty(),
        updatedMin = prefs.getInt(KEY_CLOUD_MIN, 0),
    )

    fun saveCloud(state: CloudState) {
        prefs.edit()
            .putBoolean(KEY_CLOUD_ON, state.enabled)
            .putString(KEY_CLOUD_TOKEN, state.token)
            .putInt(KEY_CLOUD_MIN, state.updatedMin)
            .apply()
    }

    fun places(): Map<String, Place?> = mapOf(
        "bg-1879" to place("bg-1879"),
        "kjv-1769" to place("kjv-1769"),
    )

    fun place(editionId: String): Place? {
        val raw = prefs.getString(placeKey(editionId), null) ?: return null
        val parts = raw.split("/")
        val chapter = parts.getOrNull(1)?.toIntOrNull() ?: return null
        if (parts[0].isEmpty() || chapter < 1) return null
        return Place(parts[0], chapter)
    }

    fun rememberPlace(editionId: String, bookId: String, chapter: Int) {
        if (editionId != "bg-1879" && editionId != "kjv-1769") return
        if (chapter < 1) return
        prefs.edit().putString(placeKey(editionId), "$bookId/$chapter").apply()
    }

    fun savePlaces(places: Map<String, Place?>) {
        val edit = prefs.edit()
        for (id in listOf("bg-1879", "kjv-1769")) {
            val place = places[id]
            if (place == null || place.chapter < 1) edit.remove(placeKey(id))
            else edit.putString(placeKey(id), "${place.book}/${place.chapter}")
        }
        edit.apply()
    }

    private fun placeKey(editionId: String) = "place_$editionId"

    companion object {
        private const val KEY_EDITION = "edition"
        private const val KEY_PLAN = "plan"
        private const val KEY_OFFER = "audio_offer"
        private const val KEY_NEXT_BOOK = "audio_book"
        private const val KEY_NEXT_CH = "audio_ch"
        private const val KEY_CLOUD_ON = "cloud_on"
        private const val KEY_CLOUD_TOKEN = "cloud_token"
        private const val KEY_CLOUD_MIN = "cloud_min"
    }
}

data class CloudState(
    val enabled: Boolean = false,
    val token: String = "",
    val updatedMin: Int = 0,
)

data class Place(val book: String, val chapter: Int)

data class AudioSession(
    val offerContinue: Boolean = false,
    val nextBook: String? = null,
    val nextChapter: Int? = null,
)
