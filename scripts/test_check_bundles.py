#!/usr/bin/env python3
"""Negative/positive tests for check_bundles.py using temp fixture trees."""
from __future__ import annotations
import subprocess, sys, tempfile, unittest, os
from pathlib import Path

CHECKER = Path(__file__).resolve().parent / "check_bundles.py"
SENTINEL = "SERVICE-ROLE-SENTINEL-TEST"


def make_tree(root: Path, plant: str | None = None, skip: str | None = None, empty: str | None = None):
    for app in ("admin", "storefront"):
        for rel in (".next/static/chunks", ".next/server/app"):
            if skip == app and rel.startswith(".next/server"):
                continue
            d = root / "apps" / app / rel
            d.mkdir(parents=True)
            if empty == app:
                continue
            (d / "ok.js").write_text("console.log('clean')")
    if plant:
        (root / "apps/storefront/.next/server/app/page.rsc").write_text(plant)


def run(root: Path, sentinel=SENTINEL):
    env = {**os.environ, "SUPABASE_SERVICE_ROLE_KEY": sentinel}
    return subprocess.run([sys.executable, "-I", str(CHECKER), str(root)], env=env, capture_output=True, text=True)


class CheckBundles(unittest.TestCase):
    def tree(self, **kw):
        t = tempfile.TemporaryDirectory(); self.addCleanup(t.cleanup)
        make_tree(Path(t.name), **kw)
        return Path(t.name)

    def test_clean_passes(self):
        self.assertEqual(run(self.tree()).returncode, 0)

    def test_planted_value_in_rsc_fails(self):
        r = run(self.tree(plant=f"x {SENTINEL} y"))
        self.assertEqual(r.returncode, 1); self.assertIn("sentinel value", r.stderr)

    def test_planted_name_fails(self):
        self.assertEqual(run(self.tree(plant="SUPABASE_SERVICE_ROLE_KEY")).returncode, 1)

    def test_missing_dir_fails(self):
        self.assertEqual(run(self.tree(skip="admin")).returncode, 1)

    def test_empty_app_fails(self):
        self.assertEqual(run(self.tree(empty="storefront")).returncode, 1)

    def test_missing_root_fails(self):
        with tempfile.TemporaryDirectory() as t:
            self.assertEqual(run(Path(t)).returncode, 1)


if __name__ == "__main__":
    unittest.main()
