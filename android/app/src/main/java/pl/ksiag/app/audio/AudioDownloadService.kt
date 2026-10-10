package pl.ksiag.app.audio

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import pl.ksiag.app.KsiagApplication
import pl.ksiag.app.R
import pl.ksiag.app.data.AudioFiles
import pl.ksiag.app.data.Repository
import pl.ksiag.app.data.Store
import pl.ksiag.app.model.ORIGIN
import pl.ksiag.app.model.copyFor
import pl.ksiag.app.notify.Notifier
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

data class DownloadState(
    val running: Boolean = false,
    val done: Int = 0,
    val total: Int = 0,
    val have: Int = 0,
    val catalog: Int = 0,
    val eta: String? = null,
    val failed: Boolean = false,
)

object DownloadBus {
    val state = MutableStateFlow(DownloadState())

    @Volatile
    var cancel = false

    @Volatile
    var call: Call? = null
}

class AudioDownloadService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .callTimeout(3, TimeUnit.MINUTES)
        .build()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_CANCEL) {
            DownloadBus.cancel = true
            DownloadBus.call?.cancel()
            job?.cancel()
            return START_NOT_STICKY
        }
        if (job?.isActive == true) return START_NOT_STICKY
        DownloadBus.cancel = false
        startForeground(Notifier.ID_DOWNLOAD, note(0, 0, null))
        job = scope.launch { run() }
        return START_NOT_STICKY
    }

    private suspend fun run() {
        val copy = copyFor(Store(this).edition())
        try {
            val repo = Repository(this)
            val chapters = repo.cachedCatalog() ?: repo.catalog()
            val missing = chapters.filter { ch ->
                val f = AudioFiles.file(this, ch.book, ch.chapter)
                !f.exists() || f.length() < 1000
            }
            val have = chapters.size - missing.size
            if (missing.isEmpty()) {
                DownloadBus.state.value = DownloadState(have = chapters.size, catalog = chapters.size)
                Notifier.show(this, KsiagApplication.CHANNEL_AUDIO, copy.audioDownloadNotifyTitle, copy.audioDownloadFinished, Notifier.ID_DOWNLOAD)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return
            }
            val started = System.currentTimeMillis()
            var completed = 0
            for (ch in missing) {
                if (DownloadBus.cancel) break
                val eta = eta(completed, missing.size, started, copy)
                DownloadBus.state.value = DownloadState(
                    running = true,
                    done = completed,
                    total = missing.size,
                    have = have + completed,
                    catalog = chapters.size,
                    eta = eta,
                )
                getSystemService(android.app.NotificationManager::class.java)
                    ?.notify(Notifier.ID_DOWNLOAD, note(have + completed, chapters.size, eta))
                val dest = AudioFiles.file(this, ch.book, ch.chapter)
                dest.parentFile?.mkdirs()
                val tmp = dest.resolveSibling(dest.name + ".part")
                val req = Request.Builder().url(ORIGIN + ch.url).header("User-Agent", "66ksiag-android/2.0").build()
                val call = client.newCall(req)
                DownloadBus.call = call
                try {
                    call.execute().use { res ->
                        if (!res.isSuccessful) error("HTTP ${res.code}")
                        val body = res.body ?: error("empty")
                        tmp.outputStream().use { out -> body.byteStream().copyTo(out) }
                    }
                } finally {
                    DownloadBus.call = null
                }
                if (DownloadBus.cancel) {
                    tmp.delete()
                    break
                }
                if (!tmp.renameTo(dest)) {
                    tmp.copyTo(dest, overwrite = true)
                    tmp.delete()
                }
                completed += 1
                val finished = completed == missing.size
                DownloadBus.state.value = DownloadState(
                    running = !finished,
                    done = completed,
                    total = missing.size,
                    have = have + completed,
                    catalog = chapters.size,
                    eta = if (finished) null else eta(completed, missing.size, started, copy),
                )
                if (!finished) {
                    getSystemService(android.app.NotificationManager::class.java)
                        ?.notify(Notifier.ID_DOWNLOAD, note(have + completed, chapters.size, eta(completed, missing.size, started, copy)))
                }
            }
            val finalHave = AudioFiles.count(this)
            val all = finalHave >= chapters.size && chapters.isNotEmpty()
            DownloadBus.state.value = DownloadState(
                running = false,
                done = if (all) chapters.size else completed,
                total = missing.size,
                have = finalHave,
                catalog = chapters.size,
            )
            if (all) {
                Notifier.show(
                    this,
                    KsiagApplication.CHANNEL_AUDIO,
                    copy.audioDownloadNotifyTitle,
                    copy.audioDownloadFinished,
                    Notifier.ID_DOWNLOAD,
                )
            }
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            val finalHave = AudioFiles.count(this)
            DownloadBus.state.value = DownloadBus.state.value.copy(
                running = false,
                have = finalHave,
                failed = !DownloadBus.cancel,
            )
            if (!DownloadBus.cancel) {
                Notifier.show(
                    this,
                    KsiagApplication.CHANNEL_AUDIO,
                    copy.audioDownloadNotifyTitle,
                    copy.audioDownloadFailed,
                    Notifier.ID_DOWNLOAD,
                )
            }
        } finally {
            DownloadBus.call = null
            if (DownloadBus.state.value.running) {
                DownloadBus.state.value = DownloadBus.state.value.copy(
                    running = false,
                    have = AudioFiles.count(this),
                )
            }
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun eta(done: Int, total: Int, started: Long, copy: pl.ksiag.app.model.Copy): String? {
        val elapsed = (System.currentTimeMillis() - started) / 1000.0
        if (elapsed < 2 || done < 1) return null
        val left = ((total - done) / (done / elapsed) / 60.0).roundToInt()
        return copy.audioEtaMinutes(left.coerceAtLeast(1))
    }

    private fun note(have: Int, catalog: Int, eta: String?): Notification {
        val copy = copyFor(Store(this).edition())
        val cancel = PendingIntent.getService(
            this,
            1,
            Intent(this, AudioDownloadService::class.java).setAction(ACTION_CANCEL),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val pct = if (catalog == 0) 0 else ((have.toDouble() / catalog) * 100).roundToInt()
        return NotificationCompat.Builder(this, KsiagApplication.CHANNEL_AUDIO)
            .setSmallIcon(R.drawable.ic_notification_icon)
            .setContentTitle(copy.audioDownloadNotifyTitle)
            .setContentText(copy.audioDownloadProgress(have, catalog, pct, eta))
            .setProgress(catalog.coerceAtLeast(1), have.coerceAtMost(catalog.coerceAtLeast(1)), catalog == 0)
            .setOngoing(true)
            .addAction(0, copy.audioDownloadCancel, cancel)
            .build()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val ACTION_CANCEL = "pl.ksiag.app.AUDIO_CANCEL"

        fun start(context: Context) {
            val intent = Intent(context, AudioDownloadService::class.java)
            androidx.core.content.ContextCompat.startForegroundService(context, intent)
        }

        fun cancel(context: Context) {
            DownloadBus.cancel = true
            DownloadBus.call?.cancel()
            context.startService(Intent(context, AudioDownloadService::class.java).setAction(ACTION_CANCEL))
        }
    }
}
