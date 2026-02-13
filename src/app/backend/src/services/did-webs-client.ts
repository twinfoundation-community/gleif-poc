/**
 * DID WEBS Client Service
 *
 * Thin wrapper around DidWebsResolver from @gleif/verifier-core;
 * just configures it with environment-specific URLs.
 */

import { DidWebsResolver, type DIDDocument } from '@gleif/verifier-core';

const resolver = new DidWebsResolver({
  resolverUrl: process.env.DID_WEBS_RESOLVER_URL!,
});

/**
 * Resolve a DID via the did-webs-resolver service
 */
export function resolveDid(did: string): Promise<DIDDocument> {
  return resolver.resolve(did);
}
