# AGENTS.md — 66ksiąg

Dla agentów AI i contributorów. Szczegóły: [ARCHITECTURE.md](./ARCHITECTURE.md).

## Założenia

**UI natywne = strona.** Interfejs w `android/` ma to samo zachowanie i copy co strona. Źródłem kontraktu zostaje `web/`.

**Przed mergem udokumentuj zmiany.** Opisz, co się zmieniło i dlaczego — w commicie, opisie PR albo w docs, gdy zmienia się kontrakt.

**Przed mergem zsynchronizuj kod.** Przeczytaj diff między swoim branchem a docelowym i zaktualizuj swój kod, zanim zmergujesz.

## Co to jest

Statyczne API Biblii (BG 1879 + KJV) i strona. Warstwa plików w `data/` jest źródłem prawdy. Aplikacją jest klient w `android/`; `web/` jest zwykłą stroną (bez rejestracji service workera, bez manifestu aplikacji i bez pobierania audio). Worker na `/sw.js` oddaje tylko skrypt, który kasuje cache powłoki, kasuje pobrane audio i wyrejestrowuje już zainstalowanego workera.

**Numeracja:** wszystkie tłumaczenia na siatce KJV / tych samych ID (`01-gen`…). BG jest zremapowana; nowe wersje też muszą być.

## Kanoniczne ścieżki

```
/translations.json
/api/bg/…   /api/kjv/…
/api/{bg|kjv}/manifest.json
/api/{bg|kjv}/books.json
/api/{bg|kjv}/{book}/{chapter}.json
/api/{bg|kjv}/{book}/{chapter}.txt
/api/{bg|kjv}/{book}/{chapter}                 # ten sam MP3 co /kjv/1769/…/*.mp3
/api/{bg|kjv}/{book}/{chapter}/{verse}.json
/api/{bg|kjv}/{book}/{chapter}/{verse}.txt
/api/{bg|kjv}/{book}/{chapter}/{verse}         # audio wersetu, wycięte z MP3
```

`{book}` = np. `43-joh`. Aliasy w `books.json`. Wydanie (`1879`, `1769`) nie wchodzi do URL — jest w JSON.

Upload zostaje pod `/bg/1879` i `/kjv/1769`: JSON rozdziału, `.words.json` i MP3 rozdziału. Bez `.txt` i bez plików per-werset (limit 20 000 plików). MP3 KJV są Static Assets; hash LFS bierze się z `audio-assets-manifest.json`. Worker składa tekst i wycina audio wersetu. Brak księgi, rozdziału albo wersetu na `/api/…` to HTTP 404, nie skorupa strony.

## Import tekstu

Tekst wydań w `data/` jest w `.gitignore`. Źródła tekstu to submoduły w `sources/` (audio Scourby zostaje w `vendor/`, poza gitem). Po klonie: `git submodule update --init --checkout` (albo `node scripts/import-editions.mjs`).

```bash
# BG — sources/biblia-druk-tekst (pin: tools/import/SOURCE_PIN.txt)
cargo run -p ksiag-import --release -- \
  --source sources/biblia-druk-tekst/1879 --out data \
  --commit "$(git -C sources/biblia-druk-tekst rev-parse HEAD)"

# KJV — sources/bible-kjv
cargo run -p ksiag-import-kjv --release -- \
  --source sources/bible-kjv --out data \
  --commit "$(git -C sources/bible-kjv rev-parse HEAD)"
```

## Audio KJV (Scourby) — self-hosted (Git LFS)

KJV `data/kjv/1769/**/*.mp3` są w **Git LFS**. `*.words.json` są zwykłymi plikami gita (Workers Builds nie pobiera LFS). Tekst wydań w `data/` jest generowany z submodułów w `sources/`.

```bash
python3 tools/audio-kjv/fetch_scourby.py
# Do commita LFS potrzebne prawdziwe pliki (nie symlinki):
python3 tools/audio-kjv/install_layout.py          # copy → data/kjv/1769/{book}/{ch}.mp3
python3 tools/audio-kjv/build_catalog.py           # → web/audio-catalog.json (commit)
node tools/audio-kjv/build_assets_manifest.mjs     # → data/kjv/1769/audio-assets-manifest.json
git add data/kjv/1769/*/*.mp3 data/kjv/1769/*/*.words.json data/kjv/1769/audio-assets-manifest.json
```

