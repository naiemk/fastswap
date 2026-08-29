#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGER="$(node -e "console.log(require('path').dirname(require.resolve('vibed-infra/package.json')))")"
exec bash "$PACKAGER/package.sh" --product "$ROOT" --out "$ROOT/deploy/dist" --packager "$PACKAGER"
