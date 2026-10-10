#!/usr/bin/env python3
"""Pobierz rozdziały Scourby KJV z Internet Archive → vendor/scourby/raw/."""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ITEM = "19-psalm-119_202307"
RAW = ROOT / "vendor" / "scourby" / "raw"


def load_names(item: str) -> list[str]:
    url = f"https://archive.org/metadata/{item}"
    with urllib.request.urlopen(url, timeout=120) as resp:
        meta = json.load(resp)
    return sorted(f["name"] for f in meta.get("files", []) if f["name"].endswith(".mp3"))


def fetch_one(item: str, name: str, dest: Path, attempts: int = 3) -> None:
    url = f"https://archive.org/download/{item}/{urllib.parse.quote(name)}"
    last_err: Exception | None = None
    for i in range(attempts):
        try:
            urllib.request.urlretrieve(url, dest)
            if dest.stat().st_size < 1000:
                dest.unlink(missing_ok=True)
                raise RuntimeError(f"too small: {name}")
            return
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"{name}: {last_err}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--item", default=DEFAULT_ITEM)
    ap.add_argument("--out", type=Path, default=RAW)
    ap.add_argument("--limit", type=int, default=0, help="Max files (0 = all)")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    names = load_names(args.item)
    if args.limit:
        names = names[: args.limit]
    print(f"fetching {len(names)} from {args.item} → {args.out}", flush=True)

    ok = skip = fail = 0
    for i, name in enumerate(names, 1):
        dest = args.out / name
        if dest.exists() and dest.stat().st_size > 1000:
            skip += 1
        else:
            try:
                fetch_one(args.item, name, dest)
                ok += 1
            except Exception as e:  # noqa: BLE001
                fail += 1
                print(f"FAIL {name}: {e}", file=sys.stderr, flush=True)
        if i % 50 == 0 or i == len(names):
            print(f"progress {i}/{len(names)} ok={ok} skip={skip} fail={fail}", flush=True)

    print(f"DONE ok={ok} skip={skip} fail={fail}", flush=True)
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