`audio-assets-manifest.json` trzyma sha256 z wskaźnika LFS i hash Static Assets (`blake3(base64 + "mp3")`, 32 znaki hex). Po zmianie bajtów MP3 trzeba go przebudować i zacommitować. W czasie deployu wrangler wstawia ten hash zamiast hashowania wskaźnika. Cloudflare prosi tylko o brakujące hashe; te rozdziały są dociągane (lokalnie `git lfs pull`, w Builds z hosta public-domain) i usuwane z dysku po wysłaniu.

Strona odtwarza `/kjv/1769/…/*.mp3` z Workers Static Assets na tym samym originie. Nie ma „Pobierz audio” i nie zapisuje rozdziałów w Cache Storage.  
Szczegóły: `tools/audio-kjv/README.md`. `build-dist` kopiuje do `dist/` chapter JSON + `.words.json` + wskaźniki MP3 (bez `.txt` i per-verse — limit Workers Assets).

### Git LFS w Cloudflare R2 (tylko dev / tooling, poza produkcyjnym Workerem)

Produkcyjny Worker `66ksiag` (`wrangler.toml`, `worker/src/index.ts`) nie ma żadnych bindingów R2 ani tras LFS — na produkcji MP3 są wyłącznie w Workers Static Assets.

Do trzymania obiektów Git LFS (`objects/<sha256-oid>`) w buckecie R2 `66ksiag-audio` w środowisku deweloperskim służą:
- `scripts/git-lfs-r2.mjs` — lokalny custom transfer agent Git LFS (`npm run lfs:use-r2` zapisuje konfigurację w `.git/config`, bez dotykania produkcyjnej domeny; obsługuje bezpośrednie S3 API R2 przez `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`, `wrangler r2 object` lub osobnego dev Workera),
- `scripts/sync-lfs-to-r2.mjs` (`npm run lfs:sync-r2`) — skrypt synchronizujący obiekty LFS do bucketu R2 `66ksiag-audio` partiami,
- `tools/lfs-r2-worker/` (`npm run lfs:worker:deploy`) — opcjonalny, całkowicie osobny Worker dev/tooling `66ksiag-lfs` (`https://66ksiag-lfs.janstrakowski.workers.dev`, `workers_dev = true`, bez domeny produkcyjnej) wystawiający Git LFS Batch API nad bucketem `66ksiag-audio`.

Podgląd brancha to `https://<branch>.66ksiag.pl`. Apex, www i ten wildcard są Custom Domains; tworzy je `wrangler deploy`. Nie przywracaj rekordu A `*.66ksiag.pl`.

### Pobieranie audio w Androidzie

Jeden przycisk na karcie tytułowej aplikacji. `x` to rozdziały już zapisane lokalnie, `N` to cały katalog. Częściowe pobranie nie jest „pobranym audio”. Strona tego przycisku nie ma.

- Przycisk jest aktywny wtedy i tylko wtedy, gdy audio nie jest pobrane w całości.
- „Download audio” / „Pobierz audio” wtedy i tylko wtedy, gdy nie ma ani jednego rozdziału i nic się nie pobiera.
- „Cancel download” / „Anuluj pobieranie” wtedy i tylko wtedy, gdy pobieranie trwa.
- „Resume audio” / „Wznów audio” wtedy i tylko wtedy, gdy jest częściowo pobrane i pobieranie nie trwa.
- Gdy całość jest pobrana, przycisk jest nieaktywny i nosi „Audio is already downloaded.” / „Audio jest już pobrane.” — nie żaden z trzech napisów powyżej.
- „Clear downloaded audio” / „Usuń pobrane audio” jest widoczne wtedy i tylko wtedy, gdy audio jest pobrane w całości albo pobieranie jest wstrzymane. W trakcie pobierania go nie ma.
- „Audio is served here…” tylko gdy nie ma ani jednego rozdziału i nic się nie pobiera.
- Przy części — także po anulowaniu — status to „Wanting: x / N” (PL: „Brakujące: x / N”). Android pobiera rozdział po rozdziale. `x` rośnie po każdym zapisanym rozdziale i nie cofa się. Po anulowaniu zostaje na tej samej liczbie.
- Gdy całość jest pobrana, status to „Audio is already downloaded.” / „Audio jest już pobrane.”

## Front

`web/` czyta wyłącznie warstwę `data/`.

```bash
bash scripts/dev-serve.sh          # http://127.0.0.1:8787
npm run deploy                     # local wrangler deploy; automatic deploys are Workers Builds
```

