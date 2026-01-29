#!/usr/bin/env bash
# stop local vLEI stack

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
QVI_DIR="$PROJECT_ROOT/qvi-software/qvi-workflow/keria_docker"

cd "$QVI_DIR"

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
    DOCKER_CMD="podman"
    COMPOSE_CMD="podman compose"
fi

echo "stopping local vLEI stack..."
$COMPOSE_CMD -f docker-compose-keria_signify_qvi.yaml down

# stop did-webs-resolver
echo "stopping did-webs-resolver..."
$DOCKER_CMD rm -f did-webs-resolver 2>/dev/null || true

# stop backend
echo "stopping backend..."
cd "$SCRIPT_DIR"
if [[ -f "docker-compose.backend.yaml" ]]; then
    $COMPOSE_CMD -f docker-compose.backend.yaml down 2>/dev/null || true
fi
$DOCKER_CMD rm -f vlei-backend 2>/dev/null || true

echo "done."
