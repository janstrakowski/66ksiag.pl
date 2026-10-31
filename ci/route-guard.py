#!/usr/bin/env python3
"""Keep the dev preview off the production hostnames.

Top-level wrangler routes are production. [env.devpreview] replaces those
inherited routes and may name only devpreview.66ksiag.pl.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

PREVIEW_ENV = "devpreview"
PREVIEW_HOST = "devpreview.66ksiag.pl"
PREVIEW_WORKER = "ksiag-devpreview"
PROD_PATTERNS = ("66ksiag.pl/*", "www.66ksiag.pl/*")


def split_env(text: str, env: str) -> tuple[str, str]:
    top: list[str] = []
    body: list[str] = []
    mode = "top"
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            name = stripped.strip("[]").strip()
            if name == f"env.{env}" or name.startswith(f"env.{env}."):
                mode = "env"
            elif mode == "env":
                mode = "after"
        if mode == "top":
            top.append(line)
        elif mode == "env":
            body.append(line)
    return "\n".join(top), "\n".join(body)


def patterns(section: str) -> list[str]:
    return re.findall(r'(?m)^\s*pattern\s*=\s*"([^"]+)"\s*$', section)


def fail(message: str) -> None:
    raise SystemExit(f"route-guard: {message}")


def check_preview_config(text: str) -> None:
    top, env = split_env(text, PREVIEW_ENV)
    if "[env.devpreview]" not in env:
        fail("missing [env.devpreview]")
    if f'name = "{PREVIEW_WORKER}"' not in env:
        fail(f'env.devpreview must set name = "{PREVIEW_WORKER}"')
    env_patterns = patterns(env)
    if env_patterns != [PREVIEW_HOST]:
        fail(f"env.devpreview routes must be only {PREVIEW_HOST}, got {env_patterns}")
    if "custom_domain = true" not in env:
        fail("env.devpreview route must set custom_domain = true")
    if "66ksiag.pl/*" in env or "www.66ksiag.pl" in env:
        fail("env.devpreview contains a production hostname")
    top_patterns = patterns(top)
    if top_patterns != list(PROD_PATTERNS):
        fail(f"production routes must stay {list(PROD_PATTERNS)}, got {top_patterns}")
    top_code = "\n".join(line for line in top.splitlines() if not line.lstrip().startswith("#"))
    if PREVIEW_HOST in top_code:
        fail("preview hostname is in the top-level production config")


def check_production_config(text: str) -> None:
    check_preview_config(text)


def check_preview_output(text: str) -> None:
    if PREVIEW_HOST not in text:
        fail("wrangler output has no devpreview.66ksiag.pl trigger")
    if "custom domain" not in text.lower():
        fail("wrangler output did not attach a custom domain")
    if PREVIEW_WORKER not in text:
        fail("wrangler output did not name worker ksiag-devpreview")
    if "66ksiag.pl/*" in text or "www.66ksiag.pl" in text:
        fail("wrangler output includes a production route")
    if re.search(r"Deployed ksiag triggers", text):
        fail("wrangler deployed the production worker")
    for match in re.finditer(r"66ksiag\.pl", text):
        before = text[max(0, match.start() - 12) : match.start()]
        zone = text[max(0, match.start() - 11) : match.end()]
        if before.endswith("devpreview."):
            continue
        if zone == "zone name: 66ksiag.pl":
            continue
        fail(f"wrangler output mentions the production host near {text[max(0, match.start() - 24): match.end() + 8]!r}")


def self_test() -> None:
    sample = """name = "ksiag"
[[routes]]
pattern = "66ksiag.pl/*"
zone_name = "66ksiag.pl"

[[routes]]
pattern = "www.66ksiag.pl/*"
zone_name = "66ksiag.pl"

[env.devpreview]
name = "ksiag-devpreview"

[[env.devpreview.routes]]
pattern = "devpreview.66ksiag.pl"
custom_domain = true
zone_name = "66ksiag.pl"
"""
    check_preview_config(sample)
    stolen = sample.replace(
        'pattern = "devpreview.66ksiag.pl"',
        'pattern = "66ksiag.pl/*"',
        1,
    )
    try:
        check_preview_config(stolen)
    except SystemExit:
        pass
    else:
        fail("self-test accepted a production route on the preview env")
    good = (
        "Deployed ksiag-devpreview triggers (1.0 sec)\n"
        "  devpreview.66ksiag.pl (custom domain - zone name: 66ksiag.pl)\n"
        "  https://ksiag-devpreview.example.workers.dev\n"
    )
    check_preview_output(good)
    try:
        check_preview_output(good + "  www.66ksiag.pl/* (zone name: 66ksiag.pl)\n")
    except SystemExit:
        pass
    else:
        fail("self-test accepted www.66ksiag.pl in wrangler output")
    try:
        check_preview_output("Deployed ksiag triggers\n  66ksiag.pl/*\n")
    except SystemExit:
        pass
    else:
        fail("self-test accepted a production deploy log")
    print("route-guard: self-test ok")


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        fail("usage: route-guard.py preview|production|preview-output|self-test <file|->")
    mode = argv[1]
    if mode == "self-test":
        self_test()
        return
    src = argv[2] if len(argv) > 2 else "-"
    text = sys.stdin.read() if src == "-" else Path(src).read_text()
    if mode == "preview":
        check_preview_config(text)
    elif mode == "production":
        check_production_config(text)
    elif mode == "preview-output":
        check_preview_output(text)
    else:
        fail(f"unknown mode {mode}")


if __name__ == "__main__":
    main(sys.argv)
