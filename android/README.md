# Android — 66ksiąg

Natywny klient (Kotlin, Jetpack Compose). Czyta to samo statyczne API co strona (`https://66ksiag.pl`).  
Package ID: `pl.ksiag.app`

Nie uruchamiaj Bubblewrap (`bubblewrap build` / `update`) — nadpisze ten projekt szablonem TWA.

## Wymagania lokalne

- JDK 17 (`mise use -g java@temurin-17`)
- Android SDK w `~/Android/Sdk` (platform-tools, build-tools 36.1.0, platforms;android-36)
- Keystore: `android/android.keystore` + `android/secrets/keystore.env` (poza gitem; `KEYSTORE_PASSWORD`, `KEY_PASSWORD`, `KEY_ALIAS`)

## Build

```bash
bash scripts/android-build.sh
# → android/app-release-signed.apk  (test USB)
# → android/app-release-bundle.aab  (Play Console)
```

## Test na telefonie (bez roota)

Telefon musi wystawić interfejs **ADB** (sam MTP nie wystarczy — `lsusb` pokazuje wtedy tylko „Galaxy series, misc. (MTP mode)”).

1. S24: **Ustawienia → Informacje o telefonie** → 7× **Numer kompilacji** → Opcje deweloperskie.
2. **Opcje deweloperskie → Debugowanie USB** = ON (ew. też „Debugowanie USB (ustawienia zabezpieczeń)”).
3. Podłącz kabel; na pasku powiadomień: **USB → Transfer plików / MTP**.
4. Zaakceptuj dialog **„Zezwolić na debugowanie USB?”** (RSA).
5. Sprawdź: `adb devices` → status `device` (nie `unauthorized` / pusto).
6. Instalacja:

```bash
npm run android:install
# lub: bash scripts/android-install.sh
```

Opcjonalnie udev (jeśli `adb` nie widzi urządzenia mimo debugowania):

```bash
sudo cp android/51-android.udev.rules /etc/udev/rules.d/51-android.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

## Digital Asset Links

Publikowane z `web/.well-known/assetlinks.json` → https://66ksiag.pl/.well-known/assetlinks.json  
Fingerprint z lokalnego upload key (po Play App Signing dodaj też fingerprint z konsoli Play).

## Co jest natywne

- Czytnik, spis, karta, plan — Compose, te same kroje (Cardo, Cinzel) i kolory co `web/styles.css`
- Powiadomienia planu: `NotificationManager` + alarm o 8:00 (`PlanAlarmReceiver`)
- Audio KJV: Media3 (odtwarzanie w tle) i pobieranie MP3 do plików aplikacji (`AudioDownloadService`)

## Play Console

1. Utwórz aplikację → upload `app-release-bundle.aab`.
2. Włącz Play App Signing; dodaj SHA-256 **app signing key** do `assetlinks.json` i zredeployuj Worker.
3. Wypełnij listing, content rating, privacy policy.
