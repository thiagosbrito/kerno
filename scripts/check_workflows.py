#!/usr/bin/env python3
"""Offline static guard for .github/workflows/*.yml (line/regex based, no YAML parser).

Usage: check_workflows.py [--root DIR] [FILE ...]
Rules (each finding prints file:line: rule):
  forbidden-trigger      pull_request_target or workflow_run
  secrets-reference      `secrets.`/`secrets[` reference, `secrets:` passthrough, or a bare
                         `secrets` inside a single-line `${{ ... }}` expression or an `if:` value
                         (e.g. toJSON(secrets))
  permissions            no top-level (indent 0) permissions block, or any permissions value
                         (top-level or job-level) other than `contents: read`
  unpinned-action        `uses:` not pinned to a 40-hex commit SHA (local ./ actions allowed);
                         `uses:` with its value on the next line or in flow style
                         (`{ uses: ... }`) is reported here too because it is not parsed
  checkout-credentials   actions/checkout (case-insensitive) step without `persist-credentials: false`
Exit 1 on any finding.

Limits: this is a line/regex accidental-change guard, not a YAML parser and not a security
boundary. Comment stripping is naive: a ` #` inside a quoted string hides the rest of that
line. Multi-line expressions and exotic YAML forms (anchors, multi-line flow maps) are not
analysed. Branch protection and code review remain the real controls.
"""
from pathlib import Path
import argparse
import re
import sys

TRIGGER = re.compile(r'\b(pull_request_target|workflow_run)\b')
SECRETS = re.compile(r'\bsecrets\s*(?:\.|\[)|^\s*-?\s*secrets\s*:')
PERMISSIONS = re.compile(r'^(\s*)permissions\s*:\s*(.*)$')
USES = re.compile(r'^(\s*)(-\s+)?uses\s*:\s*(\S*)')
FLOW_USES = re.compile(r'[{,]\s*["\']?uses["\']?\s*:')
EXPRESSION = re.compile(r'\$\{\{(.*?)\}\}')
IF_VALUE = re.compile(r'^\s*(?:-\s+)?if\s*:\s*(.*)$')
BARE_SECRETS = re.compile(r'\bsecrets\b')
PINNED = re.compile(r'@[0-9a-f]{40}$')
PERSIST = re.compile(r'^\s*(?:-\s+)?persist-credentials\s*:\s*["\']?false["\']?\s*$')
CONTENTS_READ = re.compile(r'^contents\s*:\s*read$')


def strip_comment(line):
    return re.sub(r'(^|\s)#.*$', '', line).rstrip()


def indent_of(line):
    return len(line) - len(line.lstrip(' '))


def step_block(lines, index):
    """Return (start, end) line indexes of the step containing lines[index]."""
    match = USES.match(lines[index])
    dash = indent_of(lines[index]) if match.group(2) else indent_of(lines[index]) - 2
    start = index
    while start > 0 and not (indent_of(lines[start]) == dash and lines[start].lstrip().startswith('-')):
        start -= 1
    end = index + 1
    while end < len(lines) and (not lines[end].strip() or indent_of(lines[end]) > dash):
        end += 1
    return start, end


def check_text(name, text):
    raw = text.splitlines()
    lines = [strip_comment(line) for line in raw]
    findings = []
    saw_permissions = False
    for i, line in enumerate(lines):
        number = i + 1
        if not line.strip():
            continue
        if TRIGGER.search(line):
            findings.append((name, number, 'forbidden-trigger'))
        if SECRETS.search(line):
            findings.append((name, number, 'secrets-reference'))
        elif any(BARE_SECRETS.search(m) for m in EXPRESSION.findall(line)):
            findings.append((name, number, 'secrets-reference'))
        else:
            cond = IF_VALUE.match(line)
            if cond and BARE_SECRETS.search(cond.group(1)):
                findings.append((name, number, 'secrets-reference'))
        perm = PERMISSIONS.match(line)
        if perm:
            if not perm.group(1):
                saw_permissions = True
            value = perm.group(2).strip()
            if value:
                if value != 'contents: read' and value != '{ contents: read }' and value != '{contents: read}':
                    findings.append((name, number, 'permissions'))
            else:
                base = len(perm.group(1))
                j = i + 1
                body = []
                while j < len(lines) and (not lines[j].strip() or indent_of(lines[j]) > base):
                    if lines[j].strip():
                        body.append(lines[j].strip())
                    j += 1
                if body != ['contents: read']:
                    findings.append((name, number, 'permissions'))
        uses = USES.match(line)
        if FLOW_USES.search(line) or (uses and not uses.group(3)):
            findings.append((name, number, 'unpinned-action'))
        elif uses:
            ref = uses.group(3).strip('"\'')
            if not ref.startswith('./'):
                if not PINNED.search(ref):
                    findings.append((name, number, 'unpinned-action'))
                if ref.lower().startswith('actions/checkout@'):
                    start, end = step_block(lines, i)
                    if not any(PERSIST.match(lines[k]) for k in range(start, end)):
                        findings.append((name, number, 'checkout-credentials'))
    if not saw_permissions and any(line.strip() for line in lines):
        findings.append((name, 1, 'permissions'))
    return findings


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument('files', nargs='*')
    args = parser.parse_args(argv)
    root = Path(args.root)
    if args.files:
        paths = [root / f for f in args.files]
    else:
        wf = root / '.github' / 'workflows'
        paths = sorted(list(wf.glob('*.yml')) + list(wf.glob('*.yaml')))
    if not paths:
        print('No workflow files found under .github/workflows.', file=sys.stderr)
        return 1
    findings = []
    for path in paths:
        try:
            rel = path.relative_to(root).as_posix()
        except ValueError:
            rel = str(path)
        findings += check_text(rel, path.read_text(encoding='utf-8', errors='replace'))
    for name, number, rule in findings:
        print(f'{name}:{number}: {rule}')
    if findings:
        print(f'{len(findings)} workflow policy violation(s).', file=sys.stderr)
        return 1
    print(f'Workflow check clean ({len(paths)} files).')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
