/**
 * IOTA Connector Setup
 *
 * Initializes vault + wallet infrastructure for attestation minting
 * and IOTA identity operations.
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
import { nameof } from '@twin.org/nameof';
import { getEnvConfig, MNEMONIC_KEY_NAME } from './config';

let vaultConnector: EntityStorageVaultConnector | null = null;
let walletConnector: IotaWalletConnector | null = null;
let isInitialized = false;
let isDisabled = true;
let storedMnemonic: string | undefined;

/**
 * Initialize vault + wallet infrastructure.
 * Returns false if no mnemonic is configured (minting disabled).
 */
export async function initializeIotaConnector(
  mnemonic: string | undefined,
  identity: string
): Promise<boolean> {
  if (isInitialized) {
    console.log('[IOTA] Connector already initialized');
    return !isDisabled;
  }

  if (!mnemonic) {
    console.warn('[IOTA] NFT_MNEMONIC not set - attestation minting disabled');
    console.warn('[IOTA] To enable minting:');
    console.warn('[IOTA]   1. Generate mnemonic: npx @iota/iota-sdk mnemonics');
    console.warn('[IOTA]   2. Set NFT_MNEMONIC in .env');
    console.warn('[IOTA]   3. Fund wallet via: https://faucet.testnet.iota.cafe/gas');
    isInitialized = true;
    isDisabled = true;
    return false;
  }

  try {
    console.log('[IOTA] Initializing vault + wallet...');

    const env = getEnvConfig();
    storedMnemonic = mnemonic;

    initSchema();

    EntityStorageConnectorFactory.register(
      'vault-key',
      () =>
        new MemoryEntityStorageConnector<VaultKey>({
          entitySchema: nameof<VaultKey>(),
        })
    );

    EntityStorageConnectorFactory.register(
      'vault-secret',
      () =>
        new MemoryEntityStorageConnector<VaultSecret>({
          entitySchema: nameof<VaultSecret>(),
        })
    );

    vaultConnector = new EntityStorageVaultConnector();
    VaultConnectorFactory.register('vault', () => vaultConnector!);

    await vaultConnector.setSecret(`${identity}/${MNEMONIC_KEY_NAME}`, mnemonic);
    console.log(`[IOTA] Mnemonic stored for identity: ${identity}`);

    walletConnector = new IotaWalletConnector({
      config: {
        clientOptions: { url: env.iotaNodeUrl },
        vaultMnemonicId: MNEMONIC_KEY_NAME,
        coinType: 4218,
        network: 'testnet',
      },
    });
    WalletConnectorFactory.register('wallet', () => walletConnector!);

    const addresses = await walletConnector.getAddresses(identity, 0, 0, 1);
    console.log(`[IOTA] Wallet address: ${addresses[0]}`);
    console.log(`[IOTA] Explorer: https://explorer.iota.org/address/${addresses[0]}?network=testnet`);

    isInitialized = true;
    isDisabled = false;
    return true;
  } catch (error) {
    console.error('[IOTA] Failed to initialize:', error);
    console.warn('[IOTA] Attestation minting disabled due to initialization failure');
    isInitialized = true;
    isDisabled = true;
    return false;
  }
}

/** Whether attestation minting is disabled. */
export function isMintingDisabled(): boolean {
  return isDisabled;
}

/** The stored mnemonic (for direct SDK usage). */
export function getMnemonic(): string | undefined {
  return storedMnemonic;
}

/** Explorer URL for an on-chain object. */
export function getExplorerUrl(objectId: string): string {
  return `https://explorer.iota.org/object/${objectId}?network=testnet`;
}
