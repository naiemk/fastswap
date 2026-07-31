#!/usr/bin/env bash
# Back-compat wrapper — prefer scripts/testnet-mirror-bootstrap.sh (see docs/TESTNET_MIRROR.md).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/scripts/testnet-mirror-bootstrap.sh" "$@"
