package pl.ksiag.app.notify

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import pl.ksiag.app.data.Store
import pl.ksiag.app.model.wantsNotifications
import java.time.ZonedDateTime

object Reminders {
    private const val REQ = 66

    fun schedule(context: Context) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val whenMs = nextEight()
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, whenMs, pending(context))
    }

    fun cancel(context: Context) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        am.cancel(pending(context))
    }

    fun sync(context: Context, wanted: Boolean) {
        if (wanted) schedule(context) else cancel(context)
    }

    private fun pending(context: Context): PendingIntent {
        val intent = Intent(context, PlanAlarmReceiver::class.java)
        return PendingIntent.getBroadcast(
            context,
            REQ,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun nextEight(): Long {
        val now = ZonedDateTime.now()
        var t = now.withHour(8).withMinute(0).withSecond(0).withNano(0)
        if (!t.isAfter(now)) t = t.plusDays(1)
        return t.toInstant().toEpochMilli()
    }
}

class PlanAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val pending = goAsync()
        Thread {
            try {
                Debt.sync(context)
            } finally {
                if (Store(context).plan().wantsNotifications()) Reminders.schedule(context)
                pending.finish()
            }
        }.start()
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (Store(context).plan().wantsNotifications()) Reminders.schedule(context)
        Debt.sync(context)
    }
}
