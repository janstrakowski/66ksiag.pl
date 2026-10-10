#!/usr/bin/env python3
"""Wyrównaj MP3 rozdziału do tekstu KJV → {chapter}.words.json (lokalnie, faster-whisper)."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "kjv" / "1769"


def load_audio_f32(mp3: Path):
    """ffmpeg → float32 mono 16 kHz (omija zepsute PyAV w decode_audio)."""
    import numpy as np

    proc = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-i",
            str(mp3),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "pipe:1",
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()

WORD_RE = re.compile(r"[A-Za-z']+")


def strip_tags(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s)


def tokenize_verse(text: str) -> list[str]:
    return WORD_RE.findall(strip_tags(text))


def norm(tok: str) -> str:
    return re.sub(r"[^a-z']", "", tok.lower())


def load_chapter_tokens(book: str, chapter: int, data_root: Path) -> list[tuple[int, int, str]]:
    """[(verse, index_in_verse, token), ...]"""
    path = data_root / book / f"{chapter}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    out: list[tuple[int, int, str]] = []
    for v in data["verses"]:
        toks = tokenize_verse(v["t"])
        for i, t in enumerate(toks):
            out.append((v["n"], i, t))
    return out


def align_words(
    expected: list[tuple[int, int, str]],
    spoken: list[dict],
) -> list[dict]:
    """Greedy sequential match whisper words → KJV tokens; keep timings from spoken."""
    result: list[dict] = []
    j = 0
    n = len(spoken)
    for v, i, tok in expected:
        nt = norm(tok)
        if not nt:
            continue
        best = None
        best_d = 10**9
        # look ahead window
        for k in range(j, min(n, j + 12)):
            sw = spoken[k]
            ns = norm(sw["word"])
            if not ns:
                continue
            if ns == nt:
                best = k
                break
            # soft: prefix / contained for truncated ASR
            if ns.startswith(nt[: max(3, len(nt) - 1)]) or nt.startswith(ns[: max(3, len(ns) - 1)]):
                d = abs(len(ns) - len(nt))
                if d < best_d:
                    best_d = d
                    best = k
        if best is None:
            # no timing — interpolate later
            result.append({"v": v, "i": i, "t": tok, "s": None, "e": None})
            continue
        sw = spoken[best]
        result.append(
            {
                "v": v,
                "i": i,
                "t": tok,
                "s": round(float(sw["start"]), 3),
                "e": round(float(sw["end"]), 3),
            }
        )
        j = best + 1

    # fill missing by linear interp between neighbors
    for idx, w in enumerate(result):
        if w["s"] is not None:
            continue
        prev_e = next((result[p]["e"] for p in range(idx - 1, -1, -1) if result[p]["e"] is not None), 0.0)
        next_s = next((result[n_]["s"] for n_ in range(idx + 1, len(result)) if result[n_]["s"] is not None), prev_e + 0.35)
        gap = max(0.08, (next_s - prev_e) / 2)
        w["s"] = round(prev_e, 3)
        w["e"] = round(prev_e + gap, 3)

    return result


def transcribe(mp3: Path, model_name: str, device: str, compute_type: str) -> list[dict]:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, _info = model.transcribe(
        str(mp3),
        language="en",
        word_timestamps=True,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    words: list[dict] = []
    for seg in segments:
        if not seg.words:
            continue
        for w in seg.words:
            token = (w.word or "").strip()
            if not token:
                continue
            words.append({"word": token, "start": w.start, "end": w.end})
    return words


def align_one(
    book: str,
    chapter: int,
    data_root: Path,
    model_name: str,
    device: str,
    compute_type: str,
    force: bool,
) -> Path | None:
    mp3 = data_root / book / f"{chapter}.mp3"
    out = data_root / book / f"{chapter}.words.json"
    if not mp3.is_file():
        print(f"missing audio {mp3}", file=sys.stderr)
        return None
    if out.is_file() and not force:
        print(f"skip existing {out}")
        return out

    expected = load_chapter_tokens(book, chapter, data_root)
    print(f"align {book}/{chapter} ({len(expected)} tokens)…", flush=True)
    spoken = transcribe(mp3, model_name, device, compute_type)
    print(f"  whisper words: {len(spoken)}", flush=True)
    aligned = align_words(expected, spoken)
    matched = sum(1 for w in aligned if w["s"] is not None)
    payload = {
        "translation": "kjv",
        "edition": "1769",
        "book": book,
        "chapter": chapter,
        "narrator": "Alexander Scourby",
        "aligner": f"faster-whisper:{model_name}",
        "words": aligned,
        "stats": {"expected": len(expected), "spoken": len(spoken), "placed": matched},
    }
    out.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  wrote {out} placed={matched}/{len(expected)}", flush=True)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, default=DATA)
    ap.add_argument("--book", help="np. 01-gen")
    ap.add_argument("--chapter", type=int)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--model", default="small.en")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--compute-type", default="int8")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    jobs: list[tuple[str, int]] = []
    if args.all:
        man = args.data / "audio-manifest.json"
        if man.is_file():
            chapters = json.loads(man.read_text(encoding="utf-8"))["chapters"]
            jobs = [(c["book"], int(c["chapter"])) for c in chapters]
        else:
            for book_dir in sorted(args.data.glob("*-*")):
                if not book_dir.is_dir():
                    continue
                for mp3 in sorted(book_dir.glob("*.mp3"), key=lambda p: int(p.stem)):
                    jobs.append((book_dir.name, int(mp3.stem)))
    elif args.book and args.chapter:
        jobs = [(args.book, args.chapter)]
    else:
        ap.error("Podaj --book + --chapter albo --all")

    if args.limit:
        jobs = jobs[: args.limit]

    # load model once by aligning first with shared module state — align_one loads each time;
    # optimize: load once here
    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)

    def transcribe_cached(mp3: Path) -> list[dict]:
        audio = load_audio_f32(mp3)
        segments, _info = model.transcribe(
            audio,
            language="en",
            word_timestamps=True,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        words: list[dict] = []
        for seg in segments:
            if not seg.words:
                continue
            for w in seg.words:
                token = (w.word or "").strip()
                if not token:
                    continue
                words.append({"word": token, "start": w.start, "end": w.end})
        return words

    done = 0
    for book, ch in jobs:
        mp3 = args.data / book / f"{ch}.mp3"
        out = args.data / book / f"{ch}.words.json"
        if not mp3.is_file():
            print(f"missing {mp3}", file=sys.stderr)
            continue
        if out.is_file() and not args.force:
            print(f"skip {out}")
            continue
        expected = load_chapter_tokens(book, ch, args.data)
        print(f"align {book}/{ch} ({len(expected)} tokens)…", flush=True)
        spoken = transcribe_cached(mp3)
        aligned = align_words(expected, spoken)
        payload = {
            "translation": "kjv",
            "edition": "1769",
            "book": book,
            "chapter": ch,
            "narrator": "Alexander Scourby",
            "aligner": f"faster-whisper:{args.model}",
            "words": aligned,
            "stats": {
                "expected": len(expected),
                "spoken": len(spoken),
                "placed": sum(1 for w in aligned if w["s"] is not None),
            },
        }
        out.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"  wrote {out} {payload['stats']}", flush=True)
        done += 1

    print(f"DONE aligned={done}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
