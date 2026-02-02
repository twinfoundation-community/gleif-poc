/**
 * did:webs resolver
 *
 * Resolves did:webs via a dkr (did:keri resolver) service.
 * The resolver verifies the CESR stream -- including DA credentials -- during resolution,
 * so if you get a document back with alsoKnownAs, it's cryptographically verified.
 */

import type { DIDDocument } from '../types/did.js';

/** config for the did:webs resolver */
interface DidWebsResolverConfig {
  /** Base URL of the dkr resolver service (e.g., "http://localhost:7677") */
  resolverUrl: string;
  /** Request timeout in milliseconds (default: 10000) */
  timeoutMs?: number;
}

/**
 * Resolves did:webs via a dkr service.
 *
 * The dkr fetches the DID document + KERI CESR stream from the AID's endpoint,
 * verifies the KEL and any DA credentials in the CESR stream, and hands back
 * the verified document.
 */
export class DidWebsResolver {
  private readonly resolverUrl: string;
  private readonly timeoutMs: number;

  constructor(config: DidWebsResolverConfig) {
    this.resolverUrl = config.resolverUrl.replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  /**
   * Resolve a DID via the dkr service.
   *
   * @param did - did:webs:... or did:keri:...
   * @returns resolved DID document
   */
  async resolve(did: string): Promise<DIDDocument> {
    const encodedDid = encodeURIComponent(did);
    const url = `${this.resolverUrl}/1.0/identifiers/${encodedDid}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/did+ld+json, application/json',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `DID resolution failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const responseText = await response.text();

    // dkr sometimes returns error text with a 200; catch that
    if (responseText.includes('Keystore must already exist') ||
        responseText.includes('exiting')) {
      throw new Error(`DID resolver returned invalid response: ${responseText.substring(0, 100)}`);
    }

    // dkr outputs debug lines mixed with JSON -- parse line-by-line to find the DID doc
    let result;
    const lines = responseText.split('\n');
    for (const line of lines) {
      const braceIdx = line.indexOf('{');
      if (braceIdx < 0) continue;
      try {
        const parsed = JSON.parse(line.substring(braceIdx));
        if (parsed.id || parsed.didDocument || parsed['@context']) {
          result = parsed;
          break;
        }
      } catch { /* not valid JSON on this line, continue */ }
    }

    if (!result) {
      throw new Error(`DID resolver returned no DID document in response`);
    }

    // might be wrapped in a resolution result, or might be the doc directly
    const document: DIDDocument = result.didDocument || result;

    if (!document.id) {
      throw new Error('Invalid DID document: missing id');
    }

    return document;
  }
}
