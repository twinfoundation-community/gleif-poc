# Production Path

What it takes to move this POC toward production.

## 1. Planned Flow: Identity Management Integration

- Organization onboards via TWIN Identity — gets a `did:iota`
- Separately, organization obtains vLEI credential through GLEIF's QVI ecosystem — gets a `did:webs`
- LE self-issues a Designated Aliases ACDC, listing the `did:iota` as a linked identifier
- `alsoKnownAs` set on the `did:iota` document, pointing back to `did:webs`
- `alsoKnownAs` on the `did:webs` side is derived from the Designated Aliases credential
- Verifier confirms bidirectional linkage + the full vLEI trust chain

## 2. Fix Workaround: `@twin.org/identity-connector-iota` Missing `setAlsoKnownAs()`

- The connector doesn't expose `setAlsoKnownAs()` or `addAlsoKnownAs()` yet
- POC works around this by using the IOTA Identity SDK directly (`iota-also-known-as.ts`)
- Resolves the on-chain document, calls `document.setAlsoKnownAs()`, publishes the update
- Replace with the connector's native method once it's available

## 3. Move `signify-ts` to the Browser

- Right now, `signify-ts` runs on the backend — the backend holds the LE passcode, connects to KERIA, creates IPEX grants
- In production, `signify-ts` should run in the browser (non-custodial)
- Browser connects to KERIA directly, holds key material in memory, creates IPEX grants
