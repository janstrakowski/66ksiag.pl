# AGENTS.md — 66ksiąg

Dla agentów AI i contributorów. Szczegóły: [ARCHITECTURE.md](./ARCHITECTURE.md).

## Założenia

**UI natywne = PWA.** Interfejs w `android/` ma to samo zachowanie i copy co PWA. Źródłem kontraktu zostaje `web/`.

**Przed mergem udokumentuj zmiany.** Opisz, co się zmieniło i dlaczego — w commicie, opisie PR albo w docs, gdy zmienia się kontrakt.

**Przed mergem zsynchronizuj kod.** Przeczytaj diff między swoim branchem a docelowym i zaktualizuj swój kod, zanim zmergujesz.

## Co to jest

Statyczne API Biblii (BG 1879 + KJV) + CLI + PWA. Warstwa plików w `data/` jest źródłem prawdy.

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

`data/` jest w `.gitignore`.

```bash
# BG
cargo run -p ksiag-import --release -- \
  --source /tmp/biblia-druk-tekst/1879 --out data --commit <sha>

# KJV
cargo run -p ksiag-import-kjv --release -- \
  --source /tmp/Bible-kjv --out data --commit <sha>
```

## Audio KJV (Scourby) — self-hosted (Git LFS)

KJV `data/kjv/1769/**/*.mp3` i `*.words.json` są w **Git LFS** (obrazy/fonty też). Tekst wydań w `data/` nadal poza gitem (`vendor/` = cache pobierania).

```bash
python3 tools/audio-kjv/fetch_scourby.py
# Do commita LFS potrzebne prawdziwe pliki (nie symlinki):
python3 tools/audio-kjv/install_layout.py          # copy → data/kjv/1769/{book}/{ch}.mp3
python3 tools/audio-kjv/build_catalog.py           # → web/audio-catalog.json (commit)
git add data/kjv/1769/*/*.mp3 data/kjv/1769/*/*.words.json
```

Audio LFS nadal można zsynchronizować na dysk Pi (`bash scripts/push-origin.sh` — rsync na `/mnt/pi-data/git-lfs/66ksiag`). To nie jest deploy. Produkcja idzie z Origin CI przy pushu `main`. Szczegóły: `ci/pi/README.md`.

PWA czyta `/kjv/1769/…/*.mp3` z tego samego originu. „Pobierz audio” = Cache Storage.  
Szczegóły: `tools/audio-kjv/README.md`. `build-dist` kopiuje do `dist/` chapter JSON + MP3/words (bez `.txt` i per-verse — limit Workers Assets).

### Pobieranie audio na karcie tytułowej

Jeden przycisk. `x` to rozdziały już zapisane lokalnie, `N` to cały katalog. Częściowe pobranie nie jest „pobranym audio”. Ten sam układ w PWA i w Androidzie.

- Przycisk jest aktywny wtedy i tylko wtedy, gdy audio nie jest pobrane w całości.
- „Download audio” / „Pobierz audio” wtedy i tylko wtedy, gdy nie ma ani jednego rozdziału i nic się nie pobiera.
- „Cancel download” / „Anuluj pobieranie” wtedy i tylko wtedy, gdy pobieranie trwa.
- „Resume audio” / „Wznów audio” wtedy i tylko wtedy, gdy jest częściowo pobrane i pobieranie nie trwa.
- Gdy całość jest pobrana, przycisk jest nieaktywny i nosi „Audio is already downloaded.” / „Audio jest już pobrane.” — nie żaden z trzech napisów powyżej.
- „Clear downloaded audio” / „Usuń pobrane audio” jest widoczne wtedy i tylko wtedy, gdy audio jest pobrane w całości albo pobieranie jest wstrzymane. W trakcie pobierania go nie ma.
- „Audio is served here…” tylko gdy nie ma ani jednego rozdziału i nic się nie pobiera.
- Przy części — także po anulowaniu — status to „Wanting: x / N” (PL: „Brakujące: x / N”). PWA pobiera rozdział po rozdziale w karcie, bez Background Fetch. `x` rośnie po każdym zapisanym rozdziale i nie cofa się. Po anulowaniu zostaje na tej samej liczbie.
- Gdy całość jest pobrana, status to „Audio is already downloaded.” / „Audio jest już pobrane.”

## Front

`web/` czyta wyłącznie warstwę `data/` (te same kontrakty co CLI).

```bash
bash scripts/dev-serve.sh          # http://127.0.0.1:8787
bash ci/production-deploy.sh       # main only: wrangler deploy → 66ksiag.pl (Origin CI)
bash ci/preview-deploy.sh          # dev only: Workers Preview, not 66ksiag.pl
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
- Production deploy: Origin CI on `main` (`ci/production-deploy.sh`). The harness rollback button still SSHs to the Pi and runs `ci/pi/rollback.sh`. See [ci/pi/README.md](./ci/pi/README.md).

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

Natywny klient Kotlin/Compose w `android/`, package `pl.ksiag.app`, host `66ksiag.pl`. To samo statyczne API co PWA. Nie uruchamiaj Bubblewrap — nadpisze projekt.

```bash
npm run android:build     # APK + AAB
npm run android:install   # adb install na telefonie (USB debugging)
```

Keystore i `android/secrets/` poza gitem. Asset Links: `web/.well-known/assetlinks.json`.
