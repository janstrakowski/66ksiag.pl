# Android — 66ksiąg

Natywny klient (Kotlin, Jetpack Compose). Tekst BG/KJV jest bundlowany w APK (`syncBibleAssets` z `data/`); audio KJV z sieci (z opcją pobrania offline).  
Package ID: `com.jastrakowski.sixsixksiag`

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

- Czytnik, spis, karta — Compose, te same kroje (Cardo, Cinzel) i kolory co `web/styles.css`
- Audio KJV: Media3 + MediaSession (pauza/wznów/następny/poprzedni rozdział w powiadomieniu i na ekranie blokady); pobieranie MP3 (`AudioDownloadService`)
- Tekst Biblii: assets z `data/` (bez pobierania rozdziałów z sieci)

## Play Console — Internal Testing (od zera, bez publikacji na Production)

Aplikacja jest publikowana wyłącznie na ścieżkę **Internal testing** (`internal`). Skrypty CI odmawiają wysłania na `production`, `beta` lub `alpha`.

### 1. Klucz podpisu (Upload Key)

Jeśli masz już `android/android.keystore` i `android/secrets/keystore.env`, przejdź do kroku 2. W przeciwnym razie wygeneruj nowy klucz uploadu:

```bash
mkdir -p android/secrets
keytool -genkeypair \
  -v \
  -keystore android/android.keystore \
  -alias android \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

cat > android/secrets/keystore.env <<'EOF'
ANDROID_KEYSTORE_PASSWORD=twoje-haslo
ANDROID_KEY_PASSWORD=twoje-haslo
ANDROID_KEY_ALIAS=android
EOF
chmod 600 android/android.keystore android/secrets/keystore.env
```

Zakoduj keystore do Base64 dla zmiennej CI `ANDROID_KEYSTORE_BASE64`:

```bash
base64 -w0 android/android.keystore
```

### 2. Utworzenie aplikacji i pierwszy ręczny upload na Internal testing

Google Play Developer API pozwala na automatyczne wgrywanie kolejnych wydań dopiero po utworzeniu aplikacji i wgraniu pierwszego pliku `.aab` w konsoli.

1. Zbuduj lokalnie pierwszy podpisany pakiet `.aab`:
   ```bash
   npm run android:build
   # → android/app-release-bundle.aab
   ```
2. W [Google Play Console](https://play.google.com/console/) kliknij **Create app** (Utwórz aplikację):
   - **App name**: `66ksiąg`
   - **Default language**: `Polish (Poland) – pl-PL`
   - **App or game**: `App`
   - **Free or paid**: `Free`
   - Zaakceptuj deklaracje Developer Program Policies i US export laws → **Create app**.
3. W menu bocznym przejdź do **Test and release → Testing → Internal testing** (nie wchodź w Production):
   - W sekcji **Testers** utwórz listę testerów (np. `Internal`), dodaj swoje adresy Gmail i zapisz.
   - Kliknij **Create new release**.
   - W sekcji **Play App Signing** kliknij **Choose signing key** → **Use Google-generated key**.
   - Wgraj plik `android/app-release-bundle.aab`.
   - Kliknij **Next** → **Save and publish** (lub **Save as draft**, jeśli konsola nie ma jeszcze wypełnionych formularzy App content; dla testów wewnętrznych nowy app działa od razu na Internal testing bez publicznej recenzji).
   - Skopiuj link zaproszenia z zakładki **Testers → Copy link** i zaakceptuj udział w testach na telefonie.

### 3. Konto usługowe (Service Account) dla Google Play Android Developer API

1. W [Google Cloud Console](https://console.cloud.google.com/) utwórz lub wybierz projekt i włącz **Google Play Android Developer API** (`androidpublisher.googleapis.com`).
2. Przejdź do **IAM & Admin → Service Accounts → Create Service Account**:
   - Nazwa: np. `ksiag-play-internal-ci`
   - Po utworzeniu wejdź w zakładkę **Keys → Add Key → Create new key → JSON** i zapisz plik JSON (to wartość dla `PLAY_SERVICE_ACCOUNT_JSON`).
3. W **Google Play Console → Users and permissions → Invite new users**:
   - Wklej adres e-mail konta usługowego (`client_email` z pliku JSON).
   - W zakładce **App permissions** dodaj aplikację `66ksiąg` (`com.jastrakowski.sixsixksiag`).
   - Zaznacz uprawnienia:
     - **View app information and download bulk reports (read-only)**
     - **Release to testing tracks** (obejmuje Internal testing — nie musisz nadawać uprawnień do Production).
   - Kliknij **Invite user** → **Send invite**.

### 4. Sekrety CI i automatyczny upload każdej gałęzi poza `main` do Internal App Sharing

Przy każdym pushu na dowolną gałąź inną niż `main` (`dev`, gałęzie PR itd.):
- `scripts/build-dist.sh` (uruchamiany w Cloudflare Workers Builds przed wczytaniem manifestu `dist/` przez Wranglera) wywołuje `bash scripts/android-play-internal.sh --if-non-main-branch`.
- Skrypt buduje podpisany `android/app-release-bundle.aab` i wysyła go do **Google Play Internal App Sharing** (`POST /upload/androidpublisher/v3/applications/internalappsharing/com.jastrakowski.sixsixksiag/artifacts/bundle?uploadType=media`).
- Zwrócony link `downloadUrl` jest wypisywany w logu builda oraz zapisywany do `dist/android-preview.json` (`{ branch, commit, versionName, versionCode, downloadUrl, certificateFingerprint, sha256, builtAt }`), dzięki czemu podgląd każdej gałęzi udostępnia go pod adresem `https://<branch>.66ksiag.pl/android-preview.json` (np. `https://dev.66ksiag.pl/android-preview.json`).
- Jednorazowe ustawienie w Play Console: **Test and release → Setup → Internal app sharing**:
  - **Manage uploaders**: dodaj adres e-mail konta usługowego (`ksiag-play-internal-ci@...iam.gserviceaccount.com`) lub zaznacz **Anyone you shared the link with can upload**.
  - **Manage testers**: wybierz **Anyone you shared the link with can download** (lub dodaj listę swoich adresów Gmail).

Skonfiguruj 5 sekretów w **Cloudflare Dashboard → Workers & Pages → `66ksiag` → Settings → Builds → Variables and Secrets** (oraz opcjonalnie lokalnie w `android/secrets/keystore.env`):

| Zmienna | Opis |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Wynik `base64 -w0 android/android.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | Hasło do keystore |
| `ANDROID_KEY_ALIAS` | Alias klucza (domyślnie `android`) |
| `ANDROID_KEY_PASSWORD` | Hasło do klucza (zwykle to samo co `ANDROID_KEYSTORE_PASSWORD`) |
| `PLAY_SERVICE_ACCOUNT_JSON` | Zawartość pliku JSON konta usługowego (raw JSON lub zakodowana w Base64) |

Ręczne wywołanie publikacji na ścieżkę `internal`:

```bash
npm run android:play:internal
```
