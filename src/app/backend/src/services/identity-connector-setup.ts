/**
 * IOTA Identity Connector Setup
 *
 * Initializes the TWIN.org Identity connector infrastructure for creating
 * and resolving IOTA DIDs on the network.
 */
import { IotaIdentityConnector } from '@twin.org/identity-connector-iota';
import { IotaIdentityResolverConnector } from '@twin.org/identity-connector-iota';
import { IdentityConnectorFactory, IdentityResolverConnectorFactory } from '@twin.org/identity-models';
import { getEnvConfig } from './config';

/**
 * Mnemonic key name in vault (must match NFT connector)
 */
const MNEMONIC_KEY_NAME = 'mnemonic';

/**
 * Identity connector instance (singleton)
 */
let identityConnector: IotaIdentityConnector | null = null;

/**
 * Identity resolver instance (singleton)
 */
let identityResolver: IotaIdentityResolverConnector | null = null;

/**
 * Whether the connector has been initialized
 */
let isInitialized = false;

/**
 * Initialize identity connector infrastructure.
 * Must be called after initializeNftConnector() -- needs the vault and wallet.
 */
export async function initializeIdentityConnector(identity: string): Promise<boolean> {
  if (isInitialized) {
    console.log('[Identity] Connector already initialized');
    return true;
  }

  try {
    console.log('[Identity] Initializing IOTA Identity connector...');

    const env = getEnvConfig();

    // Create identity connector (uses vault and wallet from NFT setup)
    identityConnector = new IotaIdentityConnector({
      config: {
        clientOptions: { url: env.iotaNodeUrl },
        vaultMnemonicId: MNEMONIC_KEY_NAME,
        network: 'testnet',
        identityPkgId: env.identityPackageId,
      },
    });

    // Register in factory for dependency injection
    IdentityConnectorFactory.register('identity', () => identityConnector!);

    // Create resolver connector (read-only, doesn't need wallet)
    identityResolver = new IotaIdentityResolverConnector({
      config: {
        clientOptions: { url: env.iotaNodeUrl },
        network: 'testnet',
      },
    });

    // Register resolver in factory
    IdentityResolverConnectorFactory.register('identity-resolver', () => identityResolver!);

    console.log('[Identity] Identity connector initialized');
    console.log(`[Identity] Package ID: ${env.identityPackageId}`);
    console.log(`[Identity] Controller identity: ${identity}`);

    isInitialized = true;
    return true;
  } catch (error) {
    console.error('[Identity] Failed to initialize Identity connector:', error);
    isInitialized = false;
    return false;
  }
}

/** Identity connector instance, or null if not initialized. */
export function getIdentityConnector(): IotaIdentityConnector | null {
  return identityConnector;
}

/** Identity resolver instance, or null if not initialized. */
export function getIdentityResolver(): IotaIdentityResolverConnector | null {
  return identityResolver;
}

/** Explorer URL for an IOTA DID. */
export function getDidExplorerUrl(did: string): string {
  // Extract object ID from did:iota:networkId:objectId
  const parts = did.split(':');
  const objectId = parts[parts.length - 1];
  return `https://explorer.iota.org/object/${objectId}?network=testnet`;
}
