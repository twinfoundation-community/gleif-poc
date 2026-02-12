#!/usr/bin/env bash
# start local vLEI stack for dev/testing
# uses qvi-software's docker-compose config
#
# usage: ./start.sh [--with-backend]
#   --with-backend: also starts the backend and routes Sally webhooks to it

set -e

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

# parse args
WITH_BACKEND=false
for arg in "$@"; do
    case $arg in
        --with-backend)
            WITH_BACKEND=true
            shift
            ;;
        *)
            ;;
    esac
done

cd "$QVI_DIR"

echo "Using: $DOCKER_CMD / $COMPOSE_CMD"

# create vlei network if missing -- podman syntax differs from docker
if [[ "$DOCKER_CMD" == "podman" ]]; then
    $DOCKER_CMD network exists vlei 2>/dev/null || $DOCKER_CMD network create vlei
else
    $DOCKER_CMD network inspect vlei >/dev/null 2>&1 || $DOCKER_CMD network create vlei
fi

# export env vars
# webhook target depends on whether backend is running
if [[ "$WITH_BACKEND" == "true" ]]; then
    # backend runs on port 80 internally for did:webs resolution
    export WEBHOOK_HOST=http://backend/api/webhook/sally
    echo "backend mode: sally webhooks -> backend service"
else
    export WEBHOOK_HOST=http://hook:9923
fi

export INDIRECT_SALLY_KS_NAME=sally-indirect
export INDIRECT_SALLY_ALIAS=sally-indirect
export INDIRECT_SALLY_PASSCODE=VVmRdBTe5YCyLMmYRqTAi
export INDIRECT_SALLY_SALT=0AD45YWdzWSwNREuAoitH_CC
export INDIRECT_SALLY_PRE=EJeORQY7Qbo_iJyE9OrM-Py0m-qjMQCLSmz2ztJDtifZ
export DIRECT_SALLY_KS_NAME=direct-sally
export DIRECT_SALLY_ALIAS=direct-sally
export DIRECT_SALLY_PASSCODE=4TBjjhmKu9oeDp49J7Xdy
export DIRECT_SALLY_SALT=0ABVqAtad0CBkhDhCEPd514T
export DIRECT_SALLY_PRE=ECLwKe5b33BaV20x7HZWYi_KUXgY91S41fRL2uCaf4WQ

# read GLEIF AID from trust anchors if it exists
TRUST_ANCHORS_FILE="$PROJECT_ROOT/scripts/.trust-anchors.json"
if [[ -f "$TRUST_ANCHORS_FILE" ]] && [[ -s "$TRUST_ANCHORS_FILE" ]] && jq -e '.gleif.aid' "$TRUST_ANCHORS_FILE" >/dev/null 2>&1; then
    GEDA_PRE=$(jq -r '.gleif.aid' "$TRUST_ANCHORS_FILE")
    export GEDA_PRE
    echo "using GLEIF AID from trust anchors: $GEDA_PRE"
else
    export GEDA_PRE=PLACEHOLDER_GEDA_PRE
    echo "warning: trust anchors not found; using placeholder GEDA_PRE"
fi

echo "starting local vLEI stack..."
echo "  - vLEI Server (schema): localhost:7723"
echo "  - KERIA: localhost:3901 (API), :3902 (HTTP), :3903 (Boot)"
echo "  - Sally (indirect): localhost:9723"
echo "  - Sally (direct): localhost:9823"
echo "  - Webhook: localhost:9923"
echo "  - Witnesses: localhost:5642-5645"
if [[ "$WITH_BACKEND" == "true" ]]; then
    echo "  - Backend: localhost:3000"
fi
echo ""

# start core services -- skip qvi-tools since it needs tsx
$COMPOSE_CMD -f docker-compose-keria_signify_qvi.yaml -f "$NAMES_OVERRIDE" up -d \
    vlei-server \
    gar-witnesses \
    qar-witnesses \
    person-witnesses \
    sally-witnesses \
    keria1 \
    hook \
    direct-sally \
    sally

echo ""
echo "waiting for services to come up..."
sleep 5

