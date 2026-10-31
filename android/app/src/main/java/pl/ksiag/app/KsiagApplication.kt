package pl.ksiag.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class KsiagApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_AUDIO, "Audio KJV", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Pobieranie audio Scourby"
            },
        )
    }

    companion object {
        const val CHANNEL_AUDIO = "ksiag_audio"
    }
}
