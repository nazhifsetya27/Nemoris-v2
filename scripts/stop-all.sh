#!/usr/bin/env bash
# Stop all Nemoris services
set -e
cd "$(dirname "$0")/.."
docker compose -f docker/docker-compose.yml --profile all down
echo "All services stopped."