# copy extra schemas into vLEI server (e.g. designated aliases)
# vLEI server caches schemas at startup, so it needs a restart after copying
if [[ -d "$SCRIPT_DIR/schemas" ]] && ls "$SCRIPT_DIR/schemas"/*.json 1>/dev/null 2>&1; then
    echo "copying extra schemas to vLEI server..."
    for schema in "$SCRIPT_DIR/schemas"/*.json; do
        if [[ -f "$schema" ]]; then
            $DOCKER_CMD cp "$schema" vlei-server:/vLEI/schema/
            echo "  Copied: $(basename "$schema")"
        fi
    done
    echo "restarting vLEI server to pick up new schemas..."
    $DOCKER_CMD restart vlei-server
    sleep 3
fi

$COMPOSE_CMD -f docker-compose-keria_signify_qvi.yaml -f "$NAMES_OVERRIDE" ps

echo ""

# start did-webs-resolver
# canonical upstream: https://github.com/GLEIF-IT/did-webs-resolver
# uses GLEIF-IT's official image: gleif/did-webs-resolver-service
echo "starting did-webs-resolver..."
DID_WEBS_RESOLVER_CONTAINER="did-webs-resolver"
RESOLVER_KEYSTORE_NAME="dws"

# remove existing container if present
$DOCKER_CMD rm -f $DID_WEBS_RESOLVER_CONTAINER 2>/dev/null || true

# create resolver data volume if it doesn't exist
$DOCKER_CMD volume create resolver-data 2>/dev/null || true

# init resolver keystore if it doesn't exist
# dws needs an initialized KERI keystore to work
# mount at /usr/local/var/keri -- that's where kli stores keystores by default
echo "  checking resolver keystore..."
KEYSTORE_CHECK=$($DOCKER_CMD run --rm \
    -v resolver-data:/usr/local/var/keri \
    --entrypoint /dws/.venv/bin/kli \
    gleif/did-webs-resolver-service:0.3.3 \
    status --name $RESOLVER_KEYSTORE_NAME 2>&1 || true)

if [[ "$KEYSTORE_CHECK" =~ "Keystore must already exist" ]]; then
    echo "  initializing resolver keystore..."
    $DOCKER_CMD run --rm \
        -v resolver-data:/usr/local/var/keri \
        --entrypoint /dws/.venv/bin/kli \
        gleif/did-webs-resolver-service:0.3.3 \
        init --name $RESOLVER_KEYSTORE_NAME --nopasscode
    echo "  keystore initialized."
else
    echo "  keystore already exists."
fi

# start did-webs-resolver container
$DOCKER_CMD run -d \
    --name $DID_WEBS_RESOLVER_CONTAINER \
    --network vlei \
    -p 7677:7677 \
    -v resolver-data:/usr/local/var/keri \
    --entrypoint /dws/.venv/bin/dws \
    gleif/did-webs-resolver-service:0.3.3 \
    did webs resolver-service --name dws --http 7677 --loglevel INFO

echo "  - did-webs-resolver: localhost:7677"
echo ""

# start backend if requested
if [[ "$WITH_BACKEND" == "true" ]]; then
    echo "starting backend service..."
    cd "$SCRIPT_DIR"

    # create placeholder trust anchors if missing (needed for volume mount)
    # also handle the case where podman created a directory instead of a file
    TRUST_ANCHORS_PATH="$PROJECT_ROOT/scripts/.trust-anchors.json"
    if [[ -d "$TRUST_ANCHORS_PATH" ]]; then
        echo "removing stale trust anchors directory..."
        rm -rf "$TRUST_ANCHORS_PATH"
    fi
    if [[ ! -f "$TRUST_ANCHORS_PATH" ]]; then
        echo "creating placeholder trust anchors config..."
        echo '{}' > "$TRUST_ANCHORS_PATH"
        echo "note: run setup-trust-anchors after services are up to configure the trust chain"
    fi

    $COMPOSE_CMD -f docker-compose.backend.yaml up -d --build

    echo ""
    echo "waiting for backend to start..."
    sleep 5

    $COMPOSE_CMD -f docker-compose.backend.yaml ps
    echo ""
fi

cd "$QVI_DIR"
echo "To check service status: cd $QVI_DIR && $COMPOSE_CMD -f docker-compose-keria_signify_qvi.yaml -f $NAMES_OVERRIDE ps"
echo "To view resolver logs: $DOCKER_CMD logs -f $DID_WEBS_RESOLVER_CONTAINER"
echo "To view compose logs: cd $QVI_DIR && $COMPOSE_CMD -f docker-compose-keria_signify_qvi.yaml logs -f [service]"
if [[ "$WITH_BACKEND" == "true" ]]; then
    echo "To view backend logs: cd $SCRIPT_DIR && $COMPOSE_CMD -f docker-compose.backend.yaml logs -f"
fi
echo "To stop: $SCRIPT_DIR/stop.sh"
