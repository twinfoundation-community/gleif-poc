/**
 * DID Linking Verifier Service
 *
 * Thin wrapper around DidLinkingVerifier from @gleif/verifier-node;
 * wires in the POC's service implementations.
 *
 * Credential verification (IPEX grant to Sally) happens browser-side --
 * this only handles DID resolution and bidirectional link checking.
 */

import { DidLinkingVerifier, type DidLinkingVerificationResult } from '@gleif/verifier-node';
import { resolveDid } from './did-webs-client';
import { getDidDocument } from './kel-publisher';
import { resolveIotaDid, extractWebsDid } from './iota-identity-service';

export type { DidLinkingVerificationResult };

const verifier = new DidLinkingVerifier(
  {
    resolveDidWebs: resolveDid,
    getDidDocument,
    resolveIotaDid,
    extractWebsDid,
  },
  {
    kelPublisherDomain: 'backend',
    kelPublisherPath: 'keri',
  },
);

/**
 * Verify DID linkage for a did:webs identifier (resolution + bidirectional check).
 * Does NOT verify the LE credential - that happens browser-side.
 */
export function verifyDidLinking(didWebs: string): Promise<DidLinkingVerificationResult> {
  return verifier.verify(didWebs);
}
