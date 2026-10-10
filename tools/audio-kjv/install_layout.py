#!/usr/bin/env python3
"""vendor/scourby/raw → data/kjv/1769/{book}/{chapter}.mp3 + audio-manifest.json.

Preferuje index.json z fetch_scourby.py --source ecftf.
Fallback: stare nazwy Archive (`01 Genesis 001.mp3`).
"""

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

ARCHIVE_RE = re.compile(r"^(\d+)\s+(.+?)\s+(\d+)\.mp3$")
ECFTF_RE = re.compile(r"^([0-9]{2}-[a-z]+)_(\d+)\.mp3$")


def place(src: Path, dest: Path, link: bool) -> str:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1000 and not dest.is_symlink():
        return "skip"
    if dest.exists() or dest.is_symlink():
        dest.unlink()
    if link:
        dest.symlink_to(src.resolve())
    else:
        shutil.copy2(src, dest)
    return "ok"


def from_index(raw: Path, out: Path, link: bool) -> tuple[list[dict], dict] | None:
    index_path = raw / "index.json"
    if not index_path.is_file():
        return None
    index = json.loads(index_path.read_text(encoding="utf-8"))
    chapters: list[dict] = []
    stats = {"ok": 0, "skip": 0, "missing": 0}
    for row in index.get("chapters", []):
        src = raw / row["file"]
        if not src.is_file():
            stats["missing"] += 1
            continue
        book, ch = row["book"], int(row["chapter"])
        dest = out / book / f"{ch}.mp3"
        kind = place(src, dest, link)
        stats[kind] = stats.get(kind, 0) + 1
        chapters.append({"book": book, "chapter": ch, "audio": f"{book}/{ch}.mp3"})
    print(f"index layout {stats}")
    return chapters, index


def from_archive_names(raw: Path, out: Path, link: bool) -> list[dict]:
    chapters: list[dict] = []
    copied = skipped = 0
    for path in sorted(raw.glob("*.mp3")):
        m = ARCHIVE_RE.match(path.name)
        if not m:
            m2 = ECFTF_RE.match(path.name)
            if m2:
                book_id, ch = m2.group(1), int(m2.group(2))
                dest = out / book_id / f"{ch}.mp3"
                kind = place(path, dest, link)
                if kind == "ok":
                    copied += 1
                else:
                    skipped += 1
                chapters.append({"book": book_id, "chapter": ch, "audio": f"{book_id}/{ch}.mp3"})
                continue
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
        dest = out / book_id / f"{ch}.mp3"
        kind = place(path, dest, link)
        if kind == "ok":
            copied += 1
        else:
            skipped += 1
        chapters.append({"book": book_id, "chapter": ch, "audio": f"{book_id}/{ch}.mp3"})
    print(f"legacy layout ok={copied} skip={skipped}")
    return chapters


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--raw", type=Path, default=RAW)
    ap.add_argument("--out", type=Path, default=DATA)
    ap.add_argument("--link", action="store_true", help="Symlink zamiast copy")
    args = ap.parse_args()

    if not args.raw.is_dir():
        raise SystemExit(f"Brak {args.raw} — najpierw fetch_scourby.py")

    index_meta = None
    parsed = from_index(args.raw, args.out, args.link)
    if parsed is None:
        chapters = from_archive_names(args.raw, args.out, args.link)
        source = "internet-archive:19-psalm-119_202307"
        license_note = (
            "Original Scourby KJV narration treated as public domain; remasters may carry separate rights."
        )
    else:
        chapters, index_meta = parsed
        source = index_meta.get("page") or index_meta.get("source")
        license_note = index_meta.get(
            "license_note",
            "Original Scourby KJV narration treated as public domain.",
        )

    chapters.sort(key=lambda x: (x["book"], x["chapter"]))
    manifest = {
        "translation": "kjv",
        "edition": "1769",
        "narrator": "Alexander Scourby",
        "license_note": license_note,
        "source": source,
        "chapters": chapters,
        "count": len(chapters),
    }
    man_path = args.out / "audio-manifest.json"
    man_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"manifest={man_path} ({len(chapters)} chapters); expected books {len(ARCHIVE_BOOKS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
