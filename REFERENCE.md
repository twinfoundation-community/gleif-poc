# vLEI Linkage Reference

How this PoC works and how trust is established.

## The Problem

No standardized way exists to cryptographically prove "this digital entity is this real-world legal entity." Domain names, certificates, and manual document checks can all be forged, revoked without notice, or go stale.

GLEIF's vLEI system creates a machine-verifiable chain of trust anchored in the LEI system -- the same system regulators and banks already use to identify companies. This PoC extends that trust into IOTA.

## Concepts

### LEI and GLEIF

An **LEI** (Legal Entity Identifier) is a 20-character code that uniquely identifies a legal entity worldwide.

**GLEIF** (Global Legal Entity Identifier Foundation) manages the LEI system. In the vLEI ecosystem, GLEIF acts as the **root of trust** -- the top-level authority from which all credential chains originate.

### vLEI (Verifiable LEI)

A **vLEI** is a digitally signed, machine-verifiable credential that binds an LEI to a cryptographic identifier.

### KERI (Key Event Receipt Infrastructure)

The identity protocol underneath vLEI. Defines rules, not infrastructure.

- **Self-certifying identifiers** -- derived from your own cryptographic keys. No registration authority.
- **Key Event Log (KEL)** -- append-only, hash-chained log of every key operation (creation, rotation).
- **Pre-rotation** -- at creation time, you commit to your *next* keys by publishing their hash. If current keys are stolen, the attacker can't forge a rotation because they don't know the pre-committed next keys.
- **Witnesses** -- independent parties that store KEL copies and sign receipts. Availability and consistency without consensus.

### AID (Autonomic Identifier)

A KERI identifier -- a base64-encoded string derived from your public key(s). Self-governing; no external authority controls it. Example: `EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao`.

### KERIA and Signify

**KERIA** is a multi-tenant cloud agent -- stores encrypted key material, coordinates with witnesses, routes messages.

**Signify** is the client library (TypeScript/Python) that talks to KERIA. **Private keys never leave Signify.** KERIA stores encrypted key material it can't decrypt; all signing happens in the client (**KATE** -- Keys At The Edge).

### ACDC (Authentic Chained Data Container)

The credential format used by vLEI:

- **Signed** by the issuer's KERI key
- **Chained** to a parent credential -- issuer must hold the parent
- **Anchored** to the issuer's KEL (issuance permanently recorded)
- **Schema-bound** via SAID -- content-addressed schema prevents schema-swap attacks

### SAID (Self-Addressing Identifier)

A content hash embedded *within* the content it hashes. Any modification invalidates the SAID. Used everywhere: credential IDs, schema IDs, key events, attribute blocks.

### OOBI (Out-of-Band Introduction)

KERI identifiers are decoupled from DNS/IP, so you need a discovery mechanism. An OOBI is a URL paired with an AID -- "find this identifier's data here."

OOBIs are *not trusted* -- all data obtained via OOBI gets verified cryptographically. Safe to pass over any insecure channel.

### CESR (Composable Event Streaming Representation)

Encoding format for all KERI data. Supports text and binary, convertible without loss. Cryptographic primitives (keys, signatures, digests) carry a derivation code prefix identifying the algorithm.

### Sally

GLEIF's reference verifier. Walks the full trust chain (credential -> issuer -> ... -> GLEIF root), verifying every signature, KEL, and anchor. Uses **IPEX** (Issuance and Presentation Exchange) protocol; returns results via webhook.

### DID (Decentralized Identifier)

W3C standard URI for decentralized identity. This PoC uses two methods:

- **`did:webs`** -- HTTPS + KERI. DID document served at a well-known URL, accompanied by a CESR event stream proving authenticity. Example: `did:webs:example.com:keri:EBfdlu8R...`
- **`did:iota`** -- IOTA ledger. DID document stored on-chain. Example: `did:iota:testnet:0xabc123...`

## The Trust Chain

Trust flows downward through credential issuance:

```
GLEIF Root AID
  The global root of trust. Controlled by 7 authorized representatives
  via multi-signature. Root keys stay offline.
     │
     │  delegates to
     ▼
GEDA (GLEIF External Delegated AID)
  Day-to-day operational identity. Controlled by 5 representatives.
  Issues and revokes QVI credentials.
     │
     │  issues QVI vLEI Credential
     ▼
QVI (Qualified vLEI Issuer)
  An organization accredited by GLEIF to issue vLEI credentials.
  Undergoes qualification process: documentation review, software
  testing, agreement signing. Sets its own fees.
     │
     │  issues LE vLEI Credential
     ▼
Legal Entity
  A real-world company with a valid LEI. The LE credential contains
  the LEI code and organization name, cryptographically chained to
  the QVI credential above it.
     │
     │  self-issues Designated Aliases Credential
     ▼
Designated Aliases
  Links the LE's KERI identifier (did:webs) to other identifiers
  (did:iota). This is a self-issued ACDC -- the LE attests "these
  identifiers are also me." Verified via the CESR event stream.
```

