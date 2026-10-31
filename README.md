# 66ksiąg

Polska Biblia jako **statyczne API** i **strona**.

- Architektura: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Agenci: [AGENTS.md](./AGENTS.md)
- llms.txt: [llms.txt](./llms.txt)
- Licencja: [MIT](./LICENSE)

Wydania: **BG 1879** (PL) i **KJV** (EN, `/kjv/1769`). Wspólna numeracja KJV; jeden plan dzienny na obie. KJV ma audio Scourby’ego (podświetlanie słów, zaliczanie do planu) — patrz `tools/audio-kjv/`. Hosting: Cloudflare Workers + Static Assets.

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
| Production branch | `main` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Preview command | `npx wrangler preview` |
| Preview builds | włączone |

Push na `main` uruchamia build, potem `npx wrangler deploy`. Trasy zostają `66ksiag.pl/*` i `www.66ksiag.pl/*`.

Push na `dev` (i na każdy inny branch) uruchamia ten sam build, potem `npx wrangler preview`. To nie przejmuje tras `66ksiag.pl/*` ani `www.66ksiag.pl/*`. Custom domain na `66ksiag.pl` ma `enabled = false` i `previews_enabled = true`, więc produkcja zostaje na trasach strefy, a podgląd idzie na `<branch>.66ksiag.pl`.

Podgląd brancha `dev`:

`https://dev.66ksiag.pl`

Niezmienny URL jednego wdrożenia: `https://<id>-dev.66ksiag.pl`.

Zanim wildcard podglądu powstanie, w DNS strefy `66ksiag.pl` usuń rekord **A** `*.66ksiag.pl` → `85.128.128.104` (Proxied). Cloudflare nie nadpisze tego rekordu (błąd **100117**) i `npx wrangler deploy` zakończy się błędem, choć trasy `66ksiag.pl/*` i `www.66ksiag.pl/*` zostają. MX i TXT zostaw, jeśli poczta ma działać.

`npm run build` (`scripts/build-dist.sh`):
1. Inicjalizuje submoduły w `sources/` i generuje `data/bg/1879` oraz `data/kjv/1769` (`scripts/import-editions.mjs`).
2. Składa `dist/` (powłoka `web/` + JSON rozdziałów + `.words.json` + wskaźniki MP3).
3. `npm install` patchuje wranglera 4.149. Przy deployu wskaźnik MP3 dostaje hash z `data/kjv/1769/audio-assets-manifest.json`. Cloudflare dociąga tylko brakujące rozdziały; reszta jest już na krawędzi jako Static Assets.

Lokalne `npm run deploy` nadal robi `wrangler deploy` na tej maszynie. Automatyczna ścieżka to Workers Builds.

### Połączenie aplikacji (ręcznie)

Tego OAuth nie da się dokończyć z repozytorium.

1. Otwórz [aplikację Cloudflare](https://cursor.com/codebase/settings/apps/public/cloudflare).
2. Wybierz **Install**.
3. Jako właściciela Origin wybierz `jastrakowski` i nadaj dostęp do repozytorium `jastrakowski/66ksiag`.
4. Dokończ połączenie z kontem Cloudflare `86e0b7dbeec0ebfff2333c8e8c4087fb` i wskaż workera `66ksiag`. Ta nazwa jest już w `wrangler.toml`. Zmiana nazwy w panelu zostawia trasy na tym samym workerze.
5. W ustawieniach builda workera `66ksiag` ustaw branch produkcyjny `main`, włącz preview builds i polecenia z tabeli wyżej. Repo ma być podpięte do tego workera, nie do osobnej aplikacji.

Klonowanie w Workers Builds idzie przez git-proxy z nagłówkiem `Authorization` aplikacji Cloudflare. Błąd „Failed: error occurred while checking out repository” na tym kroku jest odmową tego dostępu do `jastrakowski/66ksiag`. Repozytorium nie trzyma credentiala do tego proxy. Trzeba ponownie zainstalować aplikację i nadać jej to repozytorium.

## URL-e

- UI: `/`, `/ksiegi`, `/czytaj/43-joh/3/16`
- Krótko: `/j/3/16`, `/jn/3/16`, `/jan/3/16`
- API: `/bg/1879/43-joh/3.json`, `/bg/1879/43-joh/3/16.txt`
