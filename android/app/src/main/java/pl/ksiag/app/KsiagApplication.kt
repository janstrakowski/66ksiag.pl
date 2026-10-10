package pl.ksiag.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class KsiagApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_PLAN, "Plan dzienny", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Zaległe rozdziały planu. Znika, gdy dług spadnie do zera."
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_AUDIO, "Audio KJV", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Pobieranie audio Scourby"
            },
        )
    }

    companion object {
        const val CHANNEL_PLAN = "ksiag_plan"
        const val CHANNEL_AUDIO = "ksiag_audio"
    }
}
