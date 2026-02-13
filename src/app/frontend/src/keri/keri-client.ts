/**
 * Browser-side KERI client -- runs signify-ts directly in the browser.
 *
 * Each step is an individually callable function so the wizard UI can
 * walk the user through the flow one step at a time.
 *
 * In production, the passcode is something the user provides -- it never
 * leaves their device.
 */

import {
  ready,
  SignifyClient,
  Tier,
  Serder,
  Saider,
} from 'signify-ts';
import {
  keriTimestamp,
  isoTimestamp,
  buildWebsDidDocument,
  paddedSignifyPasscode,
  type VerificationResult,
  type PocBrowserConfig,
  type KeriCredential,
  type KeriOperation,
  type KeriKeyState,
} from '@gleif/verifier-core';

import { API_BASE } from '../api/client';

let signifyReady = false;
let cachedConfig: PocBrowserConfig | null = null;

/** Initialize signify-ts WASM -- call once */
async function ensureSignifyReady(): Promise<void> {
  if (!signifyReady) {
    await ready();
    signifyReady = true;
  }
}

/** Wait for a KERI operation to complete, then clean up */
async function waitOperation(
  client: SignifyClient,
  op: KeriOperation,
  timeoutMs: number = 30000,
): Promise<KeriOperation> {
  const result = await client
    .operations()
    .wait(op, { signal: AbortSignal.timeout(timeoutMs) }) as KeriOperation;

  if (result.metadata?.depends) {
    await client.operations().delete(result.metadata.depends.name).catch(() => {});
  }
  await client.operations().delete(result.name).catch(() => {});

  return result;
}

// ---------------------------------------------------------------------------
// Step 1: Fetch config
// ---------------------------------------------------------------------------

export interface ConfigResult {
  config: PocBrowserConfig;
}

/** Fetch PoC config from backend (includes LE passcode, KERIA URLs, etc.) */
export async function stepFetchConfig(): Promise<ConfigResult> {
  if (cachedConfig) return { config: cachedConfig };

  const response = await fetch(`${API_BASE}/api/poc-config`);
  if (!response.ok) {
    throw new Error(`Failed to fetch PoC config: ${response.statusText}`);
  }
  cachedConfig = await response.json();
  return { config: cachedConfig! };
}

// ---------------------------------------------------------------------------
// Step 2: Connect to KERIA
// ---------------------------------------------------------------------------

export interface ConnectResult {
  client: SignifyClient;
  agentPrefix: string;
}

/** Create and connect a SignifyClient for the LE */
export async function stepConnectToKeria(config: PocBrowserConfig): Promise<ConnectResult> {
  await ensureSignifyReady();

  const paddedPasscode = paddedSignifyPasscode(config.poc.lePasscode);
  const client = new SignifyClient(
    config.poc.keriaUrl,
    paddedPasscode,
    Tier.low,
    config.poc.keriaBootUrl,
  );

  await client.connect();

  // Get the agent's AID prefix for display
  const state = await client.state();
  const agentPrefix = (state as { controller?: { state?: { i?: string } } })
    ?.controller?.state?.i || config.le.aid;

  return { client, agentPrefix };
}

// ---------------------------------------------------------------------------
// Step 3: Load LE Credential
// ---------------------------------------------------------------------------

export interface CredentialResult {
  credential: KeriCredential;
  said: string;
  schema: string;
  issuer: string;
}

/** Get the LE credential from KERIA */
export async function stepLoadLeCredential(
  client: SignifyClient,
  config: PocBrowserConfig,
): Promise<CredentialResult> {
  const allCredentials = await client.credentials().list() as KeriCredential[];
  const credentials = allCredentials.filter(
    (c) => c.sad.s === config.poc.leCredentialSchemaSaid && c.sad.a?.i === config.le.aid,
  );

  if (credentials.length === 0) {
    throw new Error('LE credential not found. Ensure setup-trust-anchors was run.');
  }

  const credential = credentials[0];
  return {
    credential,
    said: credential.sad.d,
    schema: credential.sad.s,
    issuer: credential.sad.i,
  };
}

// ---------------------------------------------------------------------------
// Step 4: Issue Designated Aliases credential
// ---------------------------------------------------------------------------

