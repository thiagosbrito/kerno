#!/usr/bin/env python3
"""Fail if server-only env names or sentinel values appear in client-reachable build output.

Scans every text file under .next/static and .next/server/app (prerendered HTML and RSC
payloads) of both apps. Fails if an app's output is missing or yields zero scanned files.
Root override: first CLI argument or KERNO_BUNDLE_ROOT (used by the self-test).
"""
from __future__ import annotations
import os, sys
from pathlib import Path

APPS = ("admin", "storefront")
SCAN_DIRS = (".next/static", ".next/server/app")
SERVER_ONLY = ["SUPABASE_SERVICE_ROLE_KEY"]
BINARY_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".br", ".gz"}


def scan(root: Path, env=os.environ) -> list[str]:
    needles = list(SERVER_ONLY) + [v for n in SERVER_ONLY if (v := env.get(n))]
    if len(needles) == len(SERVER_ONLY):
        return ["Set the server-only variables to sentinel values before building, so leaks can be detected."]
    problems = []
    for app in APPS:
        scanned = 0
        for rel in SCAN_DIRS:
            d = root / "apps" / app / rel
            if not d.is_dir():
                problems.append(f"apps/{app}/{rel}: output directory missing")
                continue
            for f in d.rglob("*"):
                if not f.is_file() or f.suffix.lower() in BINARY_SUFFIXES:
                    continue
                scanned += 1
                text = f.read_bytes().decode("utf-8", errors="ignore")
                problems += [
                    f"{f.relative_to(root)}: {n if n in SERVER_ONLY else 'sentinel value'}"
                    for n in needles if n in text
                ]
        if scanned == 0:
            problems.append(f"apps/{app}: zero files scanned")
    return problems


def main(argv: list[str]) -> int:
    root = Path(argv[1] if len(argv) > 1 else os.environ.get("KERNO_BUNDLE_ROOT") or Path(__file__).resolve().parents[1])
    problems = scan(root)
    if problems:
        print("Bundle check failed:\n" + "\n".join(problems), file=sys.stderr)
        return 1
    print("No server-only names or values found in client bundles.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
