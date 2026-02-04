import {
  ready,
  SignifyClient,
  Tier,
  Serder,
} from 'signify-ts';
import { getFullConfig, getEnvConfig } from './config';
import { registerPendingVerification } from './verification-state';
import { isoTimestamp, keriTimestamp, getErrorMessage, type VerificationResult } from '@gleif/verifier-core';
import type { KeriCredential, KeriOperation } from '../types/index';

let signifyReady = false;

/**
 * Initialize signify-ts WebAssembly
 */
async function ensureSignifyReady(): Promise<void> {
  if (!signifyReady) {
    await ready();
    signifyReady = true;
  }
}

/**
 * Create a SignifyClient for the LE
 */
export async function createLeClient(): Promise<SignifyClient> {
  await ensureSignifyReady();

  const config = getFullConfig();
  const env = getEnvConfig();

  // Pad passcode to 21 characters as required by signify-ts
  const paddedPasscode = config.le.passcode.padEnd(21, '_');

  const client = new SignifyClient(
    env.keriaUrl,
    paddedPasscode,
    Tier.low,
    env.keriaBootUrl
  );

  try {
    await client.connect();
  } catch (error) {
    // If connect fails, the agent might not exist yet
    // For PoC, we assume setup-trust-anchors was already run
    throw new Error(`Failed to connect to KERIA as LE: ${error}`);
  }

  return client;
}

/**
 * Wait for an operation to complete
 */
async function waitOperation(
  client: SignifyClient,
  op: KeriOperation,
  timeoutMs: number = 30000
): Promise<KeriOperation> {
  const result = await client
    .operations()
    .wait(op, { signal: AbortSignal.timeout(timeoutMs) }) as KeriOperation;

  // Clean up completed operation
  if (result.metadata?.depends) {
    await client.operations().delete(result.metadata.depends.name).catch(() => {});
  }
  await client.operations().delete(result.name).catch(() => {});

  return result;
}

// Using keriTimestamp from utils for KERI microsecond precision

/**
 * Get the LE credential from KERIA
 */
async function getLeCredential(client: SignifyClient): Promise<KeriCredential> {
  const config = getFullConfig();
  const env = getEnvConfig();

  // Query all credentials and filter manually (KERIA API has issues with combined filters)
  const allCredentials = await client.credentials().list() as KeriCredential[];
  const credentials = allCredentials.filter(
    (c) => c.sad.s === env.leCredentialSchemaSaid && c.sad.a?.i === config.le.aid
  );

  if (credentials.length === 0) {
    throw new Error('LE credential not found. Ensure setup-trust-anchors.ts was run.');
  }

  return credentials[0];
}

/**
 * Verify the LE credential by presenting it to Sally via IPEX.
 *
 * Connects to KERIA as LE, resolves Sally's OOBI, registers a pending
 * verification, sends an IPEX grant, then waits for Sally's webhook callback.
 */
export async function verifyLeCredential(): Promise<VerificationResult> {
  const config = getFullConfig();

  // Check if Sally is configured
  if (!config.sally.configured) {
    throw new Error('Sally is not configured. Ensure setup-trust-anchors.ts completed successfully.');
  }

  let client: SignifyClient | null = null;

  try {
    // Create client as LE
    client = await createLeClient();

    // Get the LE credential
    const credential = await getLeCredential(client);
    const credentialSaid = credential.sad.d;

    console.log(`Verifying credential: ${credentialSaid}`);

    // Resolve Sally's OOBI if needed (LE needs to know Sally)
    const sallyOobi = `${getEnvConfig().sallyUrl}/oobi/${config.sally.aid}/controller`;
    try {
      const oobiOp = await client.oobis().resolve(sallyOobi, 'sally');
      await waitOperation(client, oobiOp);
    } catch (error) {
      // OOBI might already be resolved - continue
      console.log('Sally OOBI resolution:', error);
    }

    // Register pending verification BEFORE submitting the grant
    // This ensures we capture the webhook callback
    const verificationPromise = registerPendingVerification(
      credentialSaid,
      config.le.aid,
      config.le.lei
    );

    // Present the credential to Sally via IPEX grant
    // Sally is configured to verify credentials and respond via webhook
    const grantTime = keriTimestamp();

    const [grant, gsigs, gend] = await client.ipex().grant({
      senderName: config.le.name,
      acdc: new Serder(credential.sad),
      anc: new Serder(credential.anc),
      iss: new Serder(credential.iss),
      recipient: config.sally.aid,
      datetime: grantTime,
    });

    console.log('Submitting IPEX grant to Sally...');

    const grantOp = await client
      .ipex()
      .submitGrant(config.le.name, grant, gsigs, gend, [config.sally.aid]);

    await waitOperation(client, grantOp);

    console.log('IPEX grant submitted, waiting for Sally webhook...');

    // Wait for Sally's webhook callback with the verification result
    // This will timeout after 30 seconds if no response is received
    const result = await verificationPromise;

    console.log(`Verification complete: verified=${result.verified}, revoked=${result.revoked}`);

    return result;
  } catch (error: unknown) {
    console.error('Verification error:', error);

    return {
      verified: false,
      revoked: false,
      leAid: config.le.aid,
      leLei: config.le.lei,
      credentialSaid: config.leCredential.said,
      timestamp: isoTimestamp(),
      error: getErrorMessage(error),
    };
  }
}

/**
 * Check Sally's health/status
 */
export async function checkSallyStatus(): Promise<boolean> {
  try {
    const response = await fetch(`${getEnvConfig().sallyUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