## Harness (local tickets)

Ticket UI + Cursor `agent` CLI + git worktrees on the **dev machine**. `main` is the latest development. Workers Builds production branch is `prod` (`https://66ksiag.pl`). There is no `dev` branch.

```bash
npm run harness            # http://127.0.0.1:3900 (opens browser; HARNESS_NO_OPEN=1 to skip)
# Requires: agent on PATH, data/, checkout of main
```

- Tickets → worktrees under `.harness/worktrees/<id>` (lowercase-dashes, unique forever).
- Branch flow: ticket → merge to local `main` → ff-only `main` → `prod` → `git push origin main` and `git push origin prod`.
- Main preview on `:3901` while the harness runs; per-ticket previews register via `harness/bin/register-preview`.
- Production deploy: Workers Builds on `prod` (`npx wrangler deploy`) to Worker `66ksiag`. Custom Domains: `https://66ksiag.pl`, `https://www.66ksiag.pl`. Every other branch, including `main`, is a preview at `https://<branch>.66ksiag.pl` (`main` → `https://main.66ksiag.pl`).

## Testy

Wymaga lokalnego `data/` (BG + KJV) oraz `web/audio-catalog.json`.

```bash
npm run test:unit          # Vitest: place, i18n, editions, audio, katalog, kontrakty data/
npm run test:e2e           # Playwright: picker, reader, self-hosted audio, API
npm test                   # unit + e2e
```

Pierwszy raz e2e: `npx playwright install chromium`.

## Dokumentacja dla LLM

Zobacz [llms.txt](./llms.txt).

## Android (Google Play)

Natywny klient Kotlin/Compose w `android/`, package `com.jastrakowski.sixsixksiag`, host `66ksiag.pl`. To samo statyczne API co strona. Nie uruchamiaj Bubblewrap — nadpisze projekt.

```bash
npm run android:build          # APK + AAB
npm run android:install        # adb install na telefonie (USB debugging)
npm run android:play:internal  # build + upload AAB do Google Play Internal App Sharing
```

Keystore i `android/secrets/` poza gitem. Push na każdą gałąź inną niż `prod` (w tym `main`) uruchamia GitHub Actions (`.github/workflows/android-internal-sharing.yml`): podpisany `.aab` idzie wyłącznie do **Google Play Internal App Sharing**. Workflow nie tworzy wydania na ścieżce Internal testing. Link instalacji jest w podsumowaniu joba, w statusie commita `play/internal-sharing` i w artefakcie `android-preview.json`. Sekrety Actions: `android/README.md`. Asset Links: `web/.well-known/assetlinks.json`.

Workers Builds (`scripts/build-dist.sh`) nie buduje Androida.

## Cursor Cloud specific instructions

- Dev server: `bash scripts/dev-serve.sh` (albo `npm run dev`) na `http://127.0.0.1:8787`. Start środowiska trzyma ten proces. Gdy port odpowiada, nie uruchamiaj drugiego.
- Tekst wydań nie jest w gicie. `node scripts/import-editions.mjs --web-only` buduje `data/bg/1879` i `data/kjv/1769` z submodułów `sources/` (układ jak importery Rust, bez Cargo). Serwer liczy tekst wersetu z JSON rozdziału. Submoduły klonuj z czystym nagłówkiem: `git -c http.extraHeader= -c http.https://github.com/.extraHeader= submodule update --init --checkout`.
- Git LFS rozdziałów MP3 zwraca 404 w tym środowisku. Pełne audio Scourby’ego to ~3.3 GB. Instalacja trzyma prawdziwy `data/kjv/1769/01-gen/1.mp3` (sha256 ze wskaźnika) w `~/.cache/66ksiag/01-gen-1.mp3`, pobrany z `https://66ksiag.pl/kjv/1769/01-gen/1.mp3`. Start kopiuje cache z powrotem, gdy checkout zostawia wskaźnik LFS (`GIT_LFS_SKIP_SMUDGE=1`). Tego pliku wymaga test e2e. Reszta rozdziałów zostaje wskaźnikami.
- Testy: `npm run test:unit` i `npm run test:e2e`. Playwright Chromium jest w instalacji. Oba potrzebują wygenerowanego `data/` i `web/audio-catalog.json`.
- Android (SDK, keystore, Play) nie jest częścią tego środowiska.
