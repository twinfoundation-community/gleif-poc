#!/usr/bin/env bash
# shared setup for start.sh / stop.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
QVI_DIR="$PROJECT_ROOT/qvi-software/qvi-workflow/keria_docker"
NAMES_OVERRIDE="$SCRIPT_DIR/docker-compose.names.yaml"

# prefer docker; fall back to podman
if command -v docker &>/dev/null; then
    DOCKER_CMD="docker"
    COMPOSE_CMD="docker compose"
elif command -v podman &>/dev/null; then
    DOCKER_CMD="podman"
    if command -v podman-compose &>/dev/null; then
        COMPOSE_CMD="podman-compose"
    else
        COMPOSE_CMD="podman compose"
    fi
else
    echo "error: neither docker nor podman found"
    exit 1
fi
