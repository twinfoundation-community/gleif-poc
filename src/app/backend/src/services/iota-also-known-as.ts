/**
 * IOTA alsoKnownAs Service
 *
 * Wraps @gleif/verifier-node's IOTA Identity functionality for the POC.
 * Gets config from environment and uses the registered vault connector.
 */

import {
  setAlsoKnownAs as setAlsoKnownAsCore,
  type IotaAlsoKnownAsConfig,
} from '@gleif/verifier-node';
import { VaultConnectorFactory } from '@twin.org/vault-models';
import { getEnvConfig, CONTROLLER_IDENTITY } from './config';

/**
 * Get IOTA config from environment
 */
function getIotaConfig(): IotaAlsoKnownAsConfig {
  const env = getEnvConfig();
  return {
    iotaNodeUrl: env.iotaNodeUrl,
    network: 'testnet',
  };
}

/**
 * Set alsoKnownAs on an IOTA DID document -- the W3C DID Core way
 * to establish bidirectional DID linkage.
 *
 * @example
 * await setAlsoKnownAs(
 *   'did:iota:testnet:0x123...',
 *   ['did:webs:example.com:keri:ABC123']
 * );
 */
export async function setAlsoKnownAs(
  documentId: string,
  aliases: string[],
  controller?: string
): Promise<void> {
  const actualController = controller || CONTROLLER_IDENTITY;
  const config = getIotaConfig();
  const vaultConnector = VaultConnectorFactory.get('vault');

  return setAlsoKnownAsCore(
    documentId,
    aliases,
    vaultConnector,
    actualController,
    config
  );
}
