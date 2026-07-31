#!/usr/bin/env bash
# Prod-mirror testnet bootstrap: Base Sepolia + Arbitrum Sepolia + BSC testnet + TRON Nile.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONFIG="FastSwapConfig.testnet.yaml"
SERVE_ONLY=false
SKIP_SMOKE=false
WITH_LIQMAN=false
READINESS_ONLY=false
E2E_ONLY=false
PREDICT_ONLY=false
WITH_DOCKER=false
NO_SERVE=false

for arg in "$@"; do
  case "$arg" in
    --serve-only) SERVE_ONLY=true ;;
    --skip-smoke|--skip-e2e) SKIP_SMOKE=true ;;
    --liqman) WITH_LIQMAN=true ;;
    --readiness) READINESS_ONLY=true ;;
    --e2e-nodes) E2E_ONLY=true ;;
    --predict-only) PREDICT_ONLY=true ;;
    --docker) WITH_DOCKER=true ;;
    --no-serve) NO_SERVE=true ;;
  esac
done

if [[ ! -f .env ]]; then
  if [[ -f .env.testnet.example ]]; then
    cp .env.testnet.example .env
    echo "Created .env from .env.testnet.example."
    echo ""
    echo "Fill in at minimum:"
    echo "  API_SIGNING_SECRET"
    echo "  EVM_PRIVATE_KEY"
    echo "  TRON_PRIVATE_KEY         (optional — defaults to EVM key)"
    echo "  FASTSWAP_PUBLIC_URL"
    echo "  TURNSTILE_SITE_KEY"
    echo "  TURNSTILE_SECRET_KEY"
    echo "  SEPOLIA_RPC_URL"
    echo "  NILE_FULL_HOST"
    echo "  SEPOLIA_ROUTER_ADDRESS"
    echo "  TRON_ROUTER_ADDRESS"
    echo ""
    echo "Then re-run: ./scripts/testnet-mirror-bootstrap.sh"
    exit 1
  fi
  echo "Missing .env — copy .env.testnet.example to .env first."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${EVM_PRIVATE_KEY:-}" ]]; then
  echo "EVM_PRIVATE_KEY is required in .env"
  exit 1
fi

if [[ "$PREDICT_ONLY" == true ]]; then
  exec npm run fastswap:cli -- --config "$CONFIG" --predict
fi

if [[ "$SERVE_ONLY" == true ]]; then
  exec npm run fastswap:testnet:serve
fi

if [[ "$READINESS_ONLY" == true ]]; then
  exec npm run fastswap:testnet -- --step readiness
fi

if [[ "$E2E_ONLY" == true ]]; then
  exec npm run fastswap:testnet -- --step e2e-nodes
fi

LAUNCH_FLAGS=(--step all)
[[ "$SKIP_SMOKE" == true ]] && LAUNCH_FLAGS+=(--skip-smoke)
[[ "$WITH_LIQMAN" == true ]] && LAUNCH_FLAGS+=(--liqman)
[[ "$NO_SERVE" == false ]] && LAUNCH_FLAGS+=(--serve)

echo "FastSwap testnet go-live — Sepolia + TRON Nile"
echo "Config: $CONFIG"
echo "Docs: docs/TESTNET_MIRROR.md (real prices + Turnstile)"
echo ""

if [[ -z "${TURNSTILE_SITE_KEY:-}" || -z "${TURNSTILE_SECRET_KEY:-}" ]]; then
  echo "WARNING: TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY unset — captcha is required for go-live."
fi
if [[ -z "${FASTSWAP_PUBLIC_URL:-}" ]]; then
  echo "WARNING: FASTSWAP_PUBLIC_URL unset — set the public API URL."
fi

npm run fastswap:testnet:launch -- "${LAUNCH_FLAGS[@]}"

if [[ "$WITH_DOCKER" == true ]]; then
  if [[ ! -f docker/compose/.env ]]; then
    cp .env docker/compose/.env
    echo "Copied .env → docker/compose/.env"
  fi
  npm run docker:testnet:up
  echo "Docker testnet stack started (npm run docker:testnet:down to stop)."
fi
