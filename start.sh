#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${DP_PYTHON:-python3}"
command -v "$PYTHON" >/dev/null 2>&1 || { echo "Python 3.11+ is required; set DP_PYTHON." >&2; exit 2; }
if command -v cygpath >/dev/null 2>&1; then ROOT="$(cygpath -m "$ROOT")"; fi
exec "$PYTHON" "$ROOT/scripts/launcher.py" "$@"
