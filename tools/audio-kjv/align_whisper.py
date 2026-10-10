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


def canon(tok: str) -> str:
    return norm(tok).replace("'", "")


def _edit_distance(a: str, b: str) -> int:
    if abs(len(a) - len(b)) > 2:
        return 3
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            ins = cur[j - 1] + 1
            delete = prev[j] + 1
            sub = prev[j - 1] + (ca != cb)
            cur.append(min(ins, delete, sub))
        prev = cur
    return prev[-1]


def token_score(a: str, b: str) -> int | None:
    """Score a KJV token against a Whisper token. None = do not pair them."""
    if not a or not b:
        return None
    if a == b:
        return 50
    ca, cb = canon(a), canon(b)
    if not ca or not cb:
        return None
    if ca == cb:
        return 42
    if len(ca) >= 4 and len(cb) >= 4 and abs(len(ca) - len(cb)) <= 1 and _edit_distance(ca, cb) <= 1:
        return 24
    if (
        len(ca) >= 5
        and len(cb) >= 5
        and abs(len(ca) - len(cb)) <= 3
        and (ca.startswith(cb) or cb.startswith(ca))
    ):
        return 18
    return None


def _same_or_near(a: str, b: str) -> bool:
    if a == b:
        return True
    if len(a) >= 5 and len(b) >= 5 and abs(len(a) - len(b)) <= 1 and _edit_distance(a, b) <= 1:
        return True
    return False


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


# Skip a spoken word cheaply (intro, verse numbers, ASR junk).
# Skip a KJV token only when nothing in the audio matches it.
_GAP_SPOKEN = 4
_GAP_EXPECTED = 28
_CONCAT_SCORE = 72
_OP_SKIP_S = 0
_OP_SKIP_E = 1
_OP_MATCH = 2
_OP_MATCH_2E = 3  # one spoken word covers two KJV tokens ("everything" → every + thing)
_OP_MATCH_2S = 4  # two spoken words cover one KJV token


def align_words(
    expected: list[tuple[int, int, str]],
    spoken: list[dict],
) -> tuple[list[dict], int]:
    """Align Whisper words to KJV tokens.

    Returns (words, matched). `matched` counts tokens tied to a Whisper span.
    Unmatched tokens get a short slot beside their neighbors — pauses stay pauses,
    so one missed word cannot swallow the chapter intro.
    """
    exp: list[tuple[int, int, str, str]] = []
    for v, i, tok in expected:
        nt = norm(tok)
        if nt:
            exp.append((v, i, tok, nt))
    sp: list[tuple[str, float, float]] = []
    for w in spoken:
        ns = norm(str(w.get("word") or ""))
        if not ns or w.get("start") is None or w.get("end") is None:
            continue
        sp.append((ns, float(w["start"]), float(w["end"])))

    spans, matched = _align_spans(exp, sp)
    _reclaim_long_spans(spans)
    _fill_unmatched(spans)
    _clamp_monotonic(spans)

    result: list[dict] = []
    for (v, i, tok, _nt), (start, end) in zip(exp, spans, strict=True):
        result.append(
            {
                "v": v,
                "i": i,
                "t": tok,
                "s": round(start, 3),
                "e": round(end, 3),
            }
        )
    return result, matched


def _align_spans(
    exp: list[tuple[int, int, str, str]],
    sp: list[tuple[str, float, float]],
) -> tuple[list[tuple[float, float] | None], int]:
    n, m = len(exp), len(sp)
    stride = m + 1
    prev = [-(j * _GAP_SPOKEN) for j in range(stride)]
    prev2 = prev
    bp = bytearray(stride * (n + 1))
    for j in range(1, stride):
        bp[j] = _OP_SKIP_S

    can_exp = [canon(e[3]) for e in exp]
    can_sp = [canon(tok) for tok, _s, _e in sp]

    for i in range(1, n + 1):
        cur = [0] * stride
        cur[0] = prev[0] - _GAP_EXPECTED
        bp[i * stride] = _OP_SKIP_E
        et = exp[i - 1][3]
        ec = can_exp[i - 1]
        for j in range(1, stride):
            best = prev[j] - _GAP_EXPECTED
            op = _OP_SKIP_E
            cand = cur[j - 1] - _GAP_SPOKEN
            if cand >= best:
                best, op = cand, _OP_SKIP_S
            sc = token_score(et, sp[j - 1][0])
            if sc is not None:
                cand = prev[j - 1] + sc
                if cand >= best:
                    best, op = cand, _OP_MATCH
            if i >= 2:
                joined = can_exp[i - 2] + ec
                heard = can_sp[j - 1]
                if joined and _same_or_near(joined, heard):
                    cand = prev2[j - 1] + _CONCAT_SCORE
                    if cand >= best:
                        best, op = cand, _OP_MATCH_2E
            if j >= 2:
                joined = can_sp[j - 2] + can_sp[j - 1]
                if ec and _same_or_near(ec, joined):
                    cand = prev[j - 2] + _CONCAT_SCORE
                    if cand >= best:
                        best, op = cand, _OP_MATCH_2S
            cur[j] = best
            bp[i * stride + j] = op
        prev2, prev = prev, cur

    spans: list[tuple[float, float] | None] = [None] * n
    i, j = n, m
    matched = 0
    while i > 0 or j > 0:
        if i == 0:
            j -= 1
            continue
        if j == 0:
            i -= 1
            continue
        op = bp[i * stride + j]
        if op == _OP_MATCH_2E and i >= 2:
            start, end = sp[j - 1][1], sp[j - 1][2]
            left, right = len(can_exp[i - 2]), len(can_exp[i - 1])
            cut = start + (end - start) * (left / max(1, left + right))
            spans[i - 2] = (start, cut)
            spans[i - 1] = (cut, end)
            matched += 2
            i -= 2
            j -= 1
        elif op == _OP_MATCH_2S and j >= 2:
            spans[i - 1] = (sp[j - 2][1], sp[j - 1][2])
            matched += 1
            i -= 1
            j -= 2
        elif op == _OP_MATCH:
            spans[i - 1] = (sp[j - 1][1], sp[j - 1][2])
            matched += 1
            i -= 1
            j -= 1
        elif op == _OP_SKIP_S:
            j -= 1
        else:
            i -= 1
    return spans, matched