Every credential chains to the one above via ACDC edges. If any link is revoked or invalid, the entire chain fails.

### Why the LE self-issues Designated Aliases

The QVI's role is verifying the *legal entity* and issuing the *LEI-bearing credential*. Linkage to other identifier systems (IOTA) is the LE's own assertion about its digital presence -- the QVI doesn't need to be involved.

## How Verification Works

### Credential Verification (via Sally)

```
1. Legal Entity connects to KERIA via Signify (edge signing)
2. LE retrieves its credential from KERIA
3. LE presents credential to Sally via IPEX grant
4. Sally verifies:
   - LE credential signature → valid, issued by QVI
   - QVI credential signature → valid, issued by GLEIF (GEDA)
   - GLEIF root key state → valid, matches known root AID
   - No credential in the chain is revoked
5. Sally sends result via webhook callback
```

### DID Linkage Verification (Bidirectional)

The PoC verifies linkage in both directions:

**Direction 1: `did:webs` to `did:iota`**
```
1. Resolve did:webs via dkr resolver
   - Fetches DID document + KERI CESR event stream
   - Verifies Designated Aliases credential in the CESR stream
2. Extract did:iota from the document's alsoKnownAs field
3. Resolve the did:iota from IOTA network
4. Check that the IOTA DID document's alsoKnownAs contains the original did:webs
5. Both documents reference each other → bidirectional link confirmed
```

**Direction 2: `did:iota` to `did:webs`**
```
1. Resolve did:iota from IOTA network
2. Extract did:webs from alsoKnownAs
3. Follow Direction 1 from step 1
```

### Why bidirectional?

If only the `did:webs` document claims `alsoKnownAs: did:iota:...`, someone could link *to* a DID they don't control. Both documents must reference each other -- proves control of both identifiers.

## Security Properties

| Property | Mechanism |
|----------|-----------|
| **Key compromise recovery** | KERI pre-rotation. Next keys are hash-committed at creation. Attacker with current keys can't forge rotation. |
| **Credential forgery** | ACDCs are signed and chained. Forging a credential requires compromising every key in the chain up to GLEIF root. |
| **Replay attacks** | KEL sequence numbers are monotonically increasing. Replayed events are detected and rejected. |
| **Schema substitution** | Schemas are identified by SAID (content hash), not URL. Swapping a schema changes its SAID; breaks verification. |
| **Identifier theft** | Bidirectional `alsoKnownAs` linkage. Both DID documents must reference each other. |
| **Witness collusion** | Controllers choose their own witness set. Verifiers choose their own watchers to monitor for duplicity. |
| **Key custodian compromise** | KATE principle. KERIA never holds private keys. Signing happens exclusively in the edge client (Signify). |
| **Revocation** | Credential status tracked via TEL (Transaction Event Log). Sally checks revocation status during chain verification. |

## Q&A

**Q: Is the GLEIF AID in this PoC "fake"?**
No. Real KERI AID, real keys, real KERIA infrastructure. The trust chain mechanics are identical to production -- it's just not *the* GLEIF organization's AID. Swapping it for the real root AID is a config change, not a code change.

**Q: Does the LE need a special QVI for this to work?**
No. The Designated Aliases credential (which links `did:webs` to `did:iota`) is self-issued by the LE. Any standard QVI can issue the LE vLEI credential; the QVI doesn't need to know about IOTA.

**Q: Can anyone verify the credentials, or do they need special access?**
Anyone. You need a KERI verifier (like Sally) and access to the public KEL via witnesses or OOBI resolution. No API keys, no registration.

**Q: Where are the private keys stored?**
Signify client only. KERIA stores encrypted key material it can't decrypt. All signing happens locally via `signify-ts` -- private keys never traverse the network.

**Q: What happens if a credential is revoked?**
Revocation is recorded in the TEL (Transaction Event Log), anchored to the issuer's KEL. Sally checks revocation status at every level -- a revoked credential anywhere in the chain fails the entire verification.

**Q: What's the NFT attestation for?**
Optional public record on IOTA. The NFT contains IRC27 metadata with a W3C VC JWT signed by the LE's KERI key. Verifiable using the LE's public key (via `did:webs`) with standard Ed25519/WebCrypto -- no KERI infrastructure needed.

**Q: How does `did:webs` resolution work?**
The identifier encodes a domain and AID (e.g., `did:webs:example.com:keri:EBfd...`). Resolution fetches (1) a DID document at `/keri/{AID}/did.json` and (2) a CESR event stream at `/keri/{AID}/keri.cesr`. The resolver (dkr) verifies the CESR stream -- the DID document is only trustworthy if the CESR proof checks out.

**Q: What makes bidirectional linking secure?**
Each direction requires the respective private key:
- IOTA DID `alsoKnownAs` -- requires IOTA controller's key (on-chain transaction)
- `did:webs` `alsoKnownAs` -- comes from the Designated Aliases ACDC, signed by the LE's KERI key, anchored to their KEL

Compromise requires both key systems simultaneously.
