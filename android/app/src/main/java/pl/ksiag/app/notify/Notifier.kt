package pl.ksiag.app.notify

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import pl.ksiag.app.MainActivity
import pl.ksiag.app.R

object Notifier {
    const val ID_DOWNLOAD = 4

    fun allowed(context: Context): Boolean {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm != null && !nm.areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT >= 33) {
            return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        }
        return true
    }

    fun show(context: Context, channel: String, title: String, body: String, id: Int) {
        if (!allowed(context)) return
        val n = base(context, channel, title, body, id)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .build()
        context.getSystemService(NotificationManager::class.java)?.notify(id, n)
    }

    private fun base(context: Context, channel: String, title: String, body: String, id: Int): NotificationCompat.Builder {
        val open = PendingIntent.getActivity(
            context,
            id,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification_icon)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(open)
    }
}
