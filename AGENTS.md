# AGENTS.md — 66ksiąg

Dla agentów AI i contributorów. Szczegóły: [ARCHITECTURE.md](./ARCHITECTURE.md).

## Co to jest

Statyczne API Biblii (BG 1879) + CLI + PWA. Warstwa plików w `data/` jest źródłem prawdy.

## Kanoniczne ścieżki

```
/bg/1879/manifest.json
/bg/1879/books.json
/bg/1879/{book}/{chapter}.json|.txt
/bg/1879/{book}/{chapter}/{verse}.json|.txt
```

`{book}` = np. `43-joh`. Aliasy (`jn`, `jan`, `j`) tylko w `books.json` / krótkich URL-ach frontu.

## CLI

Katalog `cli/` (Rust, Cargo OK; bez wołania Bash i bez zbędnych libek dynamicznych).

```bash
66ksiag get jn 3 16
66ksiag get 43-joh 3 16 --json
66ksiag path jn 3 16
```

Preferuj lokalne `data/`; HTTP tylko na kanoniczne URL-e.

## Import tekstu

Źródło: https://github.com/UczenJezusa/biblia-druk-tekst (folder `1879`).  
Pipeline: `tools/import` → `data/bg/1879/...`.

## Front

`web/` czyta wyłącznie warstwę `data/` (te same kontrakty co CLI).

## Dokumentacja dla LLM

Zobacz [llms.txt](./llms.txt).
