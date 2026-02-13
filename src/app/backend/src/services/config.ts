import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { TrustAnchorConfig } from '../types/index';
import type { PublicTrustChainConfig, PocBrowserConfig } from '@gleif/verifier-core';

/** Controller identity name for IOTA DID and NFT operations. */
export const CONTROLLER_IDENTITY = process.env.NFT_IDENTITY || 'attestation-service';

/** Vault key name for the mnemonic secret. */
export const MNEMONIC_KEY_NAME = 'mnemonic';

let cachedConfig: TrustAnchorConfig | null = null;

/** Loads trust anchors from disk, caches the result. */
export function loadTrustAnchors(): TrustAnchorConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = process.env.TRUST_ANCHORS_PATH || '../../../scripts/.trust-anchors.json';
  // Resolve relative to the backend directory
  const absolutePath = resolve(process.cwd(), configPath);

  if (!existsSync(absolutePath)) {
    throw new Error(
      `Trust anchors config not found at: ${absolutePath}. ` +
      'Run the setup-trust-anchors.ts script first.'
    );
  }

  try {
    const content = readFileSync(absolutePath, 'utf-8');
    cachedConfig = JSON.parse(content) as TrustAnchorConfig;
    return cachedConfig;
  } catch (error) {
    throw new Error(`Failed to parse trust anchors config: ${error}`);
  }
}

/**
 * Public config for the frontend -- no passcodes or secrets
 */
export function getPublicConfig(): PublicTrustChainConfig {
  const config = loadTrustAnchors();

  // did:webs from LE AID -- backend runs on port 80 internally, no port encoding needed
  const didWebs = `did:webs:backend:keri:${config.le.aid}`;

  return {
    gleif: {
      aid: config.gleif.aid,
      oobi: config.gleif.oobi,
    },
    qvi: {
      aid: config.qvi.aid,
      oobi: config.qvi.oobi,
    },
    le: {
      aid: config.le.aid,
      oobi: config.le.oobi,
      lei: config.le.lei,
      iotaDid: config.le.iotaDid,
      didWebs,
    },
    qviCredential: {
      said: config.qviCredential.said,
    },
    leCredential: {
      said: config.leCredential.said,
    },
    designatedAliasesCredential: config.designatedAliasesCredential ? {
      said: config.designatedAliasesCredential.said,
      linkedDids: config.designatedAliasesCredential.ids,
    } : undefined,
    sally: {
      configured: config.sally.configured &&
                  config.sally.gleifOobiResolved &&
                  config.sally.qviCredentialPreloaded,
    },
  };
}

/**
 * PoC config for the browser -- includes LE passcode and KERIA URLs
 * so the frontend can run signify-ts directly.
 */
export function getPocConfig(): PocBrowserConfig {
  const publicConfig = getPublicConfig();
  const config = loadTrustAnchors();
  const env = getEnvConfig();

  return {
    ...publicConfig,
    poc: {
      lePasscode: config.le.passcode,
      leName: config.le.name,
      keriaUrl: env.keriaBrowserUrl,
      keriaBootUrl: env.keriaBrowserBootUrl,
      sallyAid: config.sally.aid,
      sallyOobi: `${env.sallyUrl}/oobi/${config.sally.aid}/controller`,
      leCredentialSchemaSaid: env.leCredentialSchemaSaid,
      leRegistryId: config.le.registryId || '',
      daCredentialSchemaSaid: env.daCredentialSchemaSaid,
      daCredentialSchemaOobi: `${env.vleiServerUrl}/oobi/${env.daCredentialSchemaSaid}`,
    },
  };
}

export function getEnvConfig() {
  return {
    port: parseInt(process.env.PORT!, 10),
    sallyUrl: process.env.SALLY_URL!,
    iotaNodeUrl: process.env.IOTA_NODE_URL!,
    keriaUrl: process.env.KERIA_URL!,
    keriaBootUrl: process.env.KERIA_BOOT_URL!,
    keriaBrowserUrl: process.env.KERIA_BROWSER_URL || process.env.KERIA_URL!,
    keriaBrowserBootUrl: process.env.KERIA_BROWSER_BOOT_URL || process.env.KERIA_BOOT_URL!,
    // IOTA package IDs (deployed contracts on testnet)
    identityPackageId: process.env.IDENTITY_PACKAGE_ID,
    attestationPackageId: process.env.ATTESTATION_PACKAGE_ID,
    // vLEI schema SAIDs
    leCredentialSchemaSaid: process.env.LE_SCHEMA_SAID!,
    daCredentialSchemaSaid: process.env.DESIGNATED_ALIASES_SCHEMA!,
    // Docker-internal vLEI server -- KERIA resolves OOBIs server-side so this works
    vleiServerUrl: process.env.VLEI_SERVER_URL,
  };
}