def _reclaim_long_spans(spans: list[tuple[float, float] | None]) -> None:
    """Whisper sometimes glues a whole clause into one token.

    When that token is followed by KJV words with no timestamp, and it ends
    right where the next real match begins, those words were spoken inside
    the long span. Hand that time back to them.
    """
    n = len(spans)
    i = 0
    while i < n:
        span = spans[i]
        if span is None:
            i += 1
            continue
        start, end = span
        j = i + 1
        while j < n and spans[j] is None:
            j += 1
        unmatched = j - i - 1
        dur = end - start
        if dur <= 1.05 or unmatched == 0:
            if dur > 1.25:
                spans[i] = (start, start + 1.25)
            i += 1
            continue
        next_start = spans[j][0] if j < n else end
        if j < n and abs(next_start - end) > 0.35:
            if dur > 1.25:
                spans[i] = (start, start + 1.25)
            i += 1
            continue
        room = max(0.0, next_start - start)
        keep = min(0.55, room / (unmatched + 1))
        keep = max(0.12, keep)
        spans[i] = (start, min(next_start, start + keep))
        i = j


def _fill_unmatched(spans: list[tuple[float, float] | None]) -> None:
    """Give unmatched tokens a short slot. Do not stretch them across a pause or the intro."""
    max_dur = 0.42
    min_dur = 0.06
    n = len(spans)
    k = 0
    while k < n:
        if spans[k] is not None:
            k += 1
            continue
        start = k
        while k < n and spans[k] is None:
            k += 1
        left_e = spans[start - 1][1] if start > 0 and spans[start - 1] is not None else None
        right_s = spans[k][0] if k < n and spans[k] is not None else None
        count = k - start
        if left_e is None and right_s is None:
            t = 0.0
            for idx in range(start, k):
                spans[idx] = (t, t + 0.25)
                t += 0.25
            continue
        if left_e is None:
            slot = max_dur
            t = max(0.0, right_s - slot * count)
            for idx in range(start, k):
                end = min(right_s, t + slot)
                if end < t + min_dur:
                    end = t + min_dur
                spans[idx] = (t, end)
                t = end
            continue
        if right_s is None:
            t = left_e
            for idx in range(start, k):
                spans[idx] = (t, t + 0.28)
                t += 0.28
            continue
        window = max(0.0, right_s - left_e)
        # Several tokens inside a long hole are speech Whisper glued together.
        # A single token in a long hole is a pause — keep it short.
        if count >= 2 and window >= 1.2:
            budget = window
            slot_cap = 1.05
        else:
            budget = min(window, count * max_dur)
            slot_cap = max_dur
        slot = min(slot_cap, budget / count) if count else 0.0
        t = left_e
        for idx in range(start, k):
            end = min(right_s, t + max(slot, min_dur if window > count * min_dur else slot))
            if end < t:
                end = t
            spans[idx] = (t, end)
            t = end


def _clamp_monotonic(spans: list[tuple[float, float] | None]) -> None:
    prev_end = 0.0
    for idx, span in enumerate(spans):
        if span is None:
            continue
        start, end = span
        if start < prev_end:
            start = prev_end
        nxt = None
        for later in spans[idx + 1 :]:
            if later is not None:
                nxt = later[0]
                break
        if nxt is not None and end > nxt:
            end = nxt
        if end < start + 0.02:
            end = start + 0.02
        spans[idx] = (start, end)
        prev_end = end


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
    aligned, matched = align_words(expected, spoken)
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
        aligned, matched = align_words(expected, spoken)
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
                "matched": matched,
                "placed": matched,
            },
        }
        out.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"  wrote {out} {payload['stats']}", flush=True)
        done += 1

    print(f"DONE aligned={done}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
