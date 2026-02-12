/**
 * KEL Publisher
 *
 * Serves KERI event logs and DID documents for did:webs resolution.
 * The resolver expects /{AID}/did.json and /{AID}/keri.cesr --
 * this class fetches from KERIA via SignifyClient and formats accordingly.
 */

import type { SignifyClient } from 'signify-ts';
import { keriKeyToJwk, type KeriKeyState, type DIDDocument } from '@gleif/verifier-core';

const DEFAULT_DA_SCHEMA_SAID = 'EN6Oh5XSD5_q2Hgu-aqpdfbVepdpYpFlgz6zvJL5b_r5';
const DEFAULT_DA_CACHE_TTL_MS = 5 * 60 * 1000;

/** config for the KEL publisher */
interface KelPublisherConfig {
  /** KERIA HTTP endpoint URL for CESR fetching (e.g., "http://localhost:3902") */
  keriaHttpUrl: string;
  /** Schema SAID for designated aliases credential (default: standard DA schema) */
  designatedAliasesSchemaSaid?: string;
  /** Cache TTL for DA credentials in ms (default: 300000 = 5 min) */
  daCacheTtlMs?: number;
}

/**
 * Verification method in a did:webs DID document (JWK format)
 */
interface DidWebsVerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyJwk: {
    kid: string;
    kty: string;
    crv: string;
    x: string;
  };
}

/**
 * Internal DID document structure for did:webs
 */
interface DidWebsDocument extends DIDDocument {
  verificationMethod: DidWebsVerificationMethod[];
}

/**
 * Publishes KEL + DID documents for did:webs resolution.
 *
 * Takes a callback to get a SignifyClient for a given AID -- lets the caller
 * handle auth (passcodes, client caching, etc).
 */
export class KelPublisher {
  private readonly schemaSaid: string;
  private readonly cacheTtl: number;
  private daCache: Map<string, { ids: string[]; said: string; fetchedAt: number }> = new Map();

  /**
   * @param config - publisher config
   * @param getClient - returns a connected SignifyClient for the AID, or null
   */
  constructor(
    private readonly config: KelPublisherConfig,
    private readonly getClient: (aid: string) => Promise<SignifyClient | null>,
  ) {
    this.schemaSaid = config.designatedAliasesSchemaSaid ?? DEFAULT_DA_SCHEMA_SAID;
    this.cacheTtl = config.daCacheTtlMs ?? DEFAULT_DA_CACHE_TTL_MS;
  }

  /** fetch the DA credential for an AID */
  private async fetchDesignatedAliases(
    client: SignifyClient,
    aid: string,
  ): Promise<{ ids: string[]; said: string } | null> {
    const cached = this.daCache.get(aid);
    if (cached && (Date.now() - cached.fetchedAt) < this.cacheTtl) {
      return { ids: cached.ids, said: cached.said };
    }
    try {
      const allCreds = await client.credentials().list();
      const cred = allCreds.find(
        (c: Record<string, unknown>) => {
          const sad = c as { sad?: { s?: string; i?: string; d?: string; a?: { ids?: string[] } } };
          return sad.sad?.s === this.schemaSaid && sad.sad?.i === aid;
        },
      );
      const sad = (cred as { sad?: { d?: string; a?: { ids?: unknown[] } } })?.sad;
      if (sad?.d && sad?.a?.ids && Array.isArray(sad.a.ids)) {
        const entry = {
          ids: sad.a.ids as string[],
          said: sad.d,
          fetchedAt: Date.now(),
        };
        this.daCache.set(aid, entry);
        return { ids: entry.ids, said: entry.said };
      }
      return null;
    } catch {
      return null;
    }
  }

