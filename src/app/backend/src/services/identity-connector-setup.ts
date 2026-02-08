/**
 * Initializes TWIN.org Identity connector for creating and resolving IOTA DIDs.
 */
import { IotaIdentityConnector } from '@twin.org/identity-connector-iota';
import { IotaIdentityResolverConnector } from '@twin.org/identity-connector-iota';
import { IdentityConnectorFactory, IdentityResolverConnectorFactory } from '@twin.org/identity-models';
import { getEnvConfig } from './config';

/** Must match the key name used in iota-connector-setup. */
const MNEMONIC_KEY_NAME = 'mnemonic';

let identityConnector: IotaIdentityConnector | null = null;
let identityResolver: IotaIdentityResolverConnector | null = null;
let isInitialized = false;

/**
 * Initialize identity connector infrastructure.
 * Must be called after initializeIotaConnector() -- needs the vault and wallet.
 */
export async function initializeIdentityConnector(identity: string): Promise<boolean> {
  if (isInitialized) {
    console.log('[Identity] Connector already initialized');
    return true;
  }

  try {
    console.log('[Identity] Initializing IOTA Identity connector...');

    const env = getEnvConfig();

    identityConnector = new IotaIdentityConnector({
      config: {
        clientOptions: { url: env.iotaNodeUrl },
        vaultMnemonicId: MNEMONIC_KEY_NAME,
        network: 'testnet',
        identityPkgId: env.identityPackageId,
      },
    });

    IdentityConnectorFactory.register('identity', () => identityConnector!);

    // Resolver is read-only -- doesn't need wallet
    identityResolver = new IotaIdentityResolverConnector({
      config: {
        clientOptions: { url: env.iotaNodeUrl },
        network: 'testnet',
      },
    });

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
