/**
 * DID WEBS Client Service
 *
 * Thin wrapper around DidWebsResolver from @gleif/verifier-core;
 * just configures it with environment-specific URLs.
 */

import { DidWebsResolver, type DIDDocument } from '@gleif/verifier-core';

/**
 * Get the DID WEBS resolver URL from environment
 */
function getResolverUrl(): string {
  if (process.env.DID_WEBS_RESOLVER_URL) {
    return process.env.DID_WEBS_RESOLVER_URL;
  }

  const isDocker = process.env.TRUST_ANCHORS_PATH?.includes('/app/config/');
  return isDocker
    ? 'http://did-webs-resolver:7677'
    : 'http://localhost:7677';
}

const resolver = new DidWebsResolver({
  resolverUrl: getResolverUrl(),
});

/**
 * Resolve a DID via the did-webs-resolver service
 */
export function resolveDid(did: string): Promise<DIDDocument> {
  return resolver.resolve(did);
}
