# 66ksiąg

Polska Biblia jako **statyczne API**, **CLI** i **strona**.

- Architektura: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Agenci: [AGENTS.md](./AGENTS.md)
- llms.txt: [llms.txt](./llms.txt)
- Licencja: [MIT](./LICENSE)

Wydania: **BG 1879** (PL) i **KJV** (EN, `/kjv/1769`). Wspólna numeracja KJV; jeden plan dzienny na obie. KJV ma audio Scourby’ego (podświetlanie słów, zaliczanie do planu) — patrz `tools/audio-kjv/`. Hosting: Cloudflare Workers + Static Assets.

## Szybki start

```bash
# 1. Źródła tekstu (submoduły; po świeżym klonie)
git submodule update --init

# 2. Import → data/ (JSON + TXT; poza gitem)
cargo run -p ksiag-import --release -- \
  --source sources/biblia-druk-tekst/1879 \
  --out data \
  --commit "$(git -C sources/biblia-druk-tekst rev-parse HEAD)"
cargo run -p ksiag-import-kjv --release -- \
  --source sources/bible-kjv \
  --out data \
  --commit "$(git -C sources/bible-kjv rev-parse HEAD)"

# 3. CLI
cargo run -p ksiag --release -- --data data get jn 3 16

# 4. Strona lokalnie
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
| `cli/` | Rust: `66ksiag books\|get\|chapter\|path` |
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

Push na `main` uruchamia Origin CI (`origin.ci.ts` → `ci/production-deploy.sh` → `npx wrangler deploy`). Trasy w `wrangler.toml` zostają na `66ksiag.pl` i `www.66ksiag.pl`. Raspberry Pi nie bierze udziału w tym wdrożeniu. Lokalne `npm run deploy` robi to samo polecenie Wranglera, gdy ktoś odpala je ręcznie.

Job produkcyjny wymaga tekstu wydań w checkoutcie (`data/bg/1879/books.json` i `data/kjv/1769/books.json`). Bez niego kończy się przed Wranglerem i nie podmienia `66ksiag.pl` na samą skorupę.

## Podgląd `dev` (nie produkcja)

Push na długożyciowy branch `dev` uruchamia ten sam plik Origin CI. Job woła `npx wrangler deploy --env devpreview` (`ci/preview-deploy.sh`). To osobny worker `ksiag-devpreview`. Nie jest to worker produkcyjny `ksiag` i nie dostaje tras `66ksiag.pl/*` ani `www.66ksiag.pl/*`.

Stabilny URL podglądu (zawsze ostatni push na `dev`):

`https://devpreview.66ksiag.pl`

To Custom Domain na strefie `66ksiag.pl`. Wrangler zakłada rekord DNS przy wdrożeniu podglądu. Produkcja zostaje na trasach `66ksiag.pl/*` i `www.66ksiag.pl/*`.

| Nazwa | Skąd |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Wpisane w `origin.ci.ts` i `wrangler.toml` (`account_id`). To nie jest token. |
| `CLOUDFLARE_API_TOKEN` | Tylko przez `secret("CLOUDFLARE_API_TOKEN")`. Wartości nie ma w gicie. |

Notatki Origin opisują helpery `glob()`, `exists()` i `ecrLogin`. Nie opisują magazynu sekretów ani `secret()`. Dopóki ten helper nie odda tokenu, żywe wdrożenie podglądu i produkcji nie startuje. Tokenu nie wkleja się do repozytorium. Szablon „Edit Cloudflare Workers” musi móc edytować Workers Scripts. Custom Domain dodatkowo tworzy rekord DNS na strefie; jeśli Cloudflare odrzuci ten krok, token potrzebuje jeszcze Zone DNS: Edit na `66ksiag.pl`. Osobnego sekretu na custom domain nie ma.

Tekst wydań (`data/bg`, `data/kjv` poza LFS) nie jest w tym commicie. Dopóki go nie ma w checkoutcie, podgląd serwuje samą stronę; rozdziały pojawią się, gdy tekst będzie w drzewie (np. submoduły).

## URL-e

- UI: `/`, `/ksiegi`, `/czytaj/43-joh/3/16`
- Krótko: `/j/3/16`, `/jn/3/16`, `/jan/3/16`
- API: `/bg/1879/43-joh/3.json`, `/bg/1879/43-joh/3/16.txt`
