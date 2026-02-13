# vLEI Linkage Reference

How this PoC works and how trust is established.

## The Problem

There's no standardized way to cryptographically prove "this digital entity is this real-world legal entity." Domain names, certificates, and manual document checks can all be forged, revoked without notice, or go stale.

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
1. Resolve did:webs via dws resolver
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

**Q: What's the on-chain attestation for?**
Optional public record on IOTA. The attestation is a custom Move object (`VleiAttestation`) with typed fields (LEI, DIDs, trust chain) and a W3C VC JWT signed by the IOTA wallet key (the `did:iota` controller's key). The JWT's `iss` is the `did:iota`, so verification resolves the key from the IOTA DID document (standard Ed25519/WebCrypto, no KERI infrastructure). Sally already verified the full KERI credential chain; the attestation records that fact. Trust chains back to GLEIF via the bidirectional `alsoKnownAs` binding.

**Q: How does `did:webs` resolution work?**
The identifier encodes a domain and AID (e.g., `did:webs:example.com:keri:EBfd...`). Resolution fetches (1) a DID document at `/keri/{AID}/did.json` and (2) a CESR event stream at `/keri/{AID}/keri.cesr`. The resolver (dws) verifies the CESR stream -- the DID document is only trustworthy if the CESR proof checks out.

**Q: What makes bidirectional linking secure?**
Each direction requires the respective private key:
- `did:iota` `alsoKnownAs` -- IOTA controller's key (BIP44-derived Ed25519, on-chain transaction)
- `did:webs` `alsoKnownAs` -- comes from the Designated Aliases ACDC, signed by the LE's KERI key, anchored to their KEL (KERI-managed Ed25519 via Signify)

## Live Examples (from running PoC)

All examples below are from the actual running instance. AIDs, SAIDs, and DIDs are real KERI/IOTA artifacts.

### The Three Identities

| Role | AID | LEI |
|------|-----|-----|
| GLEIF (root) | `EL7qP_alwRFsib0RBDGdQaRP9TeZgiPNCa5BP-iOgulg` | -- |
| QVI (issuer) | `EBR0UdagzMYgTNKjdihAhoyMX7Vc9ixi2gPBG63per6r` | -- |
| Legal Entity | `EINvX35WDwPsRTGUxYEBlFdbD-AcEfFJrjVuElja5mI_` | `5493001KJTIIGC8Y1R12` |

Each AID is a self-certifying KERI identifier derived from an Ed25519 public key. The `E` prefix is the CESR derivation code for a self-addressing identifier (Blake3-256 digest of inception event).

### The Credential Chain

**QVI Credential** (GLEIF issues to QVI):
```
SAID:   EIM8ij-kl5cxUvW791_OFFXz746LpDyaOwmPfp7BAbAH
Schema: EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao  (QVI vLEI schema)
Issuer: EL7qP_alwRFsib0RBDGdQaRP9TeZgiPNCa5BP-iOgulg  (GLEIF)
Issuee: EBR0UdagzMYgTNKjdihAhoyMX7Vc9ixi2gPBG63per6r  (QVI)
```

**LE Credential** (QVI issues to Legal Entity):
```
SAID:   ELQb4yL9pGoKNcgpwkVgPQ-2KpxZ0ZH18ida3wog4DcL
Schema: ENPXp1vQzRF6JwIuS-mp2U8Uf1MoADoP_GqQ62VsDZWY  (LE vLEI schema)
Issuer: EBR0UdagzMYgTNKjdihAhoyMX7Vc9ixi2gPBG63per6r  (QVI)
Issuee: EINvX35WDwPsRTGUxYEBlFdbD-AcEfFJrjVuElja5mI_  (LE)
```

**Designated Aliases Credential** (LE self-issues):
```
SAID:   EIao-ml2vzmNL8D3B7Pozw8F3MLg5g6miJDlLPvpWBaJ
Schema: EN6Oh5XSD5_q2Hgu-aqpdfbVepdpYpFlgz6zvJL5b_r5  (DA schema)
Issuer: EINvX35WDwPsRTGUxYEBlFdbD-AcEfFJrjVuElja5mI_  (LE -- self-issued)
IDs:    ["did:iota:testnet:0xe547095f2b0a482edac21b41da48e393e9f060fb519f3ebae0e920dab6ccb29f"]
```

Note the chain: each credential's issuer is the issuee of the credential above it. The DA credential is self-issued -- issuer and controller are the same AID.

### What an ACDC Credential Looks Like

The Designated Aliases credential as it appears in the KERI CESR stream:

```json
{
  "v":  "ACDC10JSON0004bb_",
  "d":  "EIao-ml2vzmNL8D3B7Pozw8F3MLg5g6miJDlLPvpWBaJ",
  "i":  "EINvX35WDwPsRTGUxYEBlFdbD-AcEfFJrjVuElja5mI_",
  "ri": "ECFO_baV1sy5j0vSm8bhdP0uFsP0tJtRF48Nu3cwo2XN",
  "s":  "EN6Oh5XSD5_q2Hgu-aqpdfbVepdpYpFlgz6zvJL5b_r5",
  "a": {
    "d":  "EFvoTtftLOHUCJdTEH1hxYo0nzhzxcdK79O6IJ9w4Olo",
    "dt": "2026-02-08T06:26:36.937000+00:00",
    "ids": [
      "did:iota:testnet:0xe547095f2b0a482edac21b41da48e393e9f060fb519f3ebae0e920dab6ccb29f"
    ]
  },
  "r": {
    "d": "",
    "aliasDesignation": {
      "l": "The issuer of this ACDC designates the identifiers in the ids field as the only allowed namespaced aliases of the issuer's AID."
    },
    "usageDisclaimer": {
      "l": "This attestation only asserts designated aliases of the controller of the AID, that the AID controlled namespaced alias has been designated by the controller. It does not assert that the controller of this AID has control over the infrastructure or anything else related to the namespace other than the included AID."
    },
    "issuanceDisclaimer": {
      "l": "All information in a valid and non-revoked alias designation assertion is accurate as of the date specified."
    },
    "termsOfUse": {
      "l": "Designated aliases of the AID must only be used in a manner consistent with the expressed intent of the AID controller."
    }
  }
}
```

| Field | Meaning |
|-------|---------|
| `v` | Version string: ACDC version 1.0, JSON encoding, 0x4bb bytes |
| `d` | SAID of this credential (content hash embedded in the content it hashes) |
| `i` | Controller AID (the LE) |
| `ri` | Registry identifier -- tracks issuance/revocation status via TEL |
| `s` | Schema SAID (content-addressed, not a URL -- prevents schema-swap) |
| `a` | Attributes block with its own SAID (`d`), timestamp (`dt`), and the linked DIDs (`ids`) |
| `r` | Rules block -- legal terms baked into the credential itself |

### What a `did:webs` Document Looks Like

`did:webs:backend:keri:EINvX35WDwPsRTGUxYEBlFdbD-AcEfFJrjVuElja5mI_` (Legal Entity):

```json
{
  "id": "did:webs:backend:keri:EINvX35WDwPsRTGUxYEBlFdbD-AcEfFJrjVuElja5mI_",
  "verificationMethod": [{
    "id": "#DALcOjPQsYb3gOjl7AwMXHY2kGwhePAfdAuDSnVEyRy7",
    "type": "JsonWebKey",
    "controller": "did:webs:backend:keri:EINvX35WDwPsRTGUxYEBlFdbD-AcEfFJrjVuElja5mI_",
    "publicKeyJwk": {
      "kid": "DALcOjPQsYb3gOjl7AwMXHY2kGwhePAfdAuDSnVEyRy7",
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "Atw6M9CxhveA6OXsDAxcdjaQbCF48B90C4NKdUTJHLs"
    }
  }],
  "service": [],
  "alsoKnownAs": [
    "did:webs:backend:keri:EINvX35WDwPsRTGUxYEBlFdbD-AcEfFJrjVuElja5mI_",
    "did:iota:testnet:0xe547095f2b0a482edac21b41da48e393e9f060fb519f3ebae0e920dab6ccb29f",
    "did:keri:EINvX35WDwPsRTGUxYEBlFdbD-AcEfFJrjVuElja5mI_",
    "did:web:backend:keri:EINvX35WDwPsRTGUxYEBlFdbD-AcEfFJrjVuElja5mI_"
  ]
}
```

Note: no `@context`. The did:webs spec explicitly requires pure JSON -- no JSON-LD context. The dkr resolver generates its own DID document from the CESR stream and does a strict deep equality comparison against the served `did.json`. Adding `@context` would cause that comparison to fail. Consumers that need JSON-LD processing can prepend `@context` themselves.

The `verificationMethod` exposes the LE's Ed25519 public key in JWK format. The `kid` is the KERI qualified key identifier (`D` prefix = Ed25519). The `alsoKnownAs` includes identifiers from the Designated Aliases credential plus `did:keri` and `did:web` equivalents of the AID.

### What a `did:iota` Document Looks Like

[`did:iota:testnet:0xe547095f2b0a482edac21b41da48e393e9f060fb519f3ebae0e920dab6ccb29f`](https://explorer.iota.org/object/0xe547095f2b0a482edac21b41da48e393e9f060fb519f3ebae0e920dab6ccb29f?network=testnet) (same Legal Entity, on-chain):

```json
{
  "id": "did:iota:testnet:0xe547095f2b0a482edac21b41da48e393e9f060fb519f3ebae0e920dab6ccb29f",
  "alsoKnownAs": [
    "did:webs:backend:keri:EINvX35WDwPsRTGUxYEBlFdbD-AcEfFJrjVuElja5mI_"
  ],
  "service": [{
    "id": "...#revocation",
    "type": "RevocationBitmap2022",
    "serviceEndpoint": "data:application/octet-stream;base64,eJyzMmAAAwADKABr"
  }]
}
```

The bidirectional link: `did:webs` document says `alsoKnownAs: did:iota:...` and the `did:iota` document says `alsoKnownAs: did:webs:...`. Both updates require the respective private key (KERI key for the `did:webs` side, IOTA controller key for the `did:iota` side).

### What the KERI Event Stream Looks Like

The CESR stream at `/keri/{AID}/keri.cesr` contains the LE's full cryptographic proof:

```
Inception Event (s:0)  ── creates the AID, commits to next keys, designates witness
  │
Interaction Event (s:1) ── anchors credential registry creation
  │
Interaction Event (s:2) ── anchors DA credential issuance
  │
Registry Inception (vcp) ── creates the TEL registry for credential status
  │
Issuance Event (iss) ── records DA credential issuance in the registry
  │
ACDC Credential ── the Designated Aliases credential itself
```

Each event is signed by the LE's Ed25519 key and counter-signed by the witness (`BBilc4-L3tFUnfM_wJr4S4OJanAv_VmF_dJNN6vkf2Ha`). The `did:webs` resolver (dws) verifies this entire stream before trusting the DID document.

### What an OOBI Looks Like

```
http://keria1:3902/oobi/ELyw5WNsfXL7AxtnYaVWM2S0quKIuBWZmgHnUKfUaGo8/agent/EPx8XiQXxxsBBWUux3lUaRjDNt6HgYgbjw0fjgAP0ybY
                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                        target AID (Legal Entity)                               agent AID (KERIA agent for this identity)
```

The OOBI says: "to discover data about `ELyw5WNs...`, ask the KERIA agent at `EPx8XiQX...` via `http://keria1:3902`." After resolving, all data is verified cryptographically -- the OOBI itself is untrusted.

### On-Chain Attestation

[IOTA Explorer](https://explorer.iota.org/object/0x5783fd6ce2abc6f28302f1ff89073d0bb6614ad06449d49a514c51a1cd0f5488?network=testnet)

A custom Move attestation object (`VleiAttestation`, package `0xd4d6f6488091e275ff59bcbe1999af90737ce1b5b866085284ceb262c7bdf9de`) stores typed Move object fields with a W3C VC JWT signed by the IOTA wallet key (the `did:iota` controller's Ed25519 key). Anyone can verify the JWT using the public key from the `did:iota` document -- no KERI infrastructure needed. The trust link back to GLEIF is the bidirectional `alsoKnownAs` binding plus Sally's prior credential chain verification.

### Sally Verifier

```
AID: ECLwKe5b33BaV20x7HZWYi_KUXgY91S41fRL2uCaf4WQ
```

Sally is pre-configured with:
- GLEIF's OOBI resolved (knows the root of trust)
- QVI credential pre-loaded (can verify the full chain)

When the LE presents its credential via IPEX grant, Sally walks the chain: LE credential -> QVI credential -> GLEIF root AID, verifying every signature and checking revocation status at each level.
