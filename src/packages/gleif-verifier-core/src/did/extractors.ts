import type { DIDDocument } from '../types/did.js';

/** pull the first alsoKnownAs entry matching a given DID's prefix */
function extractDidByPrefix(doc: DIDDocument, prefix: string): string | null {
  if (!doc.alsoKnownAs || !Array.isArray(doc.alsoKnownAs)) {
    return null;
  }

  for (const alias of doc.alsoKnownAs) {
    if (typeof alias === 'string' && alias.startsWith(prefix)) {
      return alias;
    }
  }

  return null;
}

/** pull the first did:iota from a document's alsoKnownAs */
export function extractIotaDid(doc: DIDDocument): string | null {
  return extractDidByPrefix(doc, 'did:iota:');
}

/** pull the first did:webs from a document's alsoKnownAs */
export function extractWebsDid(doc: DIDDocument): string | null {
  return extractDidByPrefix(doc, 'did:webs:');
}

/**
 * Find a KERI-related service endpoint in the document.
 * Looks for "KERIAgent" or similar service types.
 */
export function extractKeriServiceEndpoint(doc: DIDDocument): string | null {
  if (!doc.service || !Array.isArray(doc.service)) {
    return null;
  }

  // Look for KERI-related service types
  const keriServiceTypes = [
    'KERIAgent',
    'KERI',
    'vLEICredentialService',
    'LinkedDomains',
  ];

  for (const service of doc.service) {
    if (keriServiceTypes.some(type =>
      service.type === type ||
      service.type.includes('KERI') ||
      service.type.includes('vLEI')
    )) {
      if (typeof service.serviceEndpoint === 'string') {
        return service.serviceEndpoint;
      }
      // Handle array of endpoints
      if (Array.isArray(service.serviceEndpoint) && service.serviceEndpoint.length > 0) {
        return service.serviceEndpoint[0] as string;
      }
    }
  }

  return null;
}

/**
 * Extract AID from a did:webs identifier.
 * The AID is always the last colon-separated segment.
 */
export function extractAidFromDidWebs(didWebs: string): string | null {
  const parts = didWebs.split(':');
  if (parts.length >= 3 && parts[0] === 'did' && parts[1] === 'webs') {
    return parts[parts.length - 1];
  }
  return null;
}
