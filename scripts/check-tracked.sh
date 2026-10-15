#!/bin/sh
# Fails if clinic data or env files are tracked by git.
#   sh scripts/check-tracked.sh            check every tracked file (CI)
#   sh scripts/check-tracked.sh --staged   check what is about to be committed

if [ "$1" = "--staged" ]; then
  files=$(git diff --cached --name-only --diff-filter=ACMR)
else
  files=$(git ls-files)
fi

# The blank report template is the one spreadsheet allowed in the repo (owner's
# decision, 2026-10-15): it holds only labels, the clinic name and the logo.
bad=$(printf '%s\n' "$files" \
  | grep -Ei '^samples/|\.(xlsx|xlsm|xls|csv)$|(^|/)\.env' \
  | grep -Ev '(^|/)\.env\.example$' \
  | grep -Ev '^src/assets/daily-report-template\.xlsx$')

if [ -n "$bad" ]; then
  echo "Refusing: these files must never be committed (real data or secrets):" >&2
  printf '%s\n' "$bad" | sed 's/^/  /' >&2
  exit 1
fi
