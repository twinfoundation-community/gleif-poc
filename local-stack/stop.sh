#!/usr/bin/env bash
# stop local vLEI stack

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

cd "$QVI_DIR"

echo "stopping local vLEI stack..."
# only stop the services we actually start (the upstream yaml defines extras we don't use)
$COMPOSE_CMD -f docker-compose-keria_signify_qvi.yaml -f "$NAMES_OVERRIDE" rm -sf \
    vlei-server gar-witnesses qar-witnesses person-witnesses keria1 hook direct-sally 2>/dev/null || true
$COMPOSE_CMD -f docker-compose-keria_signify_qvi.yaml -f "$NAMES_OVERRIDE" down 2>/dev/null || true

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
