#!/usr/bin/env python3
"""Check repository Markdown local link targets without fetching remote content."""
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

root = Path(__file__).resolve().parents[1]
errors = []
count = 0
for source in sorted(root.rglob('*.md')):
    if '.git' in source.parts or 'node_modules' in source.parts:
        continue
    count += 1
    for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', source.read_text()):
        target = target.strip().strip('<>')
        parsed = urlsplit(target)
        if parsed.scheme or parsed.netloc or not parsed.path:
            continue
        destination = (source.parent / unquote(parsed.path)).resolve()
        if not destination.is_relative_to(root) or not destination.exists():
            errors.append(f'{source.relative_to(root)}: invalid local target {target}')
if errors:
    raise SystemExit('\n'.join(errors))
print(f'Validated local links in {count} Markdown files.')
