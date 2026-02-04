/**
 * DID Linking Verifier Service
 *
 * Thin wrapper around DidLinkingVerifier from @gleif/verifier-node;
 * wires in the POC's service implementations.
 */

import { DidLinkingVerifier, type DidLinkingVerificationResult } from '@gleif/verifier-node';
import { resolveDid } from './did-webs-client';
import { getDidDocument } from './kel-publisher';
import { verifyLeCredential } from './sally-client';
import { resolveIotaDid, extractWebsDid } from './iota-identity-service';

export type { DidLinkingVerificationResult };

const verifier = new DidLinkingVerifier(
  {
    resolveDidWebs: resolveDid,
    getDidDocument,
    resolveIotaDid,
    extractWebsDid,
    verifyLeCredential,
  },
  {
    kelPublisherDomain: 'backend',
    kelPublisherPath: 'keri',
  },
);

/**
 * Verify a did:webs identifier through the full DID linking flow
 */
export function verifyDidLinking(didWebs: string): Promise<DidLinkingVerificationResult> {
  return verifier.verify(didWebs);
}
