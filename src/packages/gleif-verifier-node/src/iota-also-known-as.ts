/**
 * Direct IOTA Identity SDK usage for setAlsoKnownAs.
 *
 * WHY THIS EXISTS:
 * The @twin.org/identity-connector-iota connector doesn't expose setAlsoKnownAs(),
 * even though the underlying SDK supports it. This is a workaround.
 *
 * WHEN TO REMOVE:
 * When the connector adds addAlsoKnownAs() or setAlsoKnownAs() -- replace usages
 * of this file and delete it.
 *
 * See: https://www.w3.org/TR/did-core/#also-known-as
 */

import {
  IdentityClient,
  IdentityClientReadOnly,
  IotaDID,
  Jwk,
  JwkMemStore,
  JwkType,
  JwsAlgorithm,
  KeyIdMemStore,
  Storage,
  StorageSigner,
  type IJwkParams,
} from '@iota/identity-wasm/node/index.js';
import { Converter } from '@twin.org/core';
import { Iota, type IIotaConfig } from '@twin.org/dlt-iota';
import { VaultConnectorFactory, type IVaultConnector } from '@twin.org/vault-models';

/** IOTA coin type for BIP44 derivation */
const IOTA_COIN_TYPE = 4218;

/** wallet address index */
const WALLET_ADDRESS_INDEX = 0;

/** gas budget for transactions (1 IOTA) */
const GAS_BUDGET = BigInt(1_000_000_000);

/** config for IOTA alsoKnownAs operations */
export interface IotaAlsoKnownAsConfig {
  iotaNodeUrl: string;
  network: string;
}

/** create IOTA config from the provided params */
function createIotaConfig(config: IotaAlsoKnownAsConfig): IIotaConfig {
  return {
    clientOptions: { url: config.iotaNodeUrl },
    vaultMnemonicId: 'mnemonic',
    network: config.network,
  };
}

/**
 * Create an IOTA Identity client with signing capability.
 * Replicates IotaIdentityConnector.getIdentityClient() -- we need this
 * because the connector doesn't expose what we need directly.
 */
async function createIdentityClient(
  controllerIdentity: string,
  vaultConnector: IVaultConnector,
  config: IotaAlsoKnownAsConfig
): Promise<IdentityClient> {
  const iotaConfig = createIotaConfig(config);

  // Create read-only identity client first
  const iotaClient = Iota.createClient(iotaConfig);
  // cast through unknown -- version mismatch between @iota/iota-sdk types
  const identityClientReadOnly = await IdentityClientReadOnly.create(
    iotaClient as unknown as Parameters<typeof IdentityClientReadOnly.create>[0]
  );

  // Get seed from vault and derive key pair
  const seed = await Iota.getSeed(iotaConfig, vaultConnector, controllerIdentity);
  const keyPair = Iota.getKeyPair(seed, IOTA_COIN_TYPE, 0, WALLET_ADDRESS_INDEX, false);

  // Create JWK storage and signer
  const jwkMemStore = new JwkMemStore();
  const keyIdMemStore = new KeyIdMemStore();
  const storage = new Storage(jwkMemStore, keyIdMemStore);

  const jwkParams: IJwkParams = {
    kty: JwkType.Okp,
    crv: 'Ed25519',
    alg: JwsAlgorithm.EdDSA,
    x: Converter.bytesToBase64Url(keyPair.publicKey),
    d: Converter.bytesToBase64Url(keyPair.privateKey),
  };

  const jwk = new Jwk(jwkParams);
  const publicKeyJwk = jwk.toPublic();
  if (!publicKeyJwk) {
    throw new Error('Failed to derive public key from JWK');
  }

  const keyId = await jwkMemStore.insert(jwk);
  const signer = new StorageSigner(storage, keyId, publicKeyJwk);

  return IdentityClient.create(identityClientReadOnly, signer);
}

/**
 * Set alsoKnownAs on an IOTA DID document -- the W3C way to establish
 * bidirectional DID linkage.
 *
 * @example
 * await setAlsoKnownAs(
 *   'did:iota:testnet:0x123...',
 *   ['did:webs:example.com:keri:ABC123'],
 *   vaultConnector,
 *   'attestation-service',
 *   { iotaNodeUrl: 'https://api.testnet.iotaledger.net', network: 'testnet' }
 * );
 */
export async function setAlsoKnownAs(
  documentId: string,
  aliases: string[],
  vaultConnector: IVaultConnector,
  controllerIdentity: string,
  config: IotaAlsoKnownAsConfig
): Promise<void> {
  console.log(`[iota-also-known-as] Setting alsoKnownAs on ${documentId}`);

  try {
    // Create identity client with signing capability
    const identityClient = await createIdentityClient(controllerIdentity, vaultConnector, config);

    // Parse and resolve the DID
    const did = IotaDID.parse(documentId);
    const document = await identityClient.resolveDid(did);

    if (!document) {
      throw new Error(`DID document not found: ${documentId}`);
    }

    // extract object ID from DID -- format: did:iota:testnet:0x...
    const didParts = documentId.split(':');
    const objectId = didParts[didParts.length - 1];

    // Get the on-chain identity for updates
    const identity = await identityClient.getIdentity(objectId);
    const identityOnChain = identity.toFullFledged();

    if (!identityOnChain) {
      throw new Error(`On-chain identity not found for: ${documentId}`);
    }

    // set alsoKnownAs -- the W3C DID Core way
    document.setAlsoKnownAs(aliases);

    // Get controller token for authorization
    const controllerToken = await identityOnChain.getControllerToken(identityClient);

    if (!controllerToken) {
      throw new Error('Failed to get controller token for document update');
    }

    // execute update on-chain (pattern from IotaIdentityConnector.executeDocumentUpdate())
    const updateBuilder = identityOnChain
      .updateDidDocument(document.clone(), controllerToken)
      .withGasBudget(GAS_BUDGET);

    await updateBuilder.buildAndExecute(identityClient);

    console.log(`[iota-also-known-as] Successfully set alsoKnownAs on ${documentId}`);
  } catch (error) {
    console.error('[iota-also-known-as] Failed to set alsoKnownAs:', error);
    throw error;
  }
}
