# AGENTS.md — 66ksiąg

Dla agentów AI i contributorów. Szczegóły: [ARCHITECTURE.md](./ARCHITECTURE.md).

## Założenia

**UI natywne = strona.** Interfejs w `android/` ma to samo zachowanie i copy co strona. Źródłem kontraktu zostaje `web/`.

**Przed mergem udokumentuj zmiany.** Opisz, co się zmieniło i dlaczego — w commicie, opisie PR albo w docs, gdy zmienia się kontrakt.

**Przed mergem zsynchronizuj kod.** Przeczytaj diff między swoim branchem a docelowym i zaktualizuj swój kod, zanim zmergujesz.

## Co to jest

Statyczne API Biblii (BG 1879 + KJV) + CLI + strona. Warstwa plików w `data/` jest źródłem prawdy. Aplikacją jest klient w `android/`; `web/` jest zwykłą stroną (bez rejestracji service workera, bez manifestu aplikacji i bez pobierania audio). Worker na `/sw.js` oddaje tylko skrypt, który kasuje cache powłoki, kasuje pobrane audio i wyrejestrowuje już zainstalowanego workera.

**Numeracja:** wszystkie tłumaczenia na siatce KJV / tych samych ID (`01-gen`…). BG jest zremapowana; nowe wersje też muszą być.

## Kanoniczne ścieżki

```
/translations.json
/bg/1879/…   /kjv/1769/…
/{tr}/{ed}/manifest.json
/{tr}/{ed}/books.json
/{tr}/{ed}/{book}/{chapter}.json|.txt
/{tr}/{ed}/{book}/{chapter}/{verse}.json|.txt
```

`{book}` = np. `43-joh`. Aliasy w `books.json`.

## CLI

Katalog `cli/` (Rust, Cargo OK; bez wołania Bash i bez zbędnych libek dynamicznych).

```bash
66ksiag --edition bg/1879 get jn 3 16
66ksiag --edition kjv/1769 get john 3 16 --json
66ksiag --edition kjv/1769 path jn 3 16
```

Preferuj lokalne `data/`; HTTP tylko na kanoniczne URL-e.

## Import tekstu

Tekst wydań w `data/` jest w `.gitignore`. Źródła tekstu to submoduły w `sources/` (audio Scourby zostaje w `vendor/`, poza gitem). Po klonie: `git submodule update --init`.

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

KJV `data/kjv/1769/**/*.mp3` i `*.words.json` są w **Git LFS** (obrazy/fonty też). Tekst wydań w `data/` nadal poza gitem. `vendor/` to cache pobierania audio, nie źródło tekstu.

```bash
python3 tools/audio-kjv/fetch_scourby.py
# Do commita LFS potrzebne prawdziwe pliki (nie symlinki):
python3 tools/audio-kjv/install_layout.py          # copy → data/kjv/1769/{book}/{ch}.mp3
python3 tools/audio-kjv/build_catalog.py           # → web/audio-catalog.json (commit)
git add data/kjv/1769/*/*.mp3 data/kjv/1769/*/*.words.json
```

Audio LFS można zsynchronizować na dysk Pi (`bash scripts/push-origin.sh` — rsync na `/mnt/pi-data/git-lfs/66ksiag`). To magazyn plików audio, nie deploy. Produkcja idzie z Origin CI przy pushu `main`.

Strona odtwarza `/kjv/1769/…/*.mp3` strumieniowo z tego samego originu. Nie ma „Pobierz audio” i nie zapisuje rozdziałów w Cache Storage.  
Szczegóły: `tools/audio-kjv/README.md`. `build-dist` kopiuje do `dist/` chapter JSON + MP3/words (bez `.txt` i per-verse — limit Workers Assets).

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

`web/` czyta wyłącznie warstwę `data/` (te same kontrakty co CLI).

```bash
bash scripts/dev-serve.sh          # http://127.0.0.1:8787
bash ci/production-deploy.sh       # main only: wrangler deploy → 66ksiag.pl (Origin CI)
bash ci/preview-deploy.sh          # dev only: https://devpreview.66ksiag.pl (worker ksiag-devpreview)
```

## Harness (local tickets)

Ticket UI + Cursor `agent` CLI + git worktrees on the **dev machine**. Pushing `main` deploys production from Origin CI.

```bash
npm run harness            # http://127.0.0.1:3900 (opens browser; HARNESS_NO_OPEN=1 to skip)
# Requires: agent on PATH, data/, local branches
```

- Tickets → worktrees under `.harness/worktrees/<id>` (lowercase-dashes, unique forever).
- Branch flow: ticket → merge to local `dev` → ff-only `dev` → `main` → `git push origin main`.
- Dev preview on `:3901` while the harness runs; per-ticket previews register via `harness/bin/register-preview`.
- Production deploy: Origin CI on `main` (`ci/production-deploy.sh`) → `https://66ksiag.pl` and `https://www.66ksiag.pl`. Preview: `ci/preview-deploy.sh` on `dev` → `https://devpreview.66ksiag.pl`.

## Testy

Wymaga lokalnego `data/` (BG + KJV) oraz `web/audio-catalog.json`.

```bash
npm run test:unit          # Vitest: plan, i18n, editions, audio, katalog, kontrakty data/
npm run test:e2e           # Playwright: picker, reader, plan, self-hosted audio, API
npm test                   # unit + e2e
```

Pierwszy raz e2e: `npx playwright install chromium`.

## Dokumentacja dla LLM

Zobacz [llms.txt](./llms.txt).

## Android (Google Play)

Natywny klient Kotlin/Compose w `android/`, package `pl.ksiag.app`, host `66ksiag.pl`. To samo statyczne API co strona. Nie uruchamiaj Bubblewrap — nadpisze projekt.

```bash
npm run android:build     # APK + AAB
npm run android:install   # adb install na telefonie (USB debugging)
```

Keystore i `android/secrets/` poza gitem. Asset Links: `web/.well-known/assetlinks.json`.
