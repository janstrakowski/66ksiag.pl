package pl.ksiag.app.audio

import android.content.Intent
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import pl.ksiag.app.MainActivity
import pl.ksiag.app.R

class PlaybackService : MediaSessionService() {
    private var player: Player? = null
    private var exo: ExoPlayer? = null
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val notification = DefaultMediaNotificationProvider(this)
        notification.setSmallIcon(R.drawable.ic_notification_icon)
        setMediaNotificationProvider(notification)

        val exoPlayer = ExoPlayer.Builder(this).build().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                    .build(),
                true,
            )
            setHandleAudioBecomingNoisy(true)
        }
        exo = exoPlayer
        val wrapped: Player = object : ForwardingPlayer(exoPlayer) {
            override fun getAvailableCommands(): Player.Commands =
                super.getAvailableCommands()
                    .buildUpon()
                    .add(COMMAND_SEEK_TO_NEXT)
                    .add(COMMAND_SEEK_TO_PREVIOUS)
                    .add(COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                    .add(COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                    .build()

            override fun isCommandAvailable(command: @Player.Command Int): Boolean =
                command == COMMAND_SEEK_TO_NEXT ||
                    command == COMMAND_SEEK_TO_PREVIOUS ||
                    command == COMMAND_SEEK_TO_NEXT_MEDIA_ITEM ||
                    command == COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM ||
                    super.isCommandAvailable(command)

            override fun seekToNext() = PlaybackBus.next()

            override fun seekToPrevious() = PlaybackBus.previous()

            override fun seekToNextMediaItem() = PlaybackBus.next()

            override fun seekToPreviousMediaItem() = PlaybackBus.previous()
        }
        player = wrapped
        val activity = android.app.PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
        )
        session = MediaSession.Builder(this, wrapped).setSessionActivity(activity).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        val p = exo
        if (p == null || !p.playWhenReady || p.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        session?.release()
        session = null
        player = null
        exo?.release()
        exo = null
        super.onDestroy()
    }
}
