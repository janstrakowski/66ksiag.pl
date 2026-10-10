package pl.ksiag.app.data

import net.i2p.crypto.eddsa.EdDSAPrivateKey
import net.i2p.crypto.eddsa.EdDSASecurityProvider
import net.i2p.crypto.eddsa.spec.EdDSANamedCurveTable
import net.i2p.crypto.eddsa.spec.EdDSAPrivateKeySpec
import java.security.Security
import java.security.Signature
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Podpis żądania synchronizacji. Ziarno Ed25519 to HKDF-SHA256 z klucza AES,
 * sól = numer slotu, info = "ksiag-sync-sign". Kanoniczne bajty jak w web/cloud.js:
 * metoda, numer slotu, czas, klucz publiczny, ciało.
 */
internal object SyncSign {
    private val curve = EdDSANamedCurveTable.getByName("Ed25519")

    init {
        if (Security.getProvider("EdDSA") == null) Security.addProvider(EdDSASecurityProvider())
    }

    fun headers(
        method: String,
        id: ByteArray,
        key: ByteArray,
        idHex: String,
        body: ByteArray,
        nowSec: Long = System.currentTimeMillis() / 1000,
    ): Map<String, String> {
        val priv = EdDSAPrivateKey(EdDSAPrivateKeySpec(hkdf(key, id), curve))
        val pubHex = priv.abyte.toHex()
        val time = nowSec.toString()
        val signer = Signature.getInstance("NONEwithEdDSA", "EdDSA")
        signer.initSign(priv)
        signer.update(canonical(method, idHex, time, pubHex, body))
        return mapOf(
            "x-sync-time" to time,
            "x-sync-pub" to pubHex,
            "x-sync-sign" to signer.sign().toHex(),
        )
    }

    private fun hkdf(ikm: ByteArray, salt: ByteArray): ByteArray {
        val extract = Mac.getInstance("HmacSHA256")
        extract.init(SecretKeySpec(salt, "HmacSHA256"))
        val prk = extract.doFinal(ikm)
        val expand = Mac.getInstance("HmacSHA256")
        expand.init(SecretKeySpec(prk, "HmacSHA256"))
        expand.update("ksiag-sync-sign".toByteArray(Charsets.US_ASCII))
        expand.update(1.toByte())
        return expand.doFinal()
    }

    private fun canonical(method: String, idHex: String, time: String, pubHex: String, body: ByteArray): ByteArray {
        val head = "$method\n$idHex\n$time\n$pubHex\n".toByteArray(Charsets.US_ASCII)
        return head + body
    }

    private fun ByteArray.toHex() = joinToString("") { "%02x".format(it) }
}
