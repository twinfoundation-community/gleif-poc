#!/usr/bin/env bash
# stop local vLEI stack

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

cd "$QVI_DIR"

echo "stopping local vLEI stack..."
$COMPOSE_CMD -f docker-compose-keria_signify_qvi.yaml -f "$NAMES_OVERRIDE" down

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
