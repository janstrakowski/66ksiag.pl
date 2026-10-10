#!/usr/bin/env python3
"""Pobierz rozdziały Scourby KJV (PD) → vendor/scourby/raw/.

Domyślne źródło: Earnestly Contending for the Faith
  https://earnestlycontendingforthefaith.com/ListenToTheKingJamesBible.html

Opcjonalnie: Internet Archive (--source archive).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "vendor" / "scourby" / "raw"
DATA_BOOKS = ROOT / "data" / "kjv" / "1769" / "books.json"

ECFTF_PAGE = "https://earnestlycontendingforthefaith.com/ListenToTheKingJamesBible.html"
ECFTF_BASE = "https://earnestlycontendingforthefaith.com/"
ARCHIVE_ITEM = "19-psalm-119_202307"

HREF_RE = re.compile(r'href=["\']([^"\']+\.mp3)["\']', re.I)


def fetch_bytes(url: str, attempts: int = 3) -> bytes:
    last: Exception | None = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "66ksiag-audio-fetch/1.0"})
            with urllib.request.urlopen(req, timeout=180) as resp:
                return resp.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def fetch_to_file(url: str, dest: Path, attempts: int = 3) -> None:
    last: Exception | None = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "66ksiag-audio-fetch/1.0"})
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = resp.read()
            if len(data) < 1000:
                raise RuntimeError("too small")
            dest.write_bytes(data)
            return
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def load_books() -> list[dict]:
    if not DATA_BOOKS.is_file():
        raise SystemExit(f"Brak {DATA_BOOKS} — najpierw import KJV")
    return json.loads(DATA_BOOKS.read_text(encoding="utf-8"))["books"]


def ecftf_chapter_urls() -> list[tuple[str, int, str]]:
    """[(book_id, chapter, absolute_url), ...] w kolejności kanonicznej."""
    html = fetch_bytes(ECFTF_PAGE).decode("utf-8", errors="replace")
    hrefs = HREF_RE.findall(html)
    # zachowaj kolejność, bez duplikatów
    seen: set[str] = set()
    ordered: list[str] = []
    for h in hrefs:
        if h in seen:
            continue
        seen.add(h)
        ordered.append(h)

    books = load_books()
    expected = sum(int(b["chapters"]) for b in books)
    if len(ordered) != expected:
        print(
            f"warn: ECFTF ma {len(ordered)} linków mp3, oczekiwano {expected}",
            file=sys.stderr,
        )

    out: list[tuple[str, int, str]] = []
    i = 0
    for b in books:
        for ch in range(1, int(b["chapters"]) + 1):
            if i >= len(ordered):
                break
            rel = ordered[i]
            i += 1
            url = urllib.parse.urljoin(ECFTF_BASE, rel)
            out.append((b["id"], ch, url))
    return out


def archive_names(item: str) -> list[str]:
    url = f"https://archive.org/metadata/{item}"
    meta = json.loads(fetch_bytes(url))
    return sorted(f["name"] for f in meta.get("files", []) if f["name"].endswith(".mp3"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--source",
        choices=("ecftf", "archive"),
        default="ecftf",
        help="ecftf = Earnestly Contending (PD host); archive = Internet Archive",
    )
    ap.add_argument("--out", type=Path, default=RAW)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--item", default=ARCHIVE_ITEM, help="tylko dla --source archive")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    index_path = args.out / "index.json"
    jobs: list[tuple[str, Path, str]] = []  # label, dest, url

    if args.source == "ecftf":
        chapters = ecftf_chapter_urls()
        if args.limit:
            chapters = chapters[: args.limit]
        index = {
            "source": "earnestlycontendingforthefaith.com",
            "page": ECFTF_PAGE,
            "license_note": "Original Scourby KJV narration treated as public domain (site hosts PD chapter MP3s).",
            "chapters": [],
        }
        for book_id, ch, url in chapters:
            # kanoniczna nazwa lokalna — łatwy install_layout
            name = f"{book_id}_{ch:03d}.mp3"
            dest = args.out / name
            jobs.append((f"{book_id}/{ch}", dest, url))
            index["chapters"].append(
                {"book": book_id, "chapter": ch, "file": name, "url": url}
            )
        index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"ECFTF → {len(jobs)} chapters, index {index_path}", flush=True)
    else:
        names = archive_names(args.item)
        if args.limit:
            names = names[: args.limit]
        for name in names:
            dest = args.out / name
            url = f"https://archive.org/download/{args.item}/{urllib.parse.quote(name)}"
            jobs.append((name, dest, url))
        print(f"Archive {args.item} → {len(jobs)} files", flush=True)

    ok = skip = fail = 0
    for i, (label, dest, url) in enumerate(jobs, 1):
        if dest.exists() and dest.stat().st_size > 1000:
            skip += 1
        else:
            try:
                fetch_to_file(url, dest)
                ok += 1
            except Exception as e:  # noqa: BLE001
                fail += 1
                print(f"FAIL {label}: {e}", file=sys.stderr, flush=True)
        if i % 50 == 0 or i == len(jobs):
            print(f"progress {i}/{len(jobs)} ok={ok} skip={skip} fail={fail}", flush=True)

    print(f"DONE ok={ok} skip={skip} fail={fail}", flush=True)
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
