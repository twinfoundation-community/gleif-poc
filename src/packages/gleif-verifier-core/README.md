# @gleif/verifier-core

Core utilities for GLEIF vLEI verification -- platform-agnostic, zero dependencies.

## Installation

```bash
npm install @gleif/verifier-core
```

## Exports

### Types (`@gleif/verifier-core/types`)

- `VerificationResult` - result from vLEI credential verification
- `PublicTrustChainConfig` - public trust chain config (no secrets)
- `DIDDocument` - W3C DID document
- `DidLinkageResult` - bidirectional DID linkage verification result
- `NftAttestation` - NFT attestation metadata
- `JWK` - JSON Web Key
- `KeriKeyState` - KERI key state
- `KeriCredential` - KERI credential
- `KeriOperation` - KERI operation result

### Utilities (`@gleif/verifier-core/utils`)

```typescript
import { isoTimestamp, keriTimestamp, formatTimestamp, getErrorMessage } from '@gleif/verifier-core/utils';

// ISO timestamp for general use
isoTimestamp(); // "2025-01-15T10:30:00.000Z"

// KERI-formatted timestamp
keriTimestamp(); // "2025-01-15T10:30:00.000000+00:00"

// Human-readable format
formatTimestamp("2025-01-15T10:30:00.000Z"); // "Jan 15, 2025, 10:30:00 AM"

// Safe error message extraction
getErrorMessage(error); // Works with Error, string, or unknown

// Base64url encoding/decoding
import { base64urlToBytes, bytesToBase64url } from '@gleif/verifier-core/utils';
const bytes = base64urlToBytes(encoded);
const encoded = bytesToBase64url(bytes);
```

### DID Utilities (`@gleif/verifier-core/did`)

```typescript
import {
  extractIotaDid, extractWebsDid, keriKeyToJwk,
  extractKeriServiceEndpoint, extractAidFromDidWebs, DidWebsResolver,
} from '@gleif/verifier-core/did';

// Extract did:iota from DID document alsoKnownAs
const iotaDid = extractIotaDid(didDocument); // "did:iota:testnet:0x..."

// Extract did:webs from DID document
const websDid = extractWebsDid(didDocument); // "did:webs:example.com:keri:ABC123"

// Convert KERI public key to JWK format
const jwk = keriKeyToJwk(keriPublicKey); // { kty: "OKP", crv: "Ed25519", x: "..." }

// Extract KERI service endpoint from DID document
const endpoint = extractKeriServiceEndpoint(didDocument);

// Extract AID from a did:webs identifier
const aid = extractAidFromDidWebs('did:webs:example.com:keri:ABC123'); // "ABC123"

// Resolve did:webs via dkr service
const resolver = new DidWebsResolver({ resolverUrl: 'http://localhost:7677' });
const didDoc = await resolver.resolve('did:webs:example.com:keri:ABC123');
```

### VC Sign & Verify (`@gleif/verifier-core/vc`)

```typescript
import {
  buildLinkageVcPayload, buildVcJwtHeader, encodeVcAsJwt, assembleSignedJwt,
  decodeVcJwt, verifyVcSignature, isVcExpired,
  type LinkageVcPayload, type VcJwtHeader,
} from '@gleif/verifier-core/vc';

// Build a DID linkage attestation VC
const payload = buildLinkageVcPayload(
  'did:webs:example.com:keri:ABC123',  // issuer (LE's did:webs)
  'did:iota:testnet:0x...',            // subject (LE's did:iota)
  '529900T8BM49AURSDO55',              // LEI
  'EH-UW7QcQEgBPeBSyYrq...'           // Designated Aliases credential SAID
);

// Prepare unsigned JWT for edge signing
const header = buildVcJwtHeader('did:webs:example.com:keri:ABC123#key1');
const unsignedJwt = encodeVcAsJwt(header, payload);

// After signing with LE's KERI Ed25519 key:
const signedJwt = assembleSignedJwt(unsignedJwt, signatureBytes);

// Verify (client-side, no KERI infrastructure needed)
const decoded = decodeVcJwt(signedJwt);
const valid = await verifyVcSignature(signedJwt, publicKeyBytes);
const expired = isVcExpired(signedJwt);
```

### Verification (`@gleif/verifier-core/verification`)

```typescript
import { VerificationStateManager } from '@gleif/verifier-core/verification';

// Manage async verification state (for webhook-based verification)
const stateManager = new VerificationStateManager({ timeoutMs: 30000 });

// Register pending verification (returns promise)
const resultPromise = stateManager.registerPendingVerification(credentialSaid, leAid, leLei);

// Later, when webhook is received:
stateManager.resolveVerification(credentialSaid, verified, revoked);

// The promise resolves with the verification result
const result = await resultPromise;

// Debug: check pending verifications
const pending = stateManager.getPendingSaids(); // ["SAID1", "SAID2", ...]
```

## Usage

```typescript
import type { VerificationResult, DIDDocument } from '@gleif/verifier-core';
import { extractIotaDid, isoTimestamp } from '@gleif/verifier-core';

// Extract linked IOTA DID from a did:webs document
const didDoc: DIDDocument = await resolveDidWebs('did:webs:example.com:keri:ABC123');
const linkedIotaDid = extractIotaDid(didDoc);

if (linkedIotaDid) {
  console.log(`Found linked IOTA DID: ${linkedIotaDid}`);
}
```
