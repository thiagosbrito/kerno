#!/usr/bin/env python3
"""Offline scan of git-tracked text files for credential-shaped strings.

Usage: scan_secrets.py [--root DIR] [FILE ...]
With no FILE arguments it scans `git ls-files` under the root. Findings print
file:line and the rule name only, never the matched value. Exit 1 on any finding.
A line containing `secret-scan: allow` is skipped only in scripts/test_*.py
(documented synthetic fixtures); the marker is ignored everywhere else.
"""
from pathlib import Path
import argparse
import re
import subprocess
import sys

RULES = {
    'private-key-block': re.compile(r'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----'),
    'aws-access-key-id': re.compile(r'\b(?:AKIA|ASIA)[0-9A-Z]{16}\b'),
    'github-token': re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b'),
    'slack-token': re.compile(r'\bxox[abprs]-[A-Za-z0-9-]{10,}\b'),
    'stripe-live-key': re.compile(r'\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b'),
    'google-api-key': re.compile(r'\bAIza[0-9A-Za-z_-]{35}\b'),
    'supabase-service-jwt': re.compile(r'\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b'),
    'supabase-secret-key': re.compile(r'\bsb_secret_[A-Za-z0-9_-]{20,}'),
    'credential-assignment': re.compile(
        r'(?i)\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|SERVICE_ROLE_KEY|API_KEY)[A-Z0-9_]*["\']?\s*[:=]\s*["\']?([A-Za-z0-9/+_\-]{20,})["\']?'
    ),
}
# Values that are clearly placeholders/sentinels, not credentials.
PLACEHOLDER = re.compile(r'(?i)(placeholder|sentinel|example|changeme|your[-_]|<|\$\{|xxxx)')
ALLOW = 'secret-scan: allow'
ALLOW_FILES = re.compile(r'scripts/test_[^/]+\.py')


def scan_text(name, text):
    findings = []
    allow_enabled = bool(ALLOW_FILES.fullmatch(name))
    for number, line in enumerate(text.splitlines(), 1):
        if allow_enabled and ALLOW in line:
            continue
        for rule, pattern in RULES.items():
            for match in pattern.finditer(line):
                if rule == 'credential-assignment' and PLACEHOLDER.search(match.group(0)):
                    continue
                findings.append((name, number, rule))
                break
    return findings


def tracked_files(root):
    out = subprocess.run(['git', 'ls-files', '-z'], cwd=root, check=True, capture_output=True).stdout
    return [p for p in out.decode().split('\0') if p]


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument('files', nargs='*')
    args = parser.parse_args(argv)
    root = Path(args.root)
    names = args.files or tracked_files(root)
    findings = []
    for name in names:
        path = root / name
        if not path.is_file() or name == 'pnpm-lock.yaml':
            continue
        data = path.read_bytes()
        if b'\0' in data:
            continue
        findings += scan_text(name, data.decode('utf-8', 'replace'))
    for name, number, rule in findings:
        print(f'{name}:{number}: {rule}')
    if findings:
        print(f'{len(findings)} potential secret(s) found. Rotate any real credential; values are not printed.', file=sys.stderr)
        return 1
    print(f'Secret scan clean ({len(names)} files).')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
