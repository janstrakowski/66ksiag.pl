# Architektura 66ksiąg

Aplikacja do czytania Biblii w wielu tłumaczeniach. Wydania:

- **BG 1879** (`/bg/1879`) — Biblia Gdańska, PL ([biblia-druk-tekst](https://github.com/UczenJezusa/biblia-druk-tekst))
- **KJV** (`/kjv/1769`) — King James Version, EN (tekst PD; UI inspirowane skanami 1611)

Hosting docelowy: **Cloudflare Workers + Static Assets**.

## Numeracja (krytyczne)

Wszystkie tłumaczenia w tym projekcie używają **tej samej siatki rozdział/werset** (protestancka / KJV) i tych samych ID ksiąg (`01-gen` … `66-apo`).

BG jest **przemapowana na numerację KJV**. Kolejne wersje też muszą być zremapowane — inaczej wspólny plan dzienny i przełączanie języka dają „dziwne akcje” (zaliczanie innego fragmentu).

Plan dzienny jest **jeden na użytkownika**: zaliczenie rozdziału w BG lub KJV trafia do tej samej quoty (`bookId/chapter`).

## Zasada: dwie warstwy

```
┌──────────────────────────────────────────┐
│  Klienci: PWA · CLI · LLM · inne appki   │
└──────────────────┬───────────────────────┘
                   │ HTTP (statyczne pliki)
┌──────────────────▼───────────────────────┐
│  Backend: kanoniczne drzewo URL / plików │
│  JSON (maszyny) + plain text (ludzie)    │
└──────────────────────────────────────────┘
```

Warstwa danych jest źródłem prawdy. Frontend, CLI i agenci AI tylko konsumują te same ścieżki — bez osobnej logiki „co to jest werset 16”.

Na MVP nie ma dynamicznego API serwerowego: hierarchia plików na statycznym hostingu *jest* API.

## Identyfikatory i URL-e

### Kanoniczne

Stabilne, używane w API, SEO (`rel=canonical`), share i CLI:

```
/bg/1879/manifest.json
/kjv/1769/manifest.json
/translations.json
/{translation}/{edition}/books.json
/{translation}/{edition}/43-joh/3.json
/{translation}/{edition}/43-joh/3/16.txt
```

- `{translation}` — np. `bg`, `kjv`
- `{edition}` — np. `1879`, `1769`
- `{book}` — wspólne ID, np. `43-joh`
- rozdział i werset — liczby bez zer wiodących w URL (`3`, nie `03`); w imporcie BG pliki `03.txt` mapujemy na `3`

### Krótkie aliasy

Wygodne do wpisywania i share w UI. Zawsze wskazują na kanoniczny URL (redirect 301 albo `Link: rel=canonical`):

```
/j/3/16
/jn/3/16
/jan/3/16
  → /bg/1879/43-joh/3/16
```

Mapowanie aliasów → `43-joh` żyje w `books.json` (per wydanie, te same aliasy). Krótki URL otwiera czytnik; treść pochodzi z wybranego w PWA tłumaczenia.

### Oba poziomy szczegółowości

| Zasób | Po co |
| --- | --- |
| Rozdział `.json` / `.txt` | PWA (jeden request), czytanie ciągłe |
| Werset `.json` / `.txt` | CLI, LLM, głębokie linki, cytaty |

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
  cli/                  # Rust: klient lokalnego drzewa / URL kanonicznych
  web/                  # PWA oparta na warstwie data/
```

Źródła tekstu:

- BG: `tools/import` ← [biblia-druk-tekst](https://github.com/UczenJezusa/biblia-druk-tekst) folder `1879`
- KJV: `tools/import-kjv` ← [aruljohn/Bible-kjv](https://github.com/aruljohn/Bible-kjv) (PD; linia 1769)

UI KJV (styl 1611) — osobne dema w `demos/kjv-1611/` (WIP).

## CLI (Rust)

Przeznaczenie: programiści i agenci AI.

Wymagania „zero dependency” w tym projekcie oznaczają:

- **OK:** paczki Cargo
- **Nie:** dynamiczne biblioteki systemowe poza standardowym libc, wywoływanie Bash / zewnętrznych programów jako część logiki narzędzia

Preferowany tryb: czytanie lokalnego `data/` (to samo drzewo co na CDN). Opcjonalnie pobieranie kanonicznych URL-i przez HTTP (crate, nie `curl` w subprocessie).

Szkic komend:

```bash
66ksiag books
66ksiag get 43-joh 3 16
66ksiag get jn 3 16 --json
66ksiag chapter jn 3
66ksiag path jn 3 16      # kanoniczna ścieżka / URL
```

## Frontend (PWA)

- Konsumuje wyłącznie kanoniczne (lub równoważne lokalne) pliki z `data/`
- Offline: service worker cache’uje rozdziały / całe wydanie po pierwszej wizycie
- Share: Web Share API + deep link (krótki lub kanoniczny); w HTML ustawione `rel=canonical` na formę długą
- Udostępnianie nie wymaga natywnej appki na MVP

## Cloudflare

- Nowy deploy: **Workers + Static Assets** (nie nowy projekt Pages)
- Statyczne pliki z `data/` + build `web/`
- Aliasów krótkich można dograć Worker handlerem (rewrite) albo regułami hostingu; treść zawsze z tych samych plików
- D1 / R2 / konta użytkowników — dopiero gdy pojawi się sync między urządzeniami

## Odkrywalność dla LLM

- `llms.txt` w rootcie domeny i repo ([llmstxt.org](https://llmstxt.org))
- `AGENTS.md` w repo — jak budować, importować, wołać CLI i API
- `manifest.json` wskazuje na `llms.txt` i `api_version`

## Licencja tekstu

Tekst historyczny BG jest w domenie publicznej; cyfrowa korekta pochodzi z zewnętrznego repo bez pliku LICENSE. W UI i `manifest.json` podajemy źródło; przed szerszą publikacją warto potwierdzić republishing u maintainerów źródła.

## Audio (tylko KJV)

Narracja **Alexander Scourby** — tylko dla `kjv/1769` (BG nie ma audio).

```
/kjv/1769/audio-manifest.json
/kjv/1769/{book}/{chapter}.mp3
/kjv/1769/{book}/{chapter}.words.json   # timestamps słów (lokalny Whisper)
```

**MP3 są self-hosted** pod `/kjv/1769/{book}/{chapter}.mp3` (katalog: `web/audio-catalog.json`).  
„Pobierz audio” bierze brakujące rozdziały po kolei w otwartej karcie i zapisuje je w Cache Storage (offline). Licznik rośnie po każdym zapisanym rozdziale.  
Opcjonalne `.words.json` w `data/` tylko do podświetlania słów. Fonty UI (Cardo, Cinzel) leżą w `web/assets/fonts/` — bez Google Fonts.

PWA: podkreślenie bieżącego słowa, zaliczanie rozdziału do planu po końcu audio, auto-next w ramach dziennej quoty, stop po 100%, CTA „słuchaj dalej” (tryb beyond → aż do Apokalipsy).

## Świadomie odłożone

- Wyszukiwanie pełnotekstowe w CLI/API
- Konta, sync, push między urządzeniami
- ~~Pakiet do Google Play~~ → `android/` (Bubblewrap TWA, `pl.ksiag.app`); listing/Play App Signing fingerprint w konsoli
- Opakowanie Capacitor / inne sklepy
- OpenAPI (można dodać jako opis tych samych ścieżek statycznych)
