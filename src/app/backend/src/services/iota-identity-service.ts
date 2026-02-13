/**
 * IOTA DID creation and resolution for bidirectional linkage.
 * Must be initialized after the IOTA connector (vault + wallet dependency).
 */

import {
  getIdentityConnector,
  getIdentityResolver,
  getDidExplorerUrl,
} from './identity-connector-setup';
import { setAlsoKnownAs } from './iota-also-known-as';
import { getErrorMessage } from '@gleif/verifier-core';
import { CONTROLLER_IDENTITY } from './config';

/**
 * DID Document interface (W3C compliant)
 */
export interface IotaDidDocument {
  id: string;
  alsoKnownAs?: string | string[];
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string | string[] | Record<string, unknown>;
  }>;
  verificationMethod?: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase?: string;
  }>;
  [key: string]: unknown;
}

/** In-memory cache for resolved DID documents. */
const didCache = new Map<string, IotaDidDocument>();

/**
 * Create a new IOTA DID and publish it on-chain.
 * Controller must have a mnemonic in the vault.
 */
export async function createIotaDid(controller?: string): Promise<{
  did: string;
  document: IotaDidDocument;
}> {
  const connector = getIdentityConnector();
  if (!connector) {
    throw new Error('Identity connector not initialized. Ensure IOTA_MNEMONIC is configured.');
  }

  const actualController = controller || CONTROLLER_IDENTITY;
  console.log(`[iota-identity] Creating DID on IOTA network for controller: ${actualController}`);

  try {
    const didDocument = await connector.createDocument(actualController);

    const did = didDocument.id;
    console.log(`[iota-identity] Created DID on network: ${did}`);
    console.log(`[iota-identity] Explorer: ${getDidExplorerUrl(did)}`);

    const doc = didDocument as unknown as IotaDidDocument;
    didCache.set(did, doc);

    return {
      did,
      document: doc,
    };
  } catch (error) {
    console.error('[iota-identity] Failed to create DID:', error);
    throw error;
  }
}

/** Resolve an IOTA DID document from the network. */
export async function resolveIotaDid(did: string): Promise<IotaDidDocument> {
  console.log(`[iota-identity] Resolving DID: ${did}`);

  const cached = didCache.get(did);
  if (cached) {
    return cached;
  }

  const resolver = getIdentityResolver();
  if (!resolver) {
    throw new Error('Identity resolver not initialized. Ensure IOTA connector is configured.');
  }

  try {
    const document = await resolver.resolveDocument(did);

    const doc = document as unknown as IotaDidDocument;
    didCache.set(did, doc);

    return doc;
  } catch (resolverError: unknown) {
    const message = getErrorMessage(resolverError);
    console.error(`[iota-identity] Network resolution failed: ${message}`);
    throw new Error(`DID not found: ${did}. Network resolution failed: ${message}`);
  }
}

/** Add a service endpoint to an IOTA DID document. */
export async function addServiceToIotaDid(
  controller: string | undefined,
  documentId: string,
  serviceId: string,
  serviceType: string,
  endpoint: string
): Promise<void> {
  const connector = getIdentityConnector();
  if (!connector) {
    throw new Error('Identity connector not initialized');
  }

  const actualController = controller || CONTROLLER_IDENTITY;
  console.log(`[iota-identity] Adding service ${serviceId} to ${documentId}`);

  try {
    // Connector signature: addService(controller, documentId, serviceId, serviceType, serviceEndpoint)
    // Note: connector prepends "${documentId}#" to serviceId, so only pass the fragment part
    await connector.addService(
      actualController,
      documentId,
      serviceId,      // serviceId (fragment only, e.g., "linked-did")
      serviceType,    // serviceType (e.g., "LinkedDomains")
      endpoint        // serviceEndpoint (e.g., "did:webs:...")
    );

    // Invalidate cache - document has changed
    didCache.delete(documentId);

    console.log(`[iota-identity] Service ${serviceId} added successfully`);
  } catch (error) {
    console.error('[iota-identity] Failed to add service:', error);
    throw error;
  }
}

/**
 * Add alsoKnownAs entries to an IOTA DID document.
 * Uses the SDK directly since the connector doesn't expose this method.
 */
export async function addAlsoKnownAsToIotaDid(
  controller: string | undefined,
  documentId: string,
  aliases: string[]
): Promise<void> {
  await setAlsoKnownAs(documentId, aliases, controller || undefined);

  // Invalidate cache - document has changed
  didCache.delete(documentId);
}

/**
 * Extract did:webs from alsoKnownAs in IOTA DID document
 */
export function extractWebsDid(document: IotaDidDocument): string | null {
  const alsoKnownAs = document.alsoKnownAs;

  // Handle string or array of strings
  if (typeof alsoKnownAs === 'string') {
    if (alsoKnownAs.startsWith('did:webs:')) {
      return alsoKnownAs;
    }
  } else if (Array.isArray(alsoKnownAs)) {
    const websDid = alsoKnownAs.find((aka: string) => aka.startsWith('did:webs:'));
    if (websDid) {
      return websDid;
    }
  }

  // Fallback to service endpoints
  return extractWebsDidFromService(document);
}

/** Extract did:webs from service endpoints -- fallback when alsoKnownAs isn't set */
function extractWebsDidFromService(document: IotaDidDocument): string | null {
  const services = document.service;
  if (!services || !Array.isArray(services)) {
    return null;
  }

  // Look for LinkedDomains or similar service type containing did:webs
  for (const service of services) {
    const endpoint = service.serviceEndpoint;

    if (typeof endpoint === 'string' && endpoint.startsWith('did:webs:')) {
      return endpoint;
    }

    if (Array.isArray(endpoint)) {
      const websDid = endpoint.find(
        (e) => typeof e === 'string' && e.startsWith('did:webs:')
      );
      if (websDid && typeof websDid === 'string') {
        return websDid;
      }
    }
  }

  return null;
}

/**
 * Get the configured identity that has a mnemonic in the vault.
 */
export function getConfiguredIdentity(): string {
  return CONTROLLER_IDENTITY;
}
