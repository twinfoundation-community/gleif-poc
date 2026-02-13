# GLEIF-TWIN vLEI Linkage Verifier

Proof-of-concept that links GLEIF's vLEI credentials (`did:webs`) to TWIN ID on IOTA (`did:iota`) -- bidirectional, cryptographically verifiable, with optional on-chain NFT attestation.

For concepts and terminology, see [REFERENCE.md](REFERENCE.md). For setup instructions, see [HOWTO.md](HOWTO.md).

## Background

GLEIF runs the global LEI system for identifying legal entities. The **vLEI** (verifiable LEI) extends that into the digital domain using KERI-based ACDC credentials, establishing a trust chain:

```
GLEIF Root AID           (root of trust)
  └─ QVI Credential      (Qualified vLEI Issuer, accredited by GLEIF)
      └─ LE Credential    (Legal Entity, issued by QVI, contains LEI)
          └─ Designated Aliases   (self-issued, links did:webs ↔ did:iota)
```

The idea is simple: take a Legal Entity's vLEI credential, verify it via the full trust chain, and then **bidirectionally link** it to an IOTA DID -- both DID documents referencing each other through the W3C `alsoKnownAs` property. Anyone with the right software can independently verify the linkage. Optionally, an NFT attestation on IOTA serves as a convenient public record.

### What this covers

- **Full vLEI trust chain** -- GLEIF -> QVI -> LE credential issuance via IPEX protocol
- **Sally-based verification** -- browser presents credential to Sally via IPEX (signify-ts runs in-browser), Sally walks the chain and returns results via webhook
- **Bidirectional DID linking** -- `did:webs` document includes `alsoKnownAs: [did:iota:...]` and vice versa
- **Designated Aliases credential** -- self-issued ACDC linking the LE's KERI identifier to their IOTA DID; cryptographically verified via dws resolver (CESR stream verification)
- **LE-signed on-chain attestation** -- custom Move object (`VleiAttestation`) minted on IOTA testnet, containing a W3C VC JWT signed by the LE's KERI key -- independently verifiable via WebCrypto without KERI infrastructure
- **KEL publishing** -- backend serves `did.json` and `keri.cesr` for `did:webs` resolution

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React + Vite + signify-ts)                   │
│  - Credential presentation to Sally (IPEX via KERIA)    │
│  - DID linkage verification (both directions)           │
│  - View results, mint NFTs                              │
└──────────┬───────────────────┬──────────────────────────┘
           │ signify-ts        │ HTTP
     ┌─────▼─────┐   ┌────────▼─────────────────────────────┐
     │ KERIA     │   │  Backend (Express)                    │
     │ Agent     │   │  - Sally webhook receiver              │
     │    │ IPEX │   │  - KEL publisher (did:webs resolution) │
     │ ┌──▼───┐  │   │  - IOTA DID + attestation minting     │
     │ │Sally │  │   └────────────┬──────────────────────────┘
     │ │Verif.│──┼── webhook ──►  │
     │ └──────┘  │          ┌─────▼─────┐
     └───────────┘          │ IOTA      │
                            │ Testnet   │
                            └───────────┘
```

### Monorepo Structure

```
src/
  packages/
    gleif-verifier-core/   # Zero-dependency, platform-agnostic types, utilities, and VC sign/verify
    gleif-verifier-node/   # Node.js extensions for IOTA DID operations
  app/
    backend/               # Express server with KERIA, Sally, IOTA integration
    frontend/              # React UI for verification and attestation
scripts/
  setup-trust-anchors.ts # Automated trust chain + DID linkage setup
  test-keria.ts          # Infrastructure connectivity validation
local-stack/
  docker-compose.backend.yaml
  start.sh / stop.sh     # Orchestrate KERIA, Sally, witnesses, resolver
  schemas/               # Designated Aliases schema (custom)
```

### Shared Libraries

- **`@gleif/verifier-core`** -- Types, VC signing/verification (Ed25519 via WebCrypto), DID utilities, `did:webs` resolution, verification state management. Works in browser and Node.js.
- **`@gleif/verifier-node`** -- Node.js extensions. KEL publishing, DID linking verifier, IOTA DID operations.

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/api/config` | GET | Public trust chain configuration |
| `/api/poc-config` | GET | PoC config for browser-side signify-ts (KERIA URLs, LE passcode) |
| `/api/status` | GET | System status (Sally, config) |
| `/api/verification-status/:said` | GET | Poll for Sally verification result (browser flow) |
| `/api/verify-did-linking` | POST | Bidirectional DID linkage verification |
| `/api/verify-linkage/from-iota/:did` | GET | Reverse linkage (did:iota → did:webs) |
| `/api/resolve-did/:did` | GET | Resolve did:webs or did:iota |
| `/api/iota/create-did` | POST | Create IOTA DID on-chain |
| `/api/iota/add-also-known-as` | POST | Set alsoKnownAs on IOTA DID |
| `/api/iota/add-service` | POST | Add service endpoint to IOTA DID |
| `/api/iota/resolve/:did` | GET | Resolve an IOTA DID document |
| `/api/nft/mint` | POST | Mint vLEI linkage attestation |
| `/keri/aids` | GET | List available AIDs from trust anchors |
| `/keri/:aid/did.json` | GET | did:webs DID document |
| `/keri/:aid/keri.cesr` | GET | KERI event log (CESR) |
| `/api/webhook/sally` | POST | Sally verification callback |

## Local Service Ports

| Service | URL | Notes |
|---------|-----|-------|
| Schema Server | `http://localhost:7723` | `/health`, `/oobi/{SAID}` |
| KERIA API | `http://localhost:3901` | signify-ts client endpoint |
| KERIA Boot | `http://localhost:3903` | Agent provisioning |
| Sally | `http://localhost:9823` | No witnesses needed |
| Webhook | `http://localhost:9923` | Demo webhook receiver |
| Witnesses | `http://localhost:5642-5645` | 4 local witnesses |

## vLEI Schema SAIDs

| Credential Type | Schema SAID |
|-----------------|-------------|
| QVI Credential | `EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao` |
| Legal Entity Credential | `ENPXp1vQzRF6JwIuS-mp2U8Uf1MoADoP_GqQ62VsDZWY` |
| Designated Aliases | `EN6Oh5XSD5_q2Hgu-aqpdfbVepdpYpFlgz6zvJL5b_r5` |

## GLEIF Testnet Infrastructure

GLEIF's public testnet -- no registration required.

| Service | URL | Status |
|---------|-----|--------|
| KERIA API | `https://keria.testnet.gleif.org:3901` | OK (401 without auth) |
| KERIA Boot | `https://keria.testnet.gleif.org:3903` | OK (POST only) |
| Schema Server | `https://schema.testnet.gleif.org:7723` | OK |
| Witnesses 1-5 | `https://wit{1-5}.testnet.gleif.org:564{1-5}` | OK |
| Sally (testnet) | `https://presentation-handler.testnet.gleif.org:9723` | DOWN |

**Note**: Testnet Sally is currently down -- the local stack includes its own Sally instance as a workaround.

## Related Resources

- [GLEIF-IT/qvi-software](https://github.com/GLEIF-IT/qvi-software) - QVI workflow samples
- [WebOfTrust/signify-ts](https://github.com/WebOfTrust/signify-ts) - TypeScript KERI client
- [GLEIF-IT/vlei-trainings](https://github.com/GLEIF-IT/vlei-trainings) - vLEI training notebooks

Credit: This POC builds on the insights provided by Albert in the [POCv1](https://github.com/twinfoundation-community/gleif-poc).
