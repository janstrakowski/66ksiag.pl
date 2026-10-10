"""Regresja wyrównania słów: czołówka nagrania nie może zjeść początku rozdziału."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from align_whisper import align_words


def _spoken(words: list[tuple[str, float, float]]) -> list[dict]:
    return [{"word": w, "start": s, "end": e} for w, s, e in words]


def test_intro_does_not_steal_the_opening_verse():
    expected = [
        (1, 0, "In"),
        (1, 1, "the"),
        (1, 2, "beginning"),
        (1, 3, "God"),
        (1, 4, "created"),
        (1, 5, "the"),
        (1, 6, "heaven"),
        (1, 7, "and"),
        (1, 8, "the"),
        (1, 9, "earth"),
    ]
    spoken = _spoken(
        [
            ("The", 0.88, 1.34),
            ("Holy", 1.34, 1.50),
            ("Bible", 1.50, 1.86),
            ("the", 2.36, 2.56),
            ("King", 2.56, 2.68),
            ("James", 2.68, 2.98),
            ("Version", 2.98, 3.26),
            ("read", 3.68, 4.38),
            ("by", 4.38, 4.62),
            ("Alexander", 4.62, 4.84),
            ("Scourby", 4.84, 5.42),
            ("chapter", 11.41, 11.97),
            ("one", 11.97, 12.35),
            ("In", 13.89, 13.93),
            ("the", 13.93, 14.03),
            ("beginning", 14.03, 14.27),
            ("God", 14.61, 14.75),
            ("created", 14.75, 15.23),
            ("the", 15.23, 15.57),
            ("heaven", 15.57, 15.81),
            ("and", 15.81, 16.29),
            ("the", 16.29, 16.45),
            ("earth", 16.45, 16.69),
        ]
    )
    aligned, matched = align_words(expected, spoken)
    assert matched == len(expected)
    assert aligned[0]["s"] == 13.89
    assert aligned[2]["t"] == "beginning"
    assert aligned[2]["s"] == 14.03
    assert aligned[-1]["t"] == "earth"
    assert aligned[-1]["s"] == 16.45
    for prev, cur in zip(aligned, aligned[1:]):
        assert cur["s"] >= prev["s"] - 1e-9
        assert cur["e"] >= cur["s"]


def test_merged_whisper_word_splits_across_two_tokens():
    expected = [(29, 0, "every"), (29, 1, "thing"), (29, 2, "that")]
    spoken = _spoken([("everything", 10.0, 10.6), ("that", 10.6, 10.9)])
    aligned, matched = align_words(expected, spoken)
    assert matched == 3
    assert aligned[0]["s"] == 10.0
    assert aligned[1]["e"] == 10.6
    assert aligned[0]["e"] <= aligned[1]["s"] + 1e-9
    assert aligned[2]["s"] == 10.6


def test_near_miss_still_lands_on_the_spoken_word():
    expected = [(1, 0, "fowl"), (1, 1, "of")]
    spoken = _spoken([("foul", 4.0, 4.4), ("of", 4.4, 4.6)])
    aligned, matched = align_words(expected, spoken)
    assert matched == 2
    assert aligned[0]["s"] == 4.0
    assert aligned[0]["e"] == 4.4


def test_long_whisper_token_yields_time_to_the_skipped_clause():
    expected = [
        (9, 0, "let"),
        (9, 1, "the"),
        (9, 2, "dry"),
        (9, 3, "land"),
        (9, 4, "appear"),
        (10, 0, "the"),
        (10, 1, "dry"),
        (10, 2, "land"),
        (10, 3, "Earth"),
    ]
    spoken = _spoken(
        [
            ("let", 77.83, 83.63),
            ("the", 83.63, 83.79),
            ("dry", 83.79, 83.95),
            ("land", 83.95, 84.47),
            ("earth", 84.47, 85.31),
        ]
    )
    aligned, _matched = align_words(expected, spoken)
    assert aligned[0]["t"] == "let"
    assert aligned[0]["e"] < 79.0
    assert aligned[1]["s"] < 83.63
    assert aligned[4]["t"] == "appear"
    assert aligned[4]["e"] <= 83.63 + 1e-6
    assert aligned[5]["s"] == 83.63
    assert aligned[8]["s"] == 84.47
    for prev, cur in zip(aligned, aligned[1:]):
        assert cur["s"] >= prev["e"] - 1e-6


def test_unmatched_token_does_not_cover_the_pause():
    expected = [(1, 0, "light"), (1, 1, "zzzz"), (1, 2, "darkness")]
    spoken = _spoken([("light", 1.0, 1.3), ("darkness", 5.0, 5.5)])
    aligned, _matched = align_words(expected, spoken)
    assert aligned[0]["s"] == 1.0
    assert aligned[2]["s"] == 5.0
    assert aligned[1]["e"] - aligned[1]["s"] <= 0.45
    assert aligned[1]["e"] < 5.0


if __name__ == "__main__":
    test_intro_does_not_steal_the_opening_verse()
    test_merged_whisper_word_splits_across_two_tokens()
    test_near_miss_still_lands_on_the_spoken_word()
    test_long_whisper_token_yields_time_to_the_skipped_clause()
    test_unmatched_token_does_not_cover_the_pause()
    print("ok")
