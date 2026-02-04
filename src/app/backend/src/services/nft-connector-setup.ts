/**
 * NFT Connector Setup
 *
 * Initializes the TWIN.org NFT connector infrastructure for minting
 * attestation NFTs on IOTA testnet.
 */
import { MemoryEntityStorageConnector } from '@twin.org/entity-storage-connector-memory';
import { EntityStorageConnectorFactory } from '@twin.org/entity-storage-models';
import {
  EntityStorageVaultConnector,
  initSchema,
  type VaultKey,
  type VaultSecret,
} from '@twin.org/vault-connector-entity-storage';
import { VaultConnectorFactory } from '@twin.org/vault-models';
import { IotaWalletConnector } from '@twin.org/wallet-connector-iota';
import { WalletConnectorFactory } from '@twin.org/wallet-models';
import { IotaNftConnector } from '@twin.org/nft-connector-iota';
import { nameof } from '@twin.org/nameof';
import { getEnvConfig } from './config';

/**
 * Mnemonic key name in vault
 */
const MNEMONIC_KEY_NAME = 'mnemonic';

/**
 * NFT Connector instance (singleton)
 */
let nftConnector: IotaNftConnector | null = null;

/**
 * Vault connector instance (singleton)
 */
let vaultConnector: EntityStorageVaultConnector | null = null;

/**
 * Wallet connector instance (singleton)
 */
let walletConnector: IotaWalletConnector | null = null;

/**
 * Whether the connector has been initialized
 */
let isInitialized = false;

/**
 * Whether NFT minting is disabled (no mnemonic configured)
 */
let isDisabled = true;

/**
 * Initialize the NFT connector infrastructure.
 * Sets up vault storage, wallet, and NFT connector.
 * Returns false if no mnemonic is configured (minting disabled).
 */
export async function initializeNftConnector(
  mnemonic: string | undefined,
  identity: string
): Promise<boolean> {
  if (isInitialized) {
    console.log('[NFT] Connector already initialized');
    return !isDisabled;
  }

  if (!mnemonic) {
    console.warn('[NFT] NFT_MNEMONIC not set - NFT minting disabled');
    console.warn('[NFT] To enable NFT minting:');
    console.warn('[NFT]   1. Generate mnemonic: npx @iota/iota-sdk mnemonics');
    console.warn('[NFT]   2. Set NFT_MNEMONIC in .env');
    console.warn('[NFT]   3. Fund wallet via: https://faucet.testnet.iota.cafe/gas');
    isInitialized = true;
    isDisabled = true;
    return false;
  }

  try {
    console.log('[NFT] Initializing IOTA NFT connector...');

    const env = getEnvConfig();

    // Initialize vault schema
    initSchema();

    // Setup entity storage for vault keys
    EntityStorageConnectorFactory.register(
      'vault-key',
      () =>
        new MemoryEntityStorageConnector<VaultKey>({
          entitySchema: nameof<VaultKey>(),
        })
    );

    // Setup entity storage for vault secrets
    EntityStorageConnectorFactory.register(
      'vault-secret',
      () =>
        new MemoryEntityStorageConnector<VaultSecret>({
          entitySchema: nameof<VaultSecret>(),
        })
    );

    // Create and register vault connector
    vaultConnector = new EntityStorageVaultConnector();
    VaultConnectorFactory.register('vault', () => vaultConnector!);

    // Store mnemonic in vault
    await vaultConnector.setSecret(`${identity}/${MNEMONIC_KEY_NAME}`, mnemonic);
    console.log(`[NFT] Mnemonic stored for identity: ${identity}`);

    // Create and register wallet connector
    walletConnector = new IotaWalletConnector({
      config: {
        clientOptions: { url: env.iotaNodeUrl },
        vaultMnemonicId: MNEMONIC_KEY_NAME,
        coinType: 4218, // IOTA coin type for BIP44
        network: 'testnet',
      },
    });
    WalletConnectorFactory.register('wallet', () => walletConnector!);

    // Get wallet address for logging
    const addresses = await walletConnector.getAddresses(identity, 0, 0, 1);
    console.log(`[NFT] Wallet address: ${addresses[0]}`);
    console.log(`[NFT] Explorer: https://explorer.iota.org/address/${addresses[0]}?network=testnet`);

    // pre-deployed contract -- type assertion because we don't need packageBytecode
    const deploymentConfig = {
      testnet: {
        packageId: env.nftPackageId,
        deployedPackageId: env.nftPackageId,
        packageBytecode: '', // Not needed for pre-deployed contract
        upgradeCapabilityId: '',
        migrationStateId: '',
      },
    } as const;

    nftConnector = new IotaNftConnector({
      config: {
        clientOptions: { url: env.iotaNodeUrl },
        vaultMnemonicId: MNEMONIC_KEY_NAME,
        network: 'testnet',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deploymentConfig: deploymentConfig as any,
    });

    // Start the connector (validates package exists on network)
    await nftConnector.start();
    console.log('[NFT] NFT connector started successfully');
    console.log(`[NFT] Package ID: ${env.nftPackageId}`);

    isInitialized = true;
    isDisabled = false;
    return true;
  } catch (error) {
    console.error('[NFT] Failed to initialize NFT connector:', error);
    console.warn('[NFT] NFT minting disabled due to initialization failure');
    isInitialized = true;
    isDisabled = true;
    return false;
  }
}

/** NFT connector instance, or null if disabled. */
export function getNftConnector(): IotaNftConnector | null {
  return nftConnector;
}

/** Whether NFT minting is disabled. */
export function isNftDisabled(): boolean {
  return isDisabled;
}

/** Explorer URL for an NFT object. */
export function getExplorerUrl(objectId: string): string {
  return `https://explorer.iota.org/object/${objectId}?network=testnet`;
}

/**
 * Extract object ID from an NFT URN.
 * Format: urn:nft:iota:testnet:{packageId}:{objectId}
 */
export function parseObjectIdFromUrn(nftUrn: string): string {
  const parts = nftUrn.split(':');
  return parts[parts.length - 1];
}
