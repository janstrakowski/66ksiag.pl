# Android TWA — 66ksiąg

Trusted Web Activity (Bubblewrap) wokół PWA: https://66ksiag.pl  
Package ID: `pl.ksiag.app`

## Wymagania lokalne

- JDK 17 (`mise use -g java@temurin-17`)
- Android SDK w `~/Android/Sdk` (platform-tools, build-tools 36.1.0, platforms;android-34)
- Bubblewrap: `npx @bubblewrap/cli`
- Keystore: `android/android.keystore` + `android/secrets/keystore.env` (poza gitem)

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

## Natywne dodatki (poza Bubblewrap)

Natywne Activity (poza szablonem Bubblewrap — przywróć po `bubblewrap update`):

- `NotificationSettingsActivity` — `ksiag://notification-settings` (przełącznik Androida)
- `SiteSettingsActivity` — `ksiag://site-settings` (zgoda Chrome dla strony; to zwykle odblokowuje `Notification.permission`)

## Play Console

1. Utwórz aplikację → upload `app-release-bundle.aab`.
2. Włącz Play App Signing; dodaj SHA-256 **app signing key** do `assetlinks.json` i zredeployuj Worker.
3. Wypełnij listing, content rating, privacy policy.
