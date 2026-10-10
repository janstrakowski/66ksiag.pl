# AGENTS.md — 66ksiąg

Dla agentów AI i contributorów. Szczegóły: [ARCHITECTURE.md](./ARCHITECTURE.md).

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

## Front

`web/` czyta wyłącznie warstwę `data/` (te same kontrakty co CLI).

```bash
bash scripts/dev-serve.sh          # http://127.0.0.1:8787
npm run build && npx wrangler deploy
```

## Dokumentacja dla LLM

Zobacz [llms.txt](./llms.txt).
