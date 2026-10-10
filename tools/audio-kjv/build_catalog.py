#!/usr/bin/env python3
"""Zbuduj web/audio-catalog.json — self-hosted ścieżki /kjv/1769/{book}/{ch}.mp3."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "audio-catalog.json"
BOOKS = ROOT / "data" / "kjv" / "1769" / "books.json"
DATA = ROOT / "data" / "kjv" / "1769"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--books", type=Path, default=BOOKS)
    ap.add_argument("--data", type=Path, default=DATA)
    args = ap.parse_args()

    books = json.loads(args.books.read_text(encoding="utf-8"))["books"]
    expected = sum(int(b["chapters"]) for b in books)
    chapters: list[dict] = []
    present = 0
    for b in books:
        for ch in range(1, int(b["chapters"]) + 1):
            rel = f"{b['id']}/{ch}.mp3"
            url = f"/kjv/1769/{rel}"
            chapters.append({"book": b["id"], "chapter": ch, "url": url})
            if (args.data / rel).is_file():
                present += 1

    catalog = {
        "version": 2,
        "narrator": "Alexander Scourby",
        "license_note": "Original Scourby KJV narration treated as public domain.",
        "source": "self-hosted",
        "base": "/kjv/1769",
        "count": len(chapters),
        "expected": expected,
        "present": present,
        "chapters": chapters,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.out} ({len(chapters)}/{expected} listed, {present} files on disk)")
    return 0 if len(chapters) == expected else 1


if __name__ == "__main__":
    raise SystemExit(main())
