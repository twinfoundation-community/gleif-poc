# @gleif/verifier-node

Node.js utilities for GLEIF vLEI verification with IOTA DID integration.

Extends `@gleif/verifier-core` with IOTA Identity operations.

## Installation

```bash
npm install @gleif/verifier-node
```

### Peer Dependencies

This package requires:
- `@iota/identity-wasm` ^1.7.0
- `@twin.org/core`
- `@twin.org/dlt-iota`
- `@twin.org/vault-models`
- `signify-ts` >=0.2.0

## Exports

Re-exports everything from `@gleif/verifier-core`, plus:

### IOTA alsoKnownAs Operations

```typescript
import { setAlsoKnownAs } from '@gleif/verifier-node';

// set alsoKnownAs on an IOTA DID document
// establishes bidirectional DID linkage (W3C DID Core compliant)
await setAlsoKnownAs(
  'did:iota:testnet:0x123...',           // IOTA DID to update
  ['did:webs:example.com:keri:ABC123'],  // Aliases to add
  vaultConnector,                         // Vault for key management
  'my-identity',                          // Controller identity name
  { iotaNodeUrl: 'https://api.testnet.iota.cafe', network: 'testnet' }
);
```

### KEL Publisher

```typescript
import { KelPublisher } from '@gleif/verifier-node';

// Publishes did.json and keri.cesr for did:webs resolution
const publisher = new KelPublisher(
  { keriaHttpUrl: 'http://localhost:3902' },          // KelPublisherConfig
  (aid) => getSignifyClient(aid),                      // callback to get SignifyClient per AID
);
```

### DID Linking Verifier

```typescript
import { DidLinkingVerifier } from '@gleif/verifier-node';
import type { DidLinkingVerificationResult } from '@gleif/verifier-node';

// Orchestrates bidirectional DID linkage verification
// deps: resolveDidWebs, getDidDocument, resolveIotaDid, extractWebsDid, verifyLeCredential
const verifier = new DidLinkingVerifier(deps, { kelPublisherDomain: 'localhost' });
const result: DidLinkingVerificationResult = await verifier.verify('did:webs:example.com:keri:ABC123');
```

## Configuration

### IotaAlsoKnownAsConfig

```typescript
interface IotaAlsoKnownAsConfig {
  iotaNodeUrl: string;  // e.g., 'https://api.testnet.iota.cafe'
  network: string;      // e.g., 'testnet' or 'mainnet'
}
```

## Bidirectional DID Linkage

This package handles bidirectional linkage between KERI-based `did:webs` and IOTA-based `did:iota`:

```
did:webs:example.com:keri:ABC123
  └─ alsoKnownAs: ["did:iota:testnet:0x..."]

did:iota:testnet:0x...
  └─ alsoKnownAs: ["did:webs:example.com:keri:ABC123"]
```

Both DIDs reference each other, so you can verify from either direction.
