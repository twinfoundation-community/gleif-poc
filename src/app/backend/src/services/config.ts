import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { TrustAnchorConfig } from '../types/index';
import type { PublicTrustChainConfig } from '@gleif/verifier-core';

let cachedConfig: TrustAnchorConfig | null = null;

/**
 * Load and parse the trust anchors configuration file
 */
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
 * Get the full config (internal use only)
 */
export function getFullConfig(): TrustAnchorConfig {
  return loadTrustAnchors();
}

/**
 * Get environment configuration
 */
export function getEnvConfig() {
  return {
    port: parseInt(process.env.PORT || '3000', 10),
    sallyUrl: process.env.SALLY_URL || 'http://localhost:9823',
    iotaNodeUrl: process.env.IOTA_NODE_URL || 'https://api.testnet.iota.cafe',
    keriaUrl: process.env.KERIA_URL || 'http://localhost:3901',
    keriaBootUrl: process.env.KERIA_BOOT_URL || 'http://localhost:3903',
    // IOTA package IDs (deployed contracts on testnet)
    identityPackageId: process.env.IDENTITY_PACKAGE_ID || '0x222741bbdff74b42df48a7b4733185e9b24becb8ccfbafe8eac864ab4e4cc555',
    nftPackageId: process.env.NFT_PACKAGE_ID || '0x5284a202f337621bb5fa4c216b45aaa6ef583acd712d5026829528e30c3199b9',
    // vLEI schema SAIDs
    leCredentialSchemaSaid: process.env.LE_SCHEMA_SAID || 'ENPXp1vQzRF6JwIuS-mp2U8Uf1MoADoP_GqQ62VsDZWY',
  };
}
