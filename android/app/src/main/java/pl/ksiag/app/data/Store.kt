package pl.ksiag.app.data

import android.content.Context
import pl.ksiag.app.model.Edition

class Store(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("ksiag", Context.MODE_PRIVATE)

    fun edition(): Edition? = Edition.find(prefs.getString(KEY_EDITION, null))

    fun saveEdition(edition: Edition?) {
        prefs.edit().apply {
            if (edition == null) remove(KEY_EDITION) else putString(KEY_EDITION, edition.id)
        }.apply()
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
    }
}

data class Place(val book: String, val chapter: Int)
