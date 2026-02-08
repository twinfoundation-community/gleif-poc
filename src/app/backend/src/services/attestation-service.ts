import { IotaClient, getFullnodeUrl } from '@iota/iota-sdk/client';
import { Transaction } from '@iota/iota-sdk/transactions';
import { Ed25519Keypair } from '@iota/iota-sdk/keypairs/ed25519';
import {
  isMintingDisabled,
  getMnemonic,
  getExplorerUrl,
} from './iota-connector-setup';
import { createLeClient } from './sally-client';
import { getFullConfig, getEnvConfig } from './config';
import { Cigar, b as signifyBytes } from 'signify-ts';
import {
  isoTimestamp,
  buildLinkageVcPayload,
  buildVcJwtHeader,
  encodeVcAsJwt,
  assembleSignedJwt,
  type VerificationResult,
  type NftAttestation,
} from '@gleif/verifier-core';

const ATTESTATION_MODULE = 'attestation';
const ATTESTATION_FUNCTION = 'mint';

export interface LinkageInfo {
  didWebs: string;
  didIota: string;
}

export interface TrustChainInfo {
  gleifAid: string;
  qviAid: string;
  qviCredentialSaid: string;
}

/**
 * Sign a W3C VC JWT with the LE's KERI key via signify-ts
 */
async function signVcWithLeKey(
  linkageInfo: LinkageInfo,
  lei: string,
  designatedAliasesSaid: string
): Promise<{ jwt: string; verificationMethod: string }> {
  const config = getFullConfig();
  const client = await createLeClient();

  const aidState = await client.identifiers().get(config.le.name);
  const currentKey = aidState.state.k[0];

  const verificationMethod = `${linkageInfo.didWebs}#${currentKey}`;

  const payload = buildLinkageVcPayload(
    linkageInfo.didWebs,
    linkageInfo.didIota,
    lei,
    designatedAliasesSaid
  );
  const header = buildVcJwtHeader(verificationMethod);
  const unsignedJwt = encodeVcAsJwt(header, payload);

  const keeper = client.manager!.get(aidState);
  const sigs = await keeper.sign(signifyBytes(unsignedJwt), false);
  const sigQb64 = (sigs as string[])[0];

  const cigar = new Cigar({ qb64: sigQb64 });
  const signatureBytes = cigar.raw;

  const jwt = assembleSignedJwt(unsignedJwt, signatureBytes);
  console.log(`[Attestation] Signed VC JWT (${jwt.length} chars)`);

  return { jwt, verificationMethod };
}

/**
 * Mint a vLEI attestation on IOTA via the custom Move contract.
 */
export async function mintAttestationNft(
  verificationResult: VerificationResult,
  linkageInfo?: LinkageInfo,
  trustChainInfo?: TrustChainInfo
): Promise<NftAttestation> {
  if (!verificationResult.verified) {
    throw new Error('Cannot mint attestation for failed verification');
  }

  if (isMintingDisabled()) {
    throw new Error('Attestation minting requires NFT_MNEMONIC to be configured.');
  }

  const mnemonic = getMnemonic();
  if (!mnemonic) {
    throw new Error('Mnemonic not available. Ensure NFT_MNEMONIC is set.');
  }

  const env = getEnvConfig();
  const packageId = env.attestationPackageId;
  if (!packageId) {
    throw new Error('ATTESTATION_PACKAGE_ID not set. Deploy the Move contract first.');
  }

  const effectiveLinkageInfo: LinkageInfo = linkageInfo || {
    didWebs: `did:webs:backend:keri:${verificationResult.leAid}`,
    didIota: '',
  };

  const config = getFullConfig();
  const designatedAliasesSaid = config.designatedAliasesCredential?.said || '';
  const signedVc = await signVcWithLeKey(
    effectiveLinkageInfo,
    verificationResult.leLei,
    designatedAliasesSaid
  );

  try {
    console.log('[Attestation] Minting vLEI attestation on IOTA testnet...');

    const client = new IotaClient({ url: env.iotaNodeUrl });
    const keypair = Ed25519Keypair.deriveKeypair(mnemonic);

    const txb = new Transaction();
    txb.moveCall({
      target: `${packageId}::${ATTESTATION_MODULE}::${ATTESTATION_FUNCTION}`,
      arguments: [
        txb.pure.string(effectiveLinkageInfo.didWebs),
        txb.pure.string(effectiveLinkageInfo.didIota),
        txb.pure.string(verificationResult.leLei),
        txb.pure.string(verificationResult.leAid),
        txb.pure.string(verificationResult.credentialSaid),
        txb.pure.string(trustChainInfo?.gleifAid || ''),
        txb.pure.string(trustChainInfo?.qviAid || ''),
        txb.pure.string(trustChainInfo?.qviCredentialSaid || ''),
        txb.pure.u64(Math.floor(Date.now() / 1000)),
        txb.pure.string('TWIN'),
        txb.pure.string(signedVc.jwt),
        txb.pure.string(effectiveLinkageInfo.didWebs),
        txb.pure.string(signedVc.verificationMethod),
      ],
    });

    const result = await client.signAndExecuteTransaction({
      transaction: txb,
      signer: keypair,
      options: { showEffects: true, showObjectChanges: true },
    });

    const created = result.objectChanges?.find(
      (c: { type: string }) => c.type === 'created'
    ) as { objectId: string } | undefined;

    if (!created) {
      throw new Error('No object created in transaction result');
    }

    const objectId = created.objectId;
    const explorerUrl = getExplorerUrl(objectId);

    console.log('[Attestation] Object ID:', objectId);
    console.log('[Attestation] Explorer URL:', explorerUrl);

    return {
      nftId: objectId,
      explorerUrl,
      metadata: {
        didWebs: effectiveLinkageInfo.didWebs,
        didIota: effectiveLinkageInfo.didIota,
        lei: verificationResult.leLei,
        leAid: verificationResult.leAid,
        credentialSaid: verificationResult.credentialSaid,
        gleifAid: trustChainInfo?.gleifAid,
        qviAid: trustChainInfo?.qviAid,
        qviCredentialSaid: trustChainInfo?.qviCredentialSaid,
        verifiedAt: isoTimestamp(),
        verifiedBy: 'TWIN',
        signedVc: signedVc.jwt,
        vcVerificationMethod: signedVc.verificationMethod,
      },
    };
  } catch (error) {
    console.error('[Attestation] Failed to mint:', error);
    throw new Error(`Attestation minting failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
