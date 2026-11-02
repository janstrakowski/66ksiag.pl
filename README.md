# 66ksiąg

Polska Biblia jako **statyczne API** i **strona**.

- Architektura: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Agenci: [AGENTS.md](./AGENTS.md)
- llms.txt: [llms.txt](./llms.txt)
- Licencja: [MIT](./LICENSE)

Wydania: **BG 1879** (PL) i **KJV** (EN, `/kjv/1769`). Wspólna numeracja KJV. KJV ma audio Scourby’ego (podświetlanie słów) — patrz `tools/audio-kjv/`. Hosting: Cloudflare Workers + Static Assets.

## Szybki start

```bash
# 1. Źródła tekstu (submoduły; po świeżym klonie)
git submodule update --init --checkout

# 2. Import → data/ (JSON + TXT; poza gitem)
cargo run -p ksiag-import --release -- \
  --source sources/biblia-druk-tekst/1879 \
  --out data \
  --commit "$(git -C sources/biblia-druk-tekst rev-parse HEAD)"
cargo run -p ksiag-import-kjv --release -- \
  --source sources/bible-kjv \
  --out data \
  --commit "$(git -C sources/bible-kjv rev-parse HEAD)"

# 3. Strona lokalnie
bash scripts/dev-serve.sh
# → http://127.0.0.1:8787/
```

## Drzewo

| Ścieżka | Rola |
| --- | --- |
| `sources/biblia-druk-tekst/` | Submoduł tekstu BG (`1879/`) |
| `sources/bible-kjv/` | Submoduł tekstu KJV |
| `data/bg/1879/` | Kanoniczne API (generowane importem) |
| `tools/import/` | Rust: TXT źródła → `data/` |
| `tools/import-kjv/` | Rust: KJV → `data/kjv/1769` |
| `web/` | Strona (miedzioryt UI) |
| `worker/` | Krótkie aliasy URL (`/j/3/16` → `/czytaj/…`) |
| `demos/` | Iteracje UI (referencja) |
| `tools/audio-kjv/` | Fetch/align Scourby → `data/kjv/1769/*.mp3` + `.words.json` |

## Deploy (Cloudflare)

```bash
npm install
npm run deploy   # build dist/ + wrangler deploy
```

Wymaga wcześniejszego `data/`. Worker serwuje assety i przekierowuje krótkie aliasy.

Deploy idzie z aplikacji Cloudflare w Cursorze (Workers Builds). Tokenu API nie ma w gicie. Cloudflare zakłada własny token, gdy łączysz konto.

W `wrangler.toml` jest konto `86e0b7dbeec0ebfff2333c8e8c4087fb` (`account_id`). Workers Builds nie czyta polecenia build z tego pliku. W aplikacji ustaw:

| Ustawienie | Wartość |
| --- | --- |
| Worker | `66ksiag` (ta sama nazwa co `name` w `wrangler.toml`) |
| Production branch | `prod` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Preview command | `npx wrangler preview` |
| Preview builds | włączone |

`main` to najnowszy development. `prod` to produkcja. Gałąź `dev` nie jest używana.

Push na `prod` uruchamia build, potem `npx wrangler deploy`. To tworzy Custom Domains `66ksiag.pl` i `www.66ksiag.pl` oraz wildcard `*.66ksiag.pl`.

Push na `main` (i na każdy inny branch poza `prod`) uruchamia ten sam build, potem `npx wrangler preview`. To nie przejmuje produkcji. Podgląd idzie na `<branch>.66ksiag.pl`.

Podgląd brancha `main`:

`https://main.66ksiag.pl`

Niezmienny URL jednego wdrożenia podglądu: `https://<id>-dev.66ksiag.pl` (sufiks Cloudflare dla wdrożenia podglądu, nie nazwa gałęzi).

Wydanie: fast-forward `prod` z `main`, potem `git push origin main` i `git push origin prod`. Harness robi to przyciskiem **Merge main → prod**. Branch produkcyjny w Workers Builds to `prod`.

