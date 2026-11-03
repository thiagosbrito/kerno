#!/usr/bin/env python3
"""Fail if server-only env names or sentinel values appear in client bundles (.next/static)."""
import os, sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
server_only = ["SUPABASE_SERVICE_ROLE_KEY"]
needles = list(server_only) + [v for n in server_only if (v := os.environ.get(n))]
if len(needles) == len(server_only):
    raise SystemExit("Set the server-only variables to sentinel values before building, so leaks can be detected.")
hits = []
for static in root.glob("apps/*/.next/static"):
    for f in static.rglob("*"):
        if f.is_file() and f.suffix in {".js", ".css", ".map", ".html", ".json"}:
            text = f.read_text(errors="ignore")
            hits += [f"{f.relative_to(root)}: {n if n in server_only else 'sentinel value'}" for n in needles if n in text]
if hits:
    raise SystemExit("Server-only data found in client bundles:\n" + "\n".join(hits))
print("No server-only names or values found in client bundles.")
