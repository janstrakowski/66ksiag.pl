#!/usr/bin/env python3
"""vendor/scourby/raw/*.mp3 → data/kjv/1769/{book}/{chapter}.mp3 + audio-manifest.json."""

from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path

from books_map import ARCHIVE_BOOKS, BY_NUM

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "vendor" / "scourby" / "raw"
DATA = ROOT / "data" / "kjv" / "1769"

NAME_RE = re.compile(r"^(\d+)\s+(.+?)\s+(\d+)\.mp3$")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--raw", type=Path, default=RAW)
    ap.add_argument("--out", type=Path, default=DATA)
    ap.add_argument("--link", action="store_true", help="Symlink zamiast copy (oszczędza dysk)")
    args = ap.parse_args()

    if not args.raw.is_dir():
        raise SystemExit(f"Brak {args.raw} — najpierw fetch_scourby.py")

    chapters: list[dict] = []
    copied = skipped = 0
    for path in sorted(args.raw.glob("*.mp3")):
        m = NAME_RE.match(path.name)
        if not m:
            print(f"skip unparsed {path.name}")
            continue
        num, label, ch = int(m.group(1)), m.group(2), int(m.group(3))
        mapped = BY_NUM.get(num)
        if not mapped:
            print(f"skip unknown book {path.name}")
            continue
        expect_label, book_id = mapped
        if label != expect_label:
            print(f"warn label {label!r} != {expect_label!r} for {path.name}")
        dest_dir = args.out / book_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{ch}.mp3"
        if dest.exists() and dest.stat().st_size > 1000:
            skipped += 1
        elif args.link:
            if dest.exists() or dest.is_symlink():
                dest.unlink()
            dest.symlink_to(path.resolve())
            copied += 1
        else:
            shutil.copy2(path, dest)
            copied += 1
        chapters.append({"book": book_id, "chapter": ch, "audio": f"{book_id}/{ch}.mp3"})

    chapters.sort(key=lambda x: (x["book"], x["chapter"]))
    manifest = {
        "translation": "kjv",
        "edition": "1769",
        "narrator": "Alexander Scourby",
        "license_note": "Original Scourby KJV narration treated as public domain; remasters may carry separate rights.",
        "source": "internet-archive:19-psalm-119_202307",
        "chapters": chapters,
        "count": len(chapters),
    }
    man_path = args.out / "audio-manifest.json"
    man_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"layout ok={copied} skip={skipped} manifest={man_path} ({len(chapters)} chapters)")
    print(f"expected books: {len(ARCHIVE_BOOKS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
