#!/usr/bin/env python3
# Verify the strings baked into viewer-assets.js still match their sources.
#
# viewer-assets.js holds hand-pasted JSON-escaped copies of:
#   - viewer-runtime.js              -> RedpenAssets.viewerRuntime
#   - viewer-template.html           -> RedpenAssets.template
#   - vendor/highlight-theme.css     -> RedpenAssets.themeCss
#   - vendor/highlight.min.js        -> RedpenAssets.hljsMain
#   - vendor/highlight-diff.min.js   -> RedpenAssets.hljsDiff
#
# Nothing in the repo enforces that the copies stay in sync, which means an
# edit to viewer-runtime.js silently fails to reach the exported viewer until
# someone re-pastes. This script is the missing enforcement: it extracts each
# embedded string and compares it to the source file. Exit 0 if all match, 1
# with a summary on the first mismatch.

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent
ASSETS = REPO / "viewer-assets.js"

PAIRS = [
    ("viewerRuntime", "viewer-runtime.js"),
    ("template",      "viewer-template.html"),
    ("themeCss",      "vendor/highlight-theme.css"),
    ("hljsMain",      "vendor/highlight.min.js"),
    ("hljsDiff",      "vendor/highlight-diff.min.js"),
]


def extract_embedded(assets_src: str, name: str) -> str:
    # RedpenAssets.NAME = "...";   — a JSON-escaped string literal, possibly
    # very long, terminated by an unescaped closing double quote followed by
    # a semicolon. Match the assignment and JSON-decode the literal so escape
    # handling is exactly what the browser would do.
    marker = f"RedpenAssets.{name} = "
    start = assets_src.find(marker)
    if start == -1:
        raise SystemExit(f"check_drift: {name}: assignment not found in viewer-assets.js")
    quote = assets_src.find('"', start + len(marker))
    if quote == -1:
        raise SystemExit(f"check_drift: {name}: opening quote not found")
    # Walk to the matching unescaped closing quote.
    i = quote + 1
    n = len(assets_src)
    while i < n:
        c = assets_src[i]
        if c == "\\":
            i += 2
            continue
        if c == '"':
            literal = assets_src[quote:i + 1]
            return json.loads(literal)
        i += 1
    raise SystemExit(f"check_drift: {name}: closing quote not found")


def main() -> int:
    assets_src = ASSETS.read_text(encoding="utf-8")
    failures = []
    for name, path in PAIRS:
        embedded = extract_embedded(assets_src, name)
        source = (REPO / path).read_text(encoding="utf-8")
        if embedded == source:
            print(f"  ok   {name:<14} <- {path}")
            continue
        failures.append((name, path, embedded, source))
        print(f"  DRIFT {name:<14} <- {path}  ({len(embedded)} embedded vs {len(source)} source chars)")

    if not failures:
        print("check_drift: viewer-assets.js is in sync with all sources.")
        return 0

    print()
    print("check_drift: drift detected. Re-paste the JSON-escaped source into")
    print("the matching RedpenAssets slot. One-liner:")
    for name, path, _, _ in failures:
        print(f"  python3 -c \"import json,sys; print(json.dumps(open('{path}').read()))\"  # -> RedpenAssets.{name}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
