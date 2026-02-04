/**
 * kel publisher service -- poc wrapper
 *
 * thin wrapper around KelPublisher from @gleif/verifier-node.
 * configures with poc-specific trust anchor credentials.
 */

import { ready, SignifyClient, Tier } from 'signify-ts';
import { KelPublisher, type DIDDocument } from '@gleif/verifier-node';
import { getEnvConfig, loadTrustAnchors } from './config';
import type { TrustAnchorConfig } from '../types/index';

// Cache for initialized clients
let signifyReady = false;
const clientCache: Map<string, SignifyClient> = new Map();

async function ensureSignifyReady(): Promise<void> {
  if (!signifyReady) {
    await ready();
    signifyReady = true;
  }
}

/** get or create a SignifyClient for an agent */
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

  // Match AID to trust anchor entry
  let passcode: string | null = null;
  let cacheKey: string | null = null;

  if (trustAnchors.le?.aid === aid) {
    passcode = trustAnchors.le.passcode;
    cacheKey = 'le';
  } else if (trustAnchors.qvi?.aid === aid) {
    passcode = trustAnchors.qvi.passcode;
    cacheKey = 'qvi';
  } else if (trustAnchors.gleif?.aid === aid) {
    passcode = trustAnchors.gleif.passcode;
    cacheKey = 'gleif';
  }

  if (!passcode || !cacheKey) return null;

  // Check cache by role key too
  const cachedByRole = clientCache.get(cacheKey);
  if (cachedByRole) {
    clientCache.set(aid, cachedByRole);
    return cachedByRole;
  }

  const env = getEnvConfig();
  const paddedPasscode = passcode.padEnd(21, '_');
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

/** get the DID document for an AID */
export function getDidDocument(aid: string, domain: string, path: string): Promise<DIDDocument> {
  return getPublisher().getDidDocument(aid, domain, path);
}

/** get KERI CESR data for an AID */
export function getKeriCesr(aid: string): Promise<string> {
  return getPublisher().getKeriCesr(aid);
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
