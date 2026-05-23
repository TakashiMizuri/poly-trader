#!/usr/bin/env bash
# Build and (re)start Poly Trader containers on the VPS.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy from template: cp .env.example .env"
  exit 1
fi

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

mkdir -p logs

echo "Building and starting containers..."
"${COMPOSE[@]}" up -d --build --remove-orphans

echo ""
echo "Status:"
"${COMPOSE[@]}" ps

echo ""
echo "Recent API logs:"
"${COMPOSE[@]}" logs --tail=30 api

echo ""
echo "UI (local on server): http://127.0.0.1:8081"
echo "Health: curl -sf http://127.0.0.1:8081/health"