Rekordy A (`66ksiag.pl`, `www`, `*.66ksiag.pl`) są usunięte. Dopóki najbliższy deploy produkcji nie zapisze Custom Domains, te nazwy się nie rozwiązują. `https://66ksiag.janstrakowski.workers.dev` zostaje. Nie dodawaj z powrotem rekordu A na `*.66ksiag.pl` — Cloudflare odrzuca taki wildcard jako zarządzany z zewnątrz (błąd **100117**).

`npm run build` (`scripts/build-dist.sh`):
1. Inicjalizuje submoduły w `sources/` i generuje `data/bg/1879` oraz `data/kjv/1769` (`scripts/import-editions.mjs`).
2. Składa `dist/` (powłoka `web/` + JSON rozdziałów + `.words.json` + wskaźniki MP3).
3. `npm install` patchuje wranglera 4.149. Przy deployu wskaźnik MP3 dostaje hash z `data/kjv/1769/audio-assets-manifest.json`. Cloudflare dociąga tylko brakujące rozdziały; reszta jest już na krawędzi jako Static Assets.

Build Androida nie jest częścią tego deployu. Każda gałąź poza `prod` (w tym `main`) buduje podpisany `.aab` w GitHub Actions i wysyła go tylko do Google Play Internal App Sharing (`.github/workflows/android-internal-sharing.yml`).

Lokalne `npm run deploy` nadal robi `wrangler deploy` na tej maszynie i publikuje workera produkcyjnego niezależnie od gałęzi. Automatyczna ścieżka to Workers Builds: produkcja tylko z `prod`, podgląd z `main` i pozostałych gałęzi.

### Git LFS na R2 (tylko dev / tooling)

Produkcyjny Worker `66ksiag` nie używa R2 (serwuje audio jako Workers Static Assets). Obiekty Git LFS (`objects/<oid>` w buckecie R2 `66ksiag-audio`) są obsługiwane wyłącznie przez narzędzia deweloperskie, bez używania produkcyjnej domeny:

```bash
# Konfiguracja lokalnego custom transfer agenta R2 w .git/config:
npm run lfs:use-r2

# Synchronizacja obiektów LFS do bucketu R2 66ksiag-audio:
npm run lfs:sync-r2

# Opcjonalny osobny dev Worker (66ksiag-lfs.janstrakowski.workers.dev):
npm run lfs:worker:deploy
```

### Połączenie aplikacji (ręcznie)

Tego OAuth nie da się dokończyć z repozytorium.

1. Otwórz [aplikację Cloudflare](https://cursor.com/codebase/settings/apps/public/cloudflare).
2. Wybierz **Install**.
3. Jako właściciela Origin wybierz `jastrakowski` i nadaj dostęp do repozytorium `jastrakowski/66ksiag`.
4. Dokończ połączenie z kontem Cloudflare `86e0b7dbeec0ebfff2333c8e8c4087fb` i wskaż workera `66ksiag`. Ta nazwa jest już w `wrangler.toml`. Zmiana nazwy w panelu zostawia trasy na tym samym workerze.
5. W ustawieniach builda workera `66ksiag` ustaw branch produkcyjny `prod`, włącz preview builds i polecenia z tabeli wyżej. Repo ma być podpięte do tego workera, nie do osobnej aplikacji. `main` zostaje domyślną gałęzią developmentu.

Klonowanie w Workers Builds idzie przez git-proxy z nagłówkiem `Authorization` aplikacji Cloudflare. Błąd „Failed: error occurred while checking out repository” na tym kroku jest odmową tego dostępu do `jastrakowski/66ksiag`. Repozytorium nie trzyma credentiala do tego proxy. Trzeba ponownie zainstalować aplikację i nadać jej to repozytorium.

## URL-e

- UI: `/`, `/ksiegi`, `/czytaj/43-joh/3/16`
- Krótko: `/j/3/16`, `/jn/3/16`, `/jan/3/16`
- API: `/api/bg/43-joh/3.json`, `/api/bg/43-joh/3.txt`, `/api/kjv/43-joh/3` (ten sam MP3 co `/kjv/1769/43-joh/3.mp3`), `/api/bg/43-joh/3/16.json`, `/api/bg/43-joh/3/16.txt`, `/api/kjv/43-joh/3/16` (audio wersetu). Brak księgi lub wersetu → 404
