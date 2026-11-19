#!/usr/bin/env bash
# Local synthetic fixtures only. Never runs a playbook against an inventory.
set -euo pipefail
if [ "$(id -u)" != 0 ]; then
  printf '%s\n' 'Run this test suite as local root: some filesystem guards require root-owned synthetic fixtures.' >&2
  exit 2
fi
test_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../tests" && pwd)"
cd -- "${test_directory}/.."
# Several runtime tools intentionally disable bytecode in their process. Keep
# each test module in its own interpreter, including the bytecode regression.
unset PYTHONDONTWRITEBYTECODE PYTHONPYCACHEPREFIX
for test_module in "${test_directory}"/test_*.py; do
  python -m unittest discover -s "${test_directory}" -p "$(basename -- "${test_module}")" -v
done
