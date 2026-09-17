#!/bin/bash
# Publishes the open-source terminal to Bonsaixbt/narra (remote `origin`) from `master`, which is the private team
# repository (remote `team`) in full. The public branch is master's real history with the private paths filtered
# out, so nothing internal ever appears there — not in the tree, not in old commits. Deterministic: rerunning
# produces the same public history plus the new commits. Run it after pushing master to `team`.
set -e
cd "$(dirname "$0")/.."
PRIVATE_PATHS="docs/product docs/ROADMAP.md docs/STATUS.md docs/ARCHITECTURE.md docs/OSS.md docs/superpowers docs/CONTENT-PLAN.md backtest"
git branch -f public master
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --index-filter "git rm -r -q --cached --ignore-unmatch $PRIVATE_PATHS" --prune-empty -- public
echo "--- private paths still on public:"; git ls-tree -r --name-only public | grep -E "^(docs/product|backtest|docs/superpowers)/|docs/(ROADMAP|STATUS|ARCHITECTURE|OSS|CONTENT-PLAN)\.md" || echo "none"
git push --force-with-lease=master origin public:master 2>&1 | tail -2 || git push -f origin public:master 2>&1 | tail -2
for t in $(git tag); do git tag -f "$t" "$(git log --format=%H -1 "public" --grep="$(git log -1 --format=%s "$t")")" >/dev/null 2>&1 || true; done
git push -f origin --tags 2>&1 | tail -1
rm -rf .git/refs/original
echo "published: $(git log --oneline public -1)"
