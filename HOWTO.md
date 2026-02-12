# GLEIF-TWIN vLEI Linkage PoC - HOWTO

Everything you need to get this running, step by step. For architecture and API reference, see [README.md](README.md). For concepts and terminology, see [REFERENCE.md](REFERENCE.md).

## Prerequisites

- Docker (with compose plugin)
- Node.js 20+
- npm 10+
- `jq` (used by startup scripts)

First run pulls several container images (`gleif/keri`, `gleif/keria`, `gleif/sally`, `gleif/vlei`, `gleif/did-webs-resolver-service`, `node:20-alpine`) -- expect a few minutes on the initial pull depending on your connection.

## 0. Clone & Install

The infrastructure compose files live in a git submodule. This must be initialized before anything else:

```bash
git submodule init && git submodule update
```

Then install the workspace dependencies (the frontend and backend share packages via npm workspaces):

```bash
npm install
```

## 1. Start Infrastructure

```bash
cd local-stack
./start.sh --with-backend
```

This starts KERIA, Sally, did-webs-resolver, 4 witnesses, vLEI schema server, and the PoC backend. See [README.md](README.md#local-service-ports) for the full port listing.

Give it ~30s for all services to come up healthy.

## 2. Setup Trust Anchors & DID Linkage

**Important:** The backend must be running (`--with-backend` flag) to enable automatic IOTA DID creation.

```bash
cd scripts
npm install
npm run setup-trust-anchors
```

> This is a standalone package (not part of the npm workspace), so it needs its own `npm install`.

This sets up the complete trust chain and bidirectional DID linkage in one shot:

**Trust Chain:**
- GLEIF Root AID (simulated trust root)
- QVI AID (Qualified vLEI Issuer)
- Legal Entity AID (test LE)
- QVI Credential (GLEIF → QVI)
- LE Credential (QVI → LE)

**DID Linkage (created automatically):**
- **IOTA DID** for the LE - real on-chain DID via `@twin.org/identity-connector-iota`
  - Format: `did:iota:testnet:{objectId}` (objectId assigned by network)
  - Viewable on IOTA Explorer
- **Designated Aliases Credential** (LE self-issues, links did:webs → did:iota)
- **Reverse link** on IOTA DID (alsoKnownAs → did:webs)

**Sally Configuration:**
- GLEIF OOBI resolved (trust anchor)
- QVI credential pre-loaded (chain verification)

Output saved to `scripts/.trust-anchors.json`.

**After setup, restart the stack** -- Sally needs a fresh start to pick up the correct GLEIF AID:

```bash
cd local-stack
./stop.sh && ./start.sh --with-backend
```

## 3. Start Frontend

```bash
# from the project root
npm run dev:frontend
```

This builds the workspace packages (`@gleif/verifier-core`, `@gleif/verifier-node`) and starts the Vite dev server.

Opens at http://localhost:5173. If that port's taken, Vite auto-increments -- check the terminal output for the actual URL. The frontend talks to the backend at `http://localhost:3000`.

## 4. Verify Two-Way Linkage

### Option A: Via Frontend UI

1. Open the URL shown by `npm run dev` (default: http://localhost:5173)
2. **Trust Chain Panel**: Shows configured GLEIF → QVI → LE chain
3. **Verify LE Credential**: Click "Verify" - submits credential to Sally
4. **Mint NFT**: After verification succeeds, click "Mint NFT Attestation"
5. **DID Linkage Panel**: Use the quick-select buttons to test both directions:
   - **"did:webs (Direction 1)"**: Verifies did:webs → did:iota linkage
   - **"did:iota (Direction 2)"**: Verifies did:iota → did:webs linkage
   - Both should show "Linked & Verified" with "Bidirectional" badge

### Option B: Via API

```bash
# Get trust chain config (includes linked DIDs)
curl http://localhost:3000/api/config | jq .

# Verify LE credential via Sally
curl -X POST http://localhost:3000/api/verify | jq .

# Mint attestation (requires verification first)
curl -X POST http://localhost:3000/api/nft/mint \
  -H "Content-Type: application/json" -d '{}' | jq .

# Direction 1: Verify did:webs → did:iota
curl -X POST http://localhost:3000/api/verify-did-linking \
  -H "Content-Type: application/json" \
  -d '{"didWebs":"did:webs:backend:keri:<LE_AID>"}'

# Direction 2: Verify did:iota → did:webs
# Format: did:iota:testnet:{objectId} (URL-encode colons as %3A)
curl "http://localhost:3000/api/verify-linkage/from-iota/did%3Aiota%3Atestnet%3A<OBJECT_ID>"

# Resolve IOTA DID document
curl "http://localhost:3000/api/iota/resolve/did%3Aiota%3Atestnet%3A<OBJECT_ID>"

# Create a new IOTA DID (publishes to IOTA testnet)
curl -X POST http://localhost:3000/api/iota/create-did \
  -H "Content-Type: application/json" -d '{}'
```

## 5. Stop Everything

```bash
cd local-stack
./stop.sh
```

## Attestation Minting Setup

A default `NFT_MNEMONIC` is already configured in `local-stack/.env`. If you'd rather use your own mnemonic, replace the value in `.env` first.

### 1. (Optional) Generate Your Own Mnemonic

Skip this if you're fine with the default mnemonic in `.env`.

```bash
cd src/app/backend
node -e "const bip39 = require('@scure/bip39'); const { wordlist } = require('@scure/bip39/wordlists/english'); console.log(bip39.generateMnemonic(wordlist, 256));"
```

Then replace `NFT_MNEMONIC` in `local-stack/.env` with the output and restart the backend:

```bash
cd local-stack
./stop.sh && ./start.sh --with-backend
```

### 2. Get Wallet Address

```bash
docker logs vlei-backend 2>&1 | grep "Wallet address"
```

### 3. Fund via Faucet

```bash
curl --location --request POST 'https://faucet.testnet.iota.cafe/v1/gas' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "FixedAmountRequest": {
      "recipient": "<WALLET_ADDRESS>"
    }
  }'
```

Once funded, attestation minting in the UI creates real on-chain `VleiAttestation` objects -- viewable at https://explorer.iota.org/?network=testnet

## Reset

To nuke everything and start fresh -- containers, volumes, generated config:

```bash
# Stop everything
cd local-stack
./stop.sh

# Remove volumes (KERIA state, resolver data)
docker volume rm resolver-data 2>/dev/null
docker volume ls | grep keria | awk '{print $2}' | xargs -r docker volume rm

# Remove trust anchors config
rm -f scripts/.trust-anchors.json

# Remove network (optional)
docker network rm vlei 2>/dev/null
```

Then start over from Step 1.

## Troubleshooting

**Sally verification timeout:** Usually means Sally doesn't have the correct GLEIF AID. Restart the stack after running setup-trust-anchors: `./stop.sh && ./start.sh --with-backend`

**Backend not receiving webhooks:** Check that the backend is on the `vlei` network. Restart with `./start.sh --with-backend`.

**Trust anchors missing:** Just re-run `npm run setup-trust-anchors` in `scripts/`.

**setup-trust-anchors fails with "EISDIR" error:** Docker sometimes creates `.trust-anchors.json` as a directory instead of a file. Fix it and re-run:
```bash
rm -rf scripts/.trust-anchors.json
echo '{}' > scripts/.trust-anchors.json
# Then re-run setup-trust-anchors
```

**Attestation minting not working:** Set `NFT_MNEMONIC` in `local-stack/.env` and restart the backend. Look for "Attestation Minting: enabled" in the logs. Make sure the wallet is funded via the faucet.

**Direction 2 shows "No did:webs found":** The reverse link didn't get added. Re-run setup-trust-anchors with the backend running, then restart the stack.

**DID not found on IOTA Explorer:** If the backend wasn't running during `setup-trust-anchors`, the script falls back to a placeholder DID that doesn't actually exist on-chain. Re-run `setup-trust-anchors` with `--with-backend` active to create a real on-chain DID.
