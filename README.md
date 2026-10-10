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

## URL-e

- UI: `/`, `/ksiegi`, `/czytaj/43-joh/3/16`
- Krótko: `/j/3/16`, `/jn/3/16`, `/jan/3/16`
- API: `/bg/1879/43-joh/3.json`, `/bg/1879/43-joh/3/16.txt`
