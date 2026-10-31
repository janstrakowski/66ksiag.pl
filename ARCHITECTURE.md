# Architektura 66ksiąg

Aplikacja do czytania Biblii w wielu tłumaczeniach. Wydania:

- **BG 1879** (`/api/bg`) — Biblia Gdańska, PL ([biblia-druk-tekst](https://github.com/UczenJezusa/biblia-druk-tekst)). Wydanie `1879` zostaje w JSON i w pliku pod `/bg/1879`.
- **KJV** (`/api/kjv`) — King James Version, EN (tekst PD; UI inspirowane skanami 1611). Wydanie `1769` zostaje w JSON i w pliku pod `/kjv/1769`.

Hosting docelowy: **Cloudflare Workers + Static Assets**.

## Numeracja (krytyczne)

Wszystkie tłumaczenia w tym projekcie używają **tej samej siatki rozdział/werset** (protestancka / KJV) i tych samych ID ksiąg (`01-gen` … `66-apo`).

BG jest **przemapowana na numerację KJV**. Kolejne wersje też muszą być zremapowane — inaczej przełączanie języka daje inny fragment.

## Zasada: dwie warstwy

```
┌──────────────────────────────────────────┐
│  Klienci: strona · LLM · inne appki      │
└──────────────────┬───────────────────────┘
                   │ HTTP (statyczne pliki)
┌──────────────────▼───────────────────────┐
│  Backend: kanoniczne drzewo URL / plików │
│  JSON (maszyny) + plain text (ludzie)    │
└──────────────────────────────────────────┘
```

Warstwa danych jest źródłem prawdy. Frontend i agenci AI konsumują `/api/{bg|kjv}/…`. Worker czyta JSON rozdziału i MP3 z `/bg/1879` i `/kjv/1769` i składa resztę.

## Identyfikatory i URL-e

### Kanoniczne

Stabilne, używane w API, SEO (`rel=canonical`) i share:

```
/api/bg/manifest.json
/api/kjv/manifest.json
/translations.json
/api/{bg|kjv}/books.json
/api/{bg|kjv}/43-joh/3.json
/api/{bg|kjv}/43-joh/3.txt
/api/kjv/43-joh/3
/api/{bg|kjv}/43-joh/3/16.json
/api/{bg|kjv}/43-joh/3/16.txt
/api/kjv/43-joh/3/16
```

- `bg` / `kjv` — tłumaczenie w publicznym URL; wydanie (`1879`, `1769`) jest w środku JSON
- `{book}` — wspólne ID, np. `43-joh`
- rozdział i werset — liczby bez zer wiodących w URL (`3`, nie `03`); w imporcie BG pliki `03.txt` mapujemy na `3`

### Krótkie aliasy

Wygodne do wpisywania i share w UI. Otwierają czytnik (redirect 302). `rel=canonical` wskazuje na `.txt` API:

```
/j/3/16
/jn/3/16
/jan/3/16
  → /czytaj/43-joh/3/16
```

Mapowanie aliasów → `43-joh` żyje w `books.json` (per wydanie, te same aliasy). Krótki URL otwiera czytnik; treść pochodzi z tłumaczenia wybranego na stronie.

### Oba poziomy szczegółowości

| Zasób | Po co |
| --- | --- |
| Rozdział `.json` / `.txt` | Strona (jeden request), czytanie ciągłe |
| Werset `.json` / `.txt` | LLM, głębokie linki, cytaty |

## Kontrakty plików

### `manifest.json`

Metadane wydania: tłumaczenie, edycja, licencja / źródło, `api_version`, URL do `llms.txt`, lista dostępnych formatów.

### `books.json`

Lista ksiąg: kanoniczne `id`, nazwy PL, skróty, aliasy URL, liczba rozdziałów.

### Rozdział `3.json`

```json
{
  "translation": "bg",
  "edition": "1879",
  "book": "43-joh",
  "chapter": 3,
  "verses": [
    { "n": 16, "t": "Albowiem tak Bóg umiłował świat…" }
  ]
}
```

Kursywa ze źródła (`<i>…</i>`) zachowana w polu `t` albo osobnym polu znaczników — decyzja przy imporcie; kontrakt ma być jednolity.

### Rozdział `3.txt`

Czytelne dla człowieka i LLM:

```
# bg/1879 43-joh 3
1 A był niektóry człowiek…
16 Albowiem tak Bóg umiłował świat…
```

### Werset `16.json` / `16.txt`

Ten sam werset co element tablicy w rozdziale; `16.txt` to sam tekst (opcjonalnie z jednoznacznym nagłówkiem komentarzowym).

## Drzewo repozytorium

```
66ksiag-project/
  ARCHITECTURE.md
  AGENTS.md
  llms.txt
  README.md
  data/                 # wygenerowane drzewo bg/1879/… (commitowane lub artifact CI)
  tools/import/         # upstream *.txt → data/ (JSON + TXT)
  tools/import-kjv/     # KJV JSON → data/kjv/1769
  web/                  # strona oparta na warstwie data/
```

Źródła tekstu:

- BG: `tools/import` ← submoduł `sources/biblia-druk-tekst` ([biblia-druk-tekst](https://github.com/UczenJezusa/biblia-druk-tekst) folder `1879`)
- KJV: `tools/import-kjv` ← submoduł `sources/bible-kjv` ([aruljohn/Bible-kjv](https://github.com/aruljohn/Bible-kjv); PD; linia 1769)

UI KJV (styl 1611) — osobne dema w `demos/kjv-1611/` (WIP).

## Frontend (strona)

- Konsumuje wyłącznie kanoniczne (lub równoważne lokalne) pliki z `data/`
- Zwykła strona: bez service workera, bez manifestu aplikacji i bez instalacji na ekran główny. Aplikacją jest `android/`.
- Share: Web Share API + deep link (krótki lub kanoniczny); w HTML ustawione `rel=canonical` na formę długą
- Udostępnianie nie wymaga natywnej appki na MVP

## Cloudflare

- Nowy deploy: **Workers + Static Assets** (nie nowy projekt Pages)
- Upload: `web/` oraz JSON rozdziału, `.words.json` i MP3 rozdziału pod `/bg/1879` i `/kjv/1769`. Bez `.txt` i bez plików per-werset (limit 20 000 plików). MP3 KJV idą hashem z `audio-assets-manifest.json`
- Worker: `/api/{bg|kjv}/…` — tekst liczony z JSON, audio wersetu wycięte z MP3. `/api/kjv/{book}/{chapter}` oddaje zapisany MP3. Brak księgi, rozdziału lub wersetu → 404. `run_worker_first` obejmuje `/api/*`, `/sw.js` i `/manifest.webmanifest`

## Odkrywalność dla LLM

- `llms.txt` w rootcie domeny i repo ([llmstxt.org](https://llmstxt.org))
- `AGENTS.md` w repo — jak budować, importować tekst i czytać API
- `manifest.json` wskazuje na `llms.txt` i `api_version`

## Licencja tekstu

Tekst historyczny BG jest w domenie publicznej; cyfrowa korekta pochodzi z zewnętrznego repo bez pliku LICENSE. W UI i `manifest.json` podajemy źródło; przed szerszą publikacją warto potwierdzić republishing u maintainerów źródła.

## Audio (tylko KJV)

Narracja **Alexander Scourby** — tylko dla `kjv/1769` (BG nie ma audio).

```
/kjv/1769/{book}/{chapter}.mp3          # Static Asset, odtwarzany przez stronę
/api/kjv/{book}/{chapter}               # ten sam plik
/api/kjv/{book}/{chapter}/{verse}       # werset wycięty z tego MP3
/kjv/1769/{book}/{chapter}.words.json   # timestamps słów
```

**MP3 są self-hosted** pod `/kjv/1769/{book}/{chapter}.mp3` (katalog: `web/audio-catalog.json`).  
Strona odtwarza je strumieniowo z Static Assets i nie zapisuje rozdziałów offline. Pobranie na urządzenie jest w `android/`.  
`.words.json` służy do podświetlania i do cięcia audio wersetu. Fonty UI (Cardo, Cinzel) leżą w `web/assets/fonts/` — bez Google Fonts.

Strona: podkreślenie bieżącego słowa i automatyczne przejście do kolejnego rozdziału (aż do Apokalipsy).

## Świadomie odłożone

- Wyszukiwanie pełnotekstowe w API
- ~~Pakiet do Google Play~~ → `android/` (`com.jastrakowski.sixsixksiag`); listing/Play App Signing fingerprint w konsoli
- Opakowanie Capacitor / inne sklepy
- OpenAPI (można dodać jako opis tych samych ścieżek statycznych)
