#!/usr/bin/env bash
# Backup SQLite database and logs from Docker volumes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${1:-$ROOT/backups/$STAMP}"
mkdir -p "$BACKUP_DIR"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

echo "Stopping API to flush SQLite WAL..."
"${COMPOSE[@]}" stop api

echo "Exporting data volume..."
DATA_VOL="$(docker volume ls --format '{{.Name}}' | grep '_polytrader-data$' | head -1 || true)"
if [[ -z "$DATA_VOL" ]]; then
  echo "Volume polytrader-data not found. Start the stack once: bash deploy/update.sh"
  exit 1
fi
docker run --rm \
  -v "${DATA_VOL}:/data:ro" \
  -v "$BACKUP_DIR:/backup" \
  alpine sh -c 'cd /data && tar czf /backup/polytrader-data.tar.gz .'

echo "Exporting logs volume..."
LOGS_VOL="$(docker volume ls --format '{{.Name}}' | grep '_polytrader-logs$' | head -1 || true)"
if [[ -n "$LOGS_VOL" ]]; then
  docker run --rm \
    -v "${LOGS_VOL}:/logs:ro" \
    -v "$BACKUP_DIR:/backup" \
    alpine sh -c 'cd /logs && tar czf /backup/polytrader-logs.tar.gz . 2>/dev/null || true'
fi

echo "Starting API..."
"${COMPOSE[@]}" start api

echo "Backup saved to: $BACKUP_DIR"
