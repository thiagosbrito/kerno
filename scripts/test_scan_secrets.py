#!/usr/bin/env python3
"""Exercise the secret scanner with synthetic, non-functional fixtures built at runtime."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scan_secrets  # noqa: E402

# Fixtures are assembled from fragments so this file itself never matches a rule.
SYNTHETIC = {
    'private-key-block': '-----BEGIN ' + 'RSA PRIVATE KEY-----',
    'aws-access-key-id': 'id = ' + 'AKIA' + 'ABCDEFGHIJKLMNOP',
    'github-token': 'tok ' + 'ghp_' + 'a' * 36,
    'slack-token': 'x ' + 'xoxb-' + '1234567890-abcdef',
    'stripe-live-key': 'k ' + 'sk_live_' + 'A1b2C3d4E5f6G7h8',
    'google-api-key': 'k ' + 'AIza' + 'B' * 35,
    'supabase-service-jwt': 'k ' + 'eyJhbGciOiJIUzI1NiJ9' + '.eyJyb2xlIjoic2VydmljZV9yb2xlIn0' + '.c2lnbmF0dXJlc2lnbmF0dXJl',
    'supabase-secret-key': 'k ' + 'sb_secret_' + 'A1b2C3d4E5' * 3,
    'credential-assignment': 'SUPABASE_SERVICE_ROLE_KEY=' + 'q8Zr2LmN7vXb4TpW9sKd',
}


class ScanSecrets(unittest.TestCase):
    def rules(self, text):
        return [rule for _, _, rule in scan_secrets.scan_text('f', text)]

    def test_each_rule_detects_its_fixture(self):
        for rule, text in SYNTHETIC.items():
            self.assertIn(rule, self.rules(text), rule)

    def test_placeholders_and_names_are_allowed(self):
        for text in [
            'SUPABASE_SERVICE_ROLE_KEY=',
            'SUPABASE_SERVICE_ROLE_KEY=SERVICE-ROLE-SENTINEL-9f3a',
            'NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-placeholder',
            'API_KEY=your-api-key-goes-here-please',
            'plain prose about a secret token',
        ]:
            self.assertEqual(self.rules(text), [], text)

    def test_quoted_keys_are_detected(self):
        for text in [
            '"SUPABASE_SERVICE_ROLE_KEY": "' + 'q8Zr2LmN7vXb4TpW9sKd' + '"',
            "'API_KEY': '" + 'q8Zr2LmN7vXb4TpW9sKd' + "'",
        ]:
            self.assertIn('credential-assignment', self.rules(text), text)

    def test_placeholder_does_not_hide_later_real_value(self):
        text = 'API_KEY=your-api-key-goes-here-please API_KEY=' + 'q8Zr2LmN7vXb4TpW9sKd'
        self.assertEqual(self.rules(text), ['credential-assignment'])

    def test_allow_marker_only_in_test_scripts(self):
        line = SYNTHETIC['github-token'] + '  # secret-scan: allow'
        self.assertEqual([r for _, _, r in scan_secrets.scan_text('scripts/test_x.py', line)], [])
        for name in ['f', 'README.md', 'scripts/scan_secrets.py', 'apps/scripts/test_x.py', 'scripts/sub/test_x.py']:
            self.assertEqual([r for _, _, r in scan_secrets.scan_text(name, line)], ['github-token'], name)

    def test_output_never_contains_value(self):
        import contextlib, io, tempfile
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'leak.txt').write_text(SYNTHETIC['github-token'] + '\n')
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = scan_secrets.main(['--root', tmp, 'leak.txt'])
            self.assertEqual(code, 1)
            self.assertIn('leak.txt:1: github-token', out.getvalue())
            self.assertNotIn('ghp_', out.getvalue() + err.getvalue())

    def test_repository_is_clean(self):
        self.assertEqual(scan_secrets.main([]), 0)


if __name__ == '__main__':
    unittest.main()