  /** build a DID document from KERI key state */
  private buildDidDocument(
    aid: string,
    keyState: KeriKeyState,
    domain: string,
    path: string,
    alsoKnownAs?: string[],
  ): DidWebsDocument {
    const didId = path
      ? `did:webs:${domain}:${path}:${aid}`
      : `did:webs:${domain}:${aid}`;

    const verificationMethods: DidWebsVerificationMethod[] = keyState.k.map((key: string) => {
      const jwk = keriKeyToJwk(key);
      return {
        id: `#${key}`,
        type: 'JsonWebKey',
        controller: didId,
        publicKeyJwk: {
          kid: jwk.kid || key,
          kty: jwk.kty,
          crv: jwk.crv || 'Ed25519',
          x: jwk.x || '',
        },
      };
    });

    const doc: DidWebsDocument = {
      id: didId,
      verificationMethod: verificationMethods,
      service: [],
    };

    if (alsoKnownAs && alsoKnownAs.length > 0) {
      const didKeriId = `did:keri:${aid}`;
      const didWebId = path
        ? `did:web:${domain}:${path}:${aid}`
        : `did:web:${domain}:${aid}`;
      const extras = [didKeriId, didWebId].filter(id => !alsoKnownAs.includes(id));
      doc.alsoKnownAs = [...alsoKnownAs, ...extras];
    }

    return doc;
  }

  /** get the DID document for a KERI AID */
  async getDidDocument(
    aid: string,
    domain: string,
    path: string,
  ): Promise<DIDDocument> {
    let alsoKnownAs: string[] | undefined;
    let client: SignifyClient | null = null;

    try {
      client = await this.getClient(aid);
      if (client) {
        // derive alsoKnownAs from DA credential (anchored in KEL)
        const daResult = await this.fetchDesignatedAliases(client, aid);
        if (daResult && daResult.ids.length > 0) {
          alsoKnownAs = daResult.ids;
        }
      }
    } catch {
      // no client for this AID -- continue without DA
    }

    // If we have a client, get key state from KERIA
    if (client) {
      try {
        const keyStates = await client.keyStates().get(aid);
        if (keyStates && keyStates.length > 0) {
          return this.buildDidDocument(aid, keyStates[0], domain, path, alsoKnownAs);
        }
      } catch {
        // Fall through to HTTP fallback
      }
    }

    // fallback: fetch key state via KERIA HTTP
    try {
      const response = await fetch(`${this.config.keriaHttpUrl}/states/${aid}`, {
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const keyState = await response.json() as KeriKeyState;
        return this.buildDidDocument(aid, keyState, domain, path, alsoKnownAs);
      }
    } catch {
      // Fall through to error
    }

    throw new Error(`Unable to get key state for AID: ${aid}`);
  }

  /**
   * Get KERI CESR for an AID.
   *
   * Returns the KEL in CESR format, enriched with the DA credential CESR
   * if available -- required by did:webs spec for alsoKnownAs verification.
   */
  async getKeriCesr(aid: string): Promise<string> {
    const oobiUrl = `${this.config.keriaHttpUrl}/oobi/${aid}`;

    let kelCesr: string;
    try {
      const response = await fetch(oobiUrl, {
        signal: AbortSignal.timeout(10000),
        headers: {
          'Accept': 'application/cesr',
        },
      });

      if (!response.ok) {
        throw new Error(`KERIA returned ${response.status}: ${response.statusText}`);
      }

      kelCesr = await response.text();

      if (!kelCesr || kelCesr.length === 0) {
        throw new Error('Empty CESR response from KERIA');
      }
    } catch (error) {
      throw new Error(`Failed to fetch KERI CESR for AID ${aid}: ${error}`);
    }

    // enrich with DA credential CESR -- did:webs spec requires it for alsoKnownAs verification
    try {
      const client = await this.getClient(aid);
      if (client) {
        const daResult = await this.fetchDesignatedAliases(client, aid);
        if (daResult?.said) {
          const credCesr = await client.credentials().get(daResult.said, true);
          if (typeof credCesr === 'string' && credCesr.length > 0) {
            return kelCesr + credCesr;
          }
        }
      }
    } catch {
      // return KEL without DA credential
    }

    return kelCesr;
  }

  /**
   * Check if an AID string looks valid.
   * KERI AIDs are base64url, typically 44 chars, starting with a derivation code.
   */
  static isValidAid(aid: string): boolean {
    return /^[A-Za-z0-9_-]{44}$/.test(aid);
  }
}