export interface DaResult {
  said: string;
  linkedDids: string[];
  registryId: string;
  published: boolean;
}

/**
 * Issue the Designated Aliases credential -- self-issued by the LE to declare
 * which DIDs are aliases for the same entity (did:webs <-> did:iota).
 *
 * If a DA credential already exists, returns it without re-issuing.
 */
export async function stepIssueDesignatedAliases(
  client: SignifyClient,
  config: PocBrowserConfig,
): Promise<DaResult> {
  const lePrefix = config.le.aid;
  const daSchemaSaid = config.poc.daCredentialSchemaSaid;

  if (!daSchemaSaid) {
    throw new Error('Missing daCredentialSchemaSaid in config. Restart the backend to pick up the new config fields.');
  }

  // Collect linked DIDs from config
  const linkedDids: string[] = [];
  if (config.le.didWebs) linkedDids.push(config.le.didWebs);
  if (config.le.iotaDid) linkedDids.push(config.le.iotaDid);

  if (linkedDids.length === 0) {
    throw new Error('No linked DIDs found in config (didWebs / iotaDid). Run setup-trust-anchors first.');
  }

  // Ensure registry exists
  let registryId = config.poc.leRegistryId;

  if (!registryId) {
    // Create registry if not present (shouldn't happen if setup ran, but handle it)
    const registries = await client.registries().list(config.poc.leName) as { name: string; regk: string }[];
    const existing = registries.find((r) => r.name === 'le-registry');

    if (existing) {
      registryId = existing.regk;
    } else {
      const regResult = await client.registries().create({
        name: config.poc.leName,
        registryName: 'le-registry',
      });
      await waitOperation(client, await regResult.op(), 60000);

      const newRegistries = await client.registries().list(config.poc.leName) as { name: string; regk: string }[];
      const newReg = newRegistries.find((r) => r.name === 'le-registry');
      if (!newReg) throw new Error('Failed to create LE registry');
      registryId = newReg.regk;
    }
  }

  // Resolve DA schema OOBI (no-op if already resolved, needed for issuance)
  if (config.poc.daCredentialSchemaOobi) {
    try {
      const oobiOp = await client.oobis().resolve(config.poc.daCredentialSchemaOobi, 'da-schema');
      await waitOperation(client, oobiOp);
    } catch {
      // May already be resolved
      console.log('[keri-client] DA schema OOBI resolution skipped (likely already resolved)');
    }
  }

  // Pre-compute rules SAID -- signify-ts saidifies `a` but not `r` in credentials().issue()
  const [, saidifiedRules] = Saider.saidify({
    d: '',
    aliasDesignation: {
      l: "The issuer of this ACDC designates the identifiers in the ids field as the only allowed namespaced aliases of the issuer's AID.",
    },
    usageDisclaimer: {
      l: 'This attestation only asserts designated aliases of the controller of the AID, that the AID controlled namespaced alias has been designated by the controller. It does not assert that the controller of this AID has control over the infrastructure or anything else related to the namespace other than the included AID.',
    },
    issuanceDisclaimer: {
      l: 'All information in a valid and non-revoked alias designation assertion is accurate as of the date specified.',
    },
    termsOfUse: {
      l: 'Designated aliases of the AID must only be used in a manner consistent with the expressed intent of the AID controller.',
    },
  });

  // Issue DA credential
  const credData = {
    i: lePrefix,
    ri: registryId,
    s: daSchemaSaid,
    a: {
      dt: keriTimestamp(),
      ids: linkedDids,
    },
    r: saidifiedRules,
  };

  const credResult = await client.credentials().issue(config.poc.leName, credData);
  await waitOperation(client, credResult.op, 60000);

  // Give KERIA a moment to index the new credential
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Fetch back to get the SAID
  const updatedCredentials = await client.credentials().list() as KeriCredential[];
  const issued = updatedCredentials.find(
    (c) => c.sad.s === daSchemaSaid && c.sad.i === lePrefix,
  );

  if (!issued) {
    throw new Error('DA credential issuance succeeded but credential not found after indexing');
  }

  // Publish DID document + DA CESR to backend so it can serve them for did:webs resolution.
  // The browser owns the LE passcode -- the backend no longer connects to KERIA for the LE.
  let published = false;
  try {
    // Parse domain/path from config's didWebs (e.g. "did:webs:backend:keri:EAID...")
    const didWebsParts = (config.le.didWebs || '').split(':');
    const domain = didWebsParts[2] || 'localhost';
    // Path segments sit between domain and AID (last element)
    const pathSegments = didWebsParts.slice(3, -1);
    const path = pathSegments.length > 0 ? pathSegments.join(':') : undefined;

    const keyStates = await client.keyStates().get(lePrefix) as KeriKeyState[];
    if (!keyStates || keyStates.length === 0) {
      throw new Error('No key state found for LE AID');
    }

    const didDocument = buildWebsDidDocument({
      aid: lePrefix,
      keyState: keyStates[0],
      domain,
      path,
      alsoKnownAs: linkedDids,
    });

    // Fetch DA credential CESR
    let daCesr: string | undefined;
    try {
      const cesrResult = await client.credentials().get(issued.sad.d, true);
      if (typeof cesrResult === 'string' && cesrResult.length > 0) {
        daCesr = cesrResult;
      }
    } catch {
      console.log('[keri-client] Could not fetch DA CESR -- publishing without it');
    }

    const response = await fetch(`${API_BASE}/keri/${lePrefix}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ didDocument, daCesr }),
    });

    published = response.ok;
    if (!published) {
      console.warn('[keri-client] Failed to publish DID data:', response.statusText);
    }
  } catch (err) {
    console.warn('[keri-client] DID publishing failed (non-fatal):', err);
  }

  return {
    said: issued.sad.d,
    linkedDids,
    registryId,
    published,
  };
}

// ---------------------------------------------------------------------------
// Step 5: Resolve Sally OOBI
// ---------------------------------------------------------------------------

export interface OobiResult {
  sallyAid: string;
}

/** Resolve Sally's OOBI through KERIA */
export async function stepResolveSallyOobi(
  client: SignifyClient,
  config: PocBrowserConfig,
): Promise<OobiResult> {
  try {
    const oobiOp = await client.oobis().resolve(config.poc.sallyOobi, 'sally');
    await waitOperation(client, oobiOp);
  } catch (error) {
    // OOBI might already be resolved
    console.log('[keri-client] Sally OOBI resolution:', error);
  }

  return { sallyAid: config.poc.sallyAid };
}

// ---------------------------------------------------------------------------
// Step 6: Present LE Credential to Sally (IPEX grant)
// ---------------------------------------------------------------------------

export interface GrantResult {
  credentialSaid: string;
}

/** Present the LE credential to Sally via IPEX grant */
export async function stepPresentToSally(
  client: SignifyClient,
  config: PocBrowserConfig,
  credential: KeriCredential,
): Promise<GrantResult> {
  const grantTime = keriTimestamp();

  const [grant, gsigs, gend] = await client.ipex().grant({
    senderName: config.poc.leName,
    acdc: new Serder(credential.sad),
    anc: new Serder(credential.anc),
    iss: new Serder(credential.iss),
    recipient: config.poc.sallyAid,
    datetime: grantTime,
  });

  const grantOp = await client
    .ipex()
    .submitGrant(config.poc.leName, grant, gsigs, gend, [config.poc.sallyAid]);

  await waitOperation(client, grantOp);

  return { credentialSaid: credential.sad.d };
}

// ---------------------------------------------------------------------------
// Step 7: Await verification result
// ---------------------------------------------------------------------------

/** Poll backend for Sally's verification result */
export async function stepAwaitVerification(
  credentialSaid: string,
  timeoutMs: number = 30000,
  intervalMs: number = 1000,
): Promise<VerificationResult> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(
      `${API_BASE}/api/verification-status/${encodeURIComponent(credentialSaid)}`,
    );
    const data = await response.json();

    if (!data.pending && data.result) {
      return data.result as VerificationResult;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return {
    verified: false,
    revoked: false,
    leAid: '',
    leLei: '',
    credentialSaid,
    timestamp: isoTimestamp(),
    error: `Verification timeout -- no response from Sally within ${timeoutMs / 1000}s`,
  };
}
