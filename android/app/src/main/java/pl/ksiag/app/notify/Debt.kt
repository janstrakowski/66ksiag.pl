package pl.ksiag.app.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import pl.ksiag.app.KsiagApplication
import pl.ksiag.app.data.Store
import pl.ksiag.app.model.copyFor
import pl.ksiag.app.model.progressPct
import pl.ksiag.app.model.wantsNotifications
import kotlin.math.max

/** Jedno powiadomienie, póki [Plan.owed] > 0. Kasuje je spłata albo wyłączenie w planie. */
object Debt {
    fun sync(context: Context) {
        val app = context.applicationContext
        Notifier.cancel(app, Notifier.ID_START)
        Notifier.cancel(app, Notifier.ID_CONFIRM)
        val store = Store(app)
        val plan = store.plan()
        val owed = plan.owed
        if (!plan.wantsNotifications() || !Notifier.allowed(app) || owed == null || owed <= 0) {
            Notifier.cancel(app, Notifier.ID_PROGRESS)
            return
        }
        post(app, store, owed, silent = false)
    }

    /** Gest zrzucił powiadomienie. Wstaw z powrotem, jeśli dług nadal wisi. */
    fun repost(context: Context) {
        val app = context.applicationContext
        val store = Store(app)
        val plan = store.plan()
        val owed = plan.owed
        if (!plan.wantsNotifications() || !Notifier.allowed(app) || owed == null || owed <= 0) return
        post(app, store, owed, silent = true)
    }

    private fun post(app: Context, store: Store, owed: Int, silent: Boolean) {
        val plan = store.plan()
        val pile = max(plan.pile ?: owed, owed)
        val pct = progressPct(plan) ?: 0
        val copy = copyFor(store.edition())
        Notifier.showDebt(
            app,
            KsiagApplication.CHANNEL_PLAN,
            copy.plan,
            copy.debtBody(owed, pile),
            pct,
            silent,
        )
    }
}

class DebtRepostReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        Debt.repost(context)
    }
}
