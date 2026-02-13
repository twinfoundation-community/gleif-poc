/**
 * kel publisher service -- poc wrapper
 *
 * thin wrapper around KelPublisher from @gleif/verifier-node.
 * configures with poc-specific trust anchor credentials.
 *
 * The LE's DID document and DA CESR are published by the browser after
 * DA credential issuance - the backend just caches and servs them.
 * Only QVI/GLEIF AIDs still use a SignifyClient on the backend.
 */

import { ready, SignifyClient, Tier } from 'signify-ts';
import { KelPublisher, type DIDDocument } from '@gleif/verifier-node';
import { paddedSignifyPasscode } from '@gleif/verifier-core';
import { getEnvConfig, loadTrustAnchors } from './config';
import type { TrustAnchorConfig } from '../types/index';

// Cache for initialized clients
let signifyReady = false;
const clientCache: Map<string, SignifyClient> = new Map();

// Browser-published data cache
const publishedDidDocs: Map<string, DIDDocument> = new Map();
const publishedDaCesr: Map<string, string> = new Map();

async function ensureSignifyReady(): Promise<void> {
  if (!signifyReady) {
    await ready();
    signifyReady = true;
  }
}

/**
 * Get or create a SignifyClient for an agent.
 * Returns null for the LE AID; the browser publishes LE data directly.
 */
async function getClientForAid(aid: string): Promise<SignifyClient | null> {
  await ensureSignifyReady();

  const cached = clientCache.get(aid);
  if (cached) return cached;

  let trustAnchors: TrustAnchorConfig;
  try {
    trustAnchors = loadTrustAnchors();
  } catch {
    return null;
  }

  // LE is handled by browser-published cache
  if (trustAnchors.le?.aid === aid) {
    return null;
  }

  let passcode: string | null = null;
  let cacheKey: string | null = null;

  if (trustAnchors.qvi?.aid === aid) {
    passcode = trustAnchors.qvi.passcode;
    cacheKey = 'qvi';
  } else if (trustAnchors.gleif?.aid === aid) {
    passcode = trustAnchors.gleif.passcode;
    cacheKey = 'gleif';
  }

  if (!passcode || !cacheKey) return null;

  const cachedByRole = clientCache.get(cacheKey);
  if (cachedByRole) {
    clientCache.set(aid, cachedByRole);
    return cachedByRole;
  }

  const env = getEnvConfig();
  const paddedPasscode = paddedSignifyPasscode(passcode);
  const client = new SignifyClient(env.keriaUrl, paddedPasscode, Tier.low, env.keriaBootUrl);

  try {
    await client.connect();
    clientCache.set(cacheKey, client);
    clientCache.set(aid, client);
    return client;
  } catch (error) {
    throw new Error(`Failed to connect to KERIA: ${error}`);
  }
}

// Lazy-initialized publisher instance
let publisherInstance: KelPublisher | null = null;

function getPublisher(): KelPublisher {
  if (!publisherInstance) {
    const env = getEnvConfig();
    publisherInstance = new KelPublisher(
      {
        keriaHttpUrl: env.keriaUrl.replace(':3901', ':3902'),
        designatedAliasesSchemaSaid: 'EN6Oh5XSD5_q2Hgu-aqpdfbVepdpYpFlgz6zvJL5b_r5',
      },
      getClientForAid,
    );
  }
  return publisherInstance;
}

/** Store browser-published DID data for an AID */
export function publishDidData(aid: string, didDocument: DIDDocument, daCesr?: string): void {
  publishedDidDocs.set(aid, didDocument);
  if (daCesr) {
    publishedDaCesr.set(aid, daCesr);
  }
  console.log(`[kel-publisher] Cached published DID data for AID: ${aid} (daCesr: ${!!daCesr})`);
}

/** get the DID document for an AID -- checks browser-published cache first */
export async function getDidDocument(aid: string, domain: string, path: string): Promise<DIDDocument> {
  const cached = publishedDidDocs.get(aid);
  if (cached) return cached;

  return getPublisher().getDidDocument(aid, domain, path);
}

/** get KERI CESR data for an AID -- appends browser-published DA CESR if available */
export async function getKeriCesr(aid: string): Promise<string> {
  const baseCesr = await getPublisher().getKeriCesr(aid);

  const daCesr = publishedDaCesr.get(aid);
  if (daCesr) {
    return baseCesr + daCesr;
  }

  return baseCesr;
}

/** check if an AID is valid -- basic format check */
export const isValidAid = KelPublisher.isValidAid;

/** get available AIDs from trust anchors -- poc-specific */
export function getAvailableAids(): Array<{ name: string; aid: string; hasIotaDid: boolean }> {
  try {
    const config = loadTrustAnchors();
    const aids = [];

    if (config.gleif?.aid) {
      aids.push({ name: 'gleif', aid: config.gleif.aid, hasIotaDid: false });
    }
    if (config.qvi?.aid) {
      aids.push({ name: 'qvi', aid: config.qvi.aid, hasIotaDid: false });
    }
    if (config.le?.aid) {
      aids.push({
        name: 'le',
        aid: config.le.aid,
        hasIotaDid: !!config.le.iotaDid,
      });
    }

    return aids;
  } catch {
    return [];
  }
}
