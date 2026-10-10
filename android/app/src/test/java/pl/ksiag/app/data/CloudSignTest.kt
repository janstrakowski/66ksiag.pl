package pl.ksiag.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

class CloudSignTest {
    @Test
    fun theAesKeySignsTheSameRequestAsTheWebClient() {
        val id = ByteArray(16) { 0x11 }
        val key = ByteArray(16) { 0x22 }
        val idHex = id.joinToString("") { "%02x".format(it) }
        val headers = SyncSign.headers("PUT", id, key, idHex, byteArrayOf(1, 2, 3), 1_700_000_000)
        assertEquals("1700000000", headers["x-sync-time"])
        assertEquals("d973953ef96acf7b5a5da2b294fe0f91f9e8ff87b241bd72bdbeb0f089de8256", headers["x-sync-pub"])
        assertEquals(
            "39d22614bb1797b5537acf4ea476e75a27d640fe4823cafc8c235fa00b8454621ee9d09ba9c62b066daea6ddd0870da78de245db61d1e3d0d68855e1dea8f701",
            headers["x-sync-sign"],
        )
    }
}
