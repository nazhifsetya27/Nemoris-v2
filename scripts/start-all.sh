#!/usr/bin/env bash
# Start all Nemoris services via Docker Compose
set -e
cd "$(dirname "$0")/.."
docker compose -f docker/docker-compose.yml --profile all up -d
echo ""
echo "Services started. Run 'npm run proxy' in another terminal for LLM (OpenCode)."
echo "WAHA dashboard: http://localhost:4130"
echo "Backend health: http://localhost:3001/health"
