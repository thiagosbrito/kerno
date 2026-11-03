#!/usr/bin/env python3
"""Exercise the workflow policy checker with synthetic workflow text."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_workflows  # noqa: E402

SHA = 'a' * 40
GOOD = f"""name: t
# pull_request_target and secrets.X in comments are ignored
on:
  pull_request:
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@{SHA} # v1
        with:
          persist-credentials: false
      - name: named
        uses: actions/checkout@{SHA}
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: ./.github/actions/local
      - run: echo ok
"""


class CheckWorkflows(unittest.TestCase):
    def rules(self, text):
        return sorted(rule for _, _, rule in check_workflows.check_text('w.yml', text))

    def test_good_workflow_is_clean(self):
        self.assertEqual(self.rules(GOOD), [])

    def test_forbidden_triggers(self):
        self.assertEqual(self.rules(GOOD.replace('pull_request:', 'pull_request_target:')), ['forbidden-trigger'])
        self.assertEqual(self.rules(GOOD.replace('pull_request:', 'workflow_run:')), ['forbidden-trigger'])

    def test_secrets_reference(self):
        bad = GOOD + '      - run: echo\n        env:\n          T: ${{ secrets.TOKEN }}\n'
        self.assertEqual(self.rules(bad), ['secrets-reference'])

    def test_secrets_in_expressions_and_if(self):
        for extra in [
            '      - run: echo\n        env:\n          T: ${{ toJSON(secrets) }}\n',
            '      - run: echo\n        if: contains(toJSON(secrets), \'x\')\n',
        ]:
            self.assertEqual(self.rules(GOOD + extra), ['secrets-reference'], extra)
        self.assertEqual(self.rules(GOOD + '      - run: pnpm scan:secrets && pnpm test:secrets:self\n'), [])

    def test_job_level_permissions_do_not_satisfy_top_level(self):
        text = GOOD.replace('permissions:\n  contents: read\n', '').replace(
            '    runs-on', '    permissions:\n      contents: read\n    runs-on')
        self.assertEqual(self.rules(text), ['permissions'])

    def test_uses_bypass_forms(self):
        self.assertEqual(self.rules(GOOD + f'      - uses:\n          foo/bar@{SHA}\n'), ['unpinned-action'])
        self.assertEqual(self.rules(GOOD + f'      - {{ uses: foo/bar@{SHA} }}\n'), ['unpinned-action'])
        self.assertEqual(self.rules(GOOD + '      - { uses: foo/bar@v1 }\n'), ['unpinned-action'])

    def test_mixed_case_checkout_is_checked(self):
        bad = GOOD + f'      - uses: Actions/Checkout@{SHA}\n'
        self.assertEqual(self.rules(bad), ['checkout-credentials'])

    def test_permissions(self):
        self.assertEqual(self.rules(GOOD.replace('contents: read', 'contents: write')), ['permissions'])
        self.assertEqual(self.rules(GOOD.replace('permissions:\n  contents: read', 'permissions: read-all')), ['permissions'])
        self.assertEqual(self.rules(GOOD.replace('contents: read', 'contents: read\n  id-token: write')), ['permissions'])
        self.assertEqual(self.rules(GOOD.replace('permissions:\n  contents: read\n', '')), ['permissions'])
        job_level = GOOD.replace('    runs-on', '    permissions:\n      pull-requests: write\n    runs-on')
        self.assertEqual(self.rules(job_level), ['permissions'])

    def test_unpinned_actions(self):
        self.assertEqual(self.rules(GOOD.replace('actions/checkout@' + SHA + ' # v1', 'actions/checkout@v4')), ['unpinned-action'])
        self.assertEqual(self.rules(GOOD + '      - uses: docker://alpine:3\n'), ['unpinned-action'])
        self.assertEqual(self.rules(GOOD + f'      - uses: foo/bar@{"a" * 39}\n'), ['unpinned-action'])

    def test_checkout_requires_persist_credentials_false(self):
        bad = GOOD.replace('        with:\n          persist-credentials: false\n      - name', '      - name', 1)
        self.assertEqual(self.rules(bad), ['checkout-credentials'])
        named = GOOD.replace('          fetch-depth: 0\n          persist-credentials: false\n', '          fetch-depth: 0\n')
        self.assertEqual(self.rules(named), ['checkout-credentials'])
        true_ = GOOD.replace('persist-credentials: false', 'persist-credentials: true', 1)
        self.assertEqual(self.rules(true_), ['checkout-credentials'])

    def test_reports_line_numbers(self):
        found = check_workflows.check_text('w.yml', GOOD.replace('pull_request:', 'workflow_run:'))
        self.assertEqual(found, [('w.yml', 4, 'forbidden-trigger')])

    def test_repository_workflows_are_clean(self):
        self.assertEqual(check_workflows.main([]), 0)


if __name__ == '__main__':
    unittest.main()
