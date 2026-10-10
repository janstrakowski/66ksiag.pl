#!/usr/bin/env python3
"""Zbuduj web/audio-catalog.json z linków ECFTF (bez pobierania MP3)."""

from __future__ import annotations

import argparse
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "audio-catalog.json"
BOOKS = ROOT / "data" / "kjv" / "1769" / "books.json"
ECFTF_PAGE = "https://earnestlycontendingforthefaith.com/ListenToTheKingJamesBible.html"
ECFTF_BASE = "https://earnestlycontendingforthefaith.com/"
HREF_RE = re.compile(r'href=["\']([^"\']+\.mp3)["\']', re.I)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    books = json.loads(BOOKS.read_text(encoding="utf-8"))["books"]
    req = urllib.request.Request(ECFTF_PAGE, headers={"User-Agent": "66ksiag-catalog/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        html = resp.read().decode("utf-8", errors="replace")

    hrefs: list[str] = []
    seen: set[str] = set()
    for h in HREF_RE.findall(html):
        if h in seen:
            continue
        seen.add(h)
        hrefs.append(h)

    expected = sum(int(b["chapters"]) for b in books)
    chapters: list[dict] = []
    i = 0
    for b in books:
        for ch in range(1, int(b["chapters"]) + 1):
            if i >= len(hrefs):
                break
            url = urllib.parse.urljoin(ECFTF_BASE, hrefs[i])
            i += 1
            chapters.append({"book": b["id"], "chapter": ch, "url": url})

    catalog = {
        "version": 1,
        "narrator": "Alexander Scourby",
        "license_note": "Original Scourby KJV narration treated as public domain.",
        "source": "earnestlycontendingforthefaith.com",
        "page": ECFTF_PAGE,
        "count": len(chapters),
        "expected": expected,
        "chapters": chapters,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.out} ({len(chapters)}/{expected})")
    return 0 if len(chapters) == expected else 1


if __name__ == "__main__":
    raise SystemExit(main())
