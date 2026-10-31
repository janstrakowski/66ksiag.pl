# 66ksiąg

Polska Biblia jako **statyczne API**, **CLI** i **PWA**.

- Architektura: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Agenci: [AGENTS.md](./AGENTS.md)
- llms.txt: [llms.txt](./llms.txt)
- Licencja: [MIT](./LICENSE)

Wydania: **BG 1879** (PL) i **KJV** (EN, `/kjv/1769`). Wspólna numeracja KJV; jeden plan dzienny na obie. KJV ma audio Scourby’ego (podświetlanie słów, zaliczanie do planu) — patrz `tools/audio-kjv/`. Hosting: Cloudflare Workers + Static Assets.

## Szybki start

```bash
# 1. Źródło tekstu (sparse)
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/UczenJezusa/biblia-druk-tekst.git /tmp/biblia-druk-tekst
cd /tmp/biblia-druk-tekst && git sparse-checkout set --skip-checks 1879

# 2. Import → data/bg/1879 (JSON + TXT, ~250 MB; poza gitem)
cd /path/to/66ksiag-project
cargo run -p ksiag-import --release -- \
  --source /tmp/biblia-druk-tekst/1879 \
  --out data \
  --commit "$(git -C /tmp/biblia-druk-tekst rev-parse HEAD)"

# 3. CLI
cargo run -p ksiag --release -- --data data get jn 3 16

# 4. PWA lokalnie
bash scripts/dev-serve.sh
# → http://127.0.0.1:8787/
```

## Drzewo

| Ścieżka | Rola |
| --- | --- |
| `data/bg/1879/` | Kanoniczne API (generowane importem) |
| `tools/import/` | Rust: TXT źródła → `data/` |
| `cli/` | Rust: `66ksiag books\|get\|chapter\|path` |
| `web/` | PWA (miedzioryt UI) |
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

Push na długożyciowy branch `dev` uruchamia ten sam plik Origin CI. Job woła wyłącznie `npx wrangler preview --name dev` (`ci/preview-deploy.sh`). To nie jest `wrangler deploy` i nie przejmuje tras `66ksiag.pl`.

Stabilny URL podglądu (zawsze ostatni push na `dev`):

`https://dev-ksiag.<subdomena-konta>.workers.dev`

Każde wdrożenie podglądu dostaje też niezmienny URL: `https://<id-wdrożenia>-ksiag.<subdomena-konta>.workers.dev`.

Sekrety trzeba dodać w Origin (wartości nie leżą w gicie). Oba joby czytają je przez `secret()` i przekazują Wranglerowi:

| Nazwa | Znaczenie |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Token API: edycja Workers Scripts oraz edycja Workers Routes na strefie `66ksiag.pl` |
| `CLOUDFLARE_ACCOUNT_ID` | Identyfikator konta Cloudflare |

Osobny sekret na custom domain nie jest potrzebny. Host produkcyjny to trasa w `wrangler.toml` (`zone_name = "66ksiag.pl"`), nie Custom Domain.

Tekst wydań (`data/bg`, `data/kjv` poza LFS) nie jest w tym commicie. Dopóki go nie ma w checkoutcie, podgląd serwuje samą PWA; rozdziały pojawią się, gdy tekst będzie w drzewie (np. submoduły).

## URL-e

- UI: `/`, `/ksiegi`, `/czytaj/43-joh/3/16`
- Krótko: `/j/3/16`, `/jn/3/16`, `/jan/3/16`
- API: `/bg/1879/43-joh/3.json`, `/bg/1879/43-joh/3/16.txt`
