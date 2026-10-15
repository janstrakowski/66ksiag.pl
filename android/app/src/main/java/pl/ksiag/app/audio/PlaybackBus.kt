package pl.ksiag.app.audio

import kotlinx.coroutines.flow.MutableSharedFlow

/** MediaSession next/previous → app chapter navigation. */
object PlaybackBus {
    enum class Skip { Next, Previous }

    val skips = MutableSharedFlow<Skip>(extraBufferCapacity = 8)

    fun next() {
        skips.tryEmit(Skip.Next)
    }

    fun previous() {
        skips.tryEmit(Skip.Previous)
    }
}
