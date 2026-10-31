package pl.ksiag.app.ui

import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.resources.Density
import org.junit.Rule
import org.junit.Test
import pl.ksiag.app.model.copyFor

/**
 * Zrzut Compose w oknie 360×800 przy 160 dpi (1 dp = 1 px CSS).
 * scripts/ui-parity.sh porównuje go piksel w piksel ze zrzutem PWA.
 */
class ParityShotTest {
    @get:Rule
    val paparazzi = Paparazzi(
        deviceConfig = DeviceConfig(
            screenWidth = 360,
            screenHeight = 800,
            xdpi = 160,
            ydpi = 160,
            density = Density.create(160),
        ),
        maxPercentDifference = 0.0,
    )

    @Test
    fun pick() {
        val copy = copyFor(null)
        paparazzi.snapshot {
            KsiagTheme(kjv = false) {
                PickScreen(copy) {}
            }
        }
    }

    @Test
    fun home() {
        val copy = copyFor(null)
        paparazzi.snapshot {
            KsiagTheme(kjv = false) {
                HomeScreen(
                    copy = copy,
                    readMain = copy.startRead,
                    readSub = copy.startGenesis,
                    showAudio = false,
                    downloadLabel = "",
                    downloadButton = copy.audioDownload,
                    downloadEnabled = true,
                    showMeter = false,
                    meterPct = 0,
                    showClear = false,
                    clearLabel = copy.audioClear,
                    onRead = {},
                    onBooks = {},
                    onChangeEdition = {},
                    onDownload = {},
                    onClearAudio = {},
                    sourceName = copy.homeSourceName,
                    onSource = {},
                )
            }
        }
    }
}
