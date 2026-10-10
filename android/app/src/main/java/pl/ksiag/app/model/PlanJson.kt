package pl.ksiag.app.model

import org.json.JSONArray
import org.json.JSONObject

fun Plan.toJson(): String {
    val o = JSONObject()
    o.put("enabled", enabled)
    o.put("goal", goal)
    o.put("fromBook", fromBook)
    o.put("fromChapter", fromChapter)
    o.put("toBook", toBook)
    o.put("toChapter", toChapter)
    o.put("mode", mode)
    o.put("chaptersPerDay", chaptersPerDay)
    o.put("minutesPerDay", minutesPerDay)
    o.put("notifications", notifications)
    o.put("day", day)
    o.put("readToday", JSONArray(readToday))
    o.put("cursor", cursor)
    if (owed != null) o.put("owed", owed)
    if (pile != null) o.put("pile", pile)
    o.put("beyond", beyond)
    o.put("doneToday", doneToday)
    if (startNotifiedDay != null) o.put("startNotifiedDay", startNotifiedDay)
    return o.toString()
}

fun planFromJson(raw: String?): Plan {
    if (raw.isNullOrBlank()) return defaultPlan()
    return try {
        val o = JSONObject(raw)
        val read = o.optJSONArray("readToday")
        val base = defaultPlan()
        Plan(
            enabled = o.optBoolean("enabled", base.enabled),
            goal = o.optString("goal", base.goal),
            fromBook = o.optString("fromBook", base.fromBook),
            fromChapter = o.optInt("fromChapter", base.fromChapter),
            toBook = o.optString("toBook", base.toBook),
            toChapter = o.optInt("toChapter", base.toChapter),
            mode = o.optString("mode", base.mode),
            chaptersPerDay = o.optInt("chaptersPerDay", base.chaptersPerDay),
            minutesPerDay = o.optInt("minutesPerDay", base.minutesPerDay),
            notifications = o.optBoolean("notifications", base.notifications),
            day = o.optString("day", base.day),
            readToday = if (read == null) emptyList() else List(read.length()) { read.getString(it) },
            cursor = o.optInt("cursor", 0),
            owed = if (!o.has("owed") || o.isNull("owed")) null else o.optInt("owed"),
            pile = if (!o.has("pile") || o.isNull("pile")) null else o.optInt("pile"),
            beyond = o.optBoolean("beyond", false),
            doneToday = o.optInt("doneToday", 0),
            startNotifiedDay = if (o.isNull("startNotifiedDay")) null else o.optString("startNotifiedDay").ifBlank { null },
        ).accrued()
    } catch (_: Exception) {
        defaultPlan()
    }
}
