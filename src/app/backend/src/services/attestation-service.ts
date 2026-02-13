import { IotaClient } from '@iota/iota-sdk/client';
import { Transaction } from '@iota/iota-sdk/transactions';
import { Ed25519Keypair } from '@iota/iota-sdk/keypairs/ed25519';
import {
  isMintingDisabled,
  getMnemonic,
  getExplorerUrl,
} from './iota-connector-setup';
import { getEnvConfig } from './config';
import {
  isoTimestamp,
  buildLinkageVcPayload,
  buildVcJwtHeader,
  encodeVcAsJwt,
  assembleSignedJwt,
  type VerificationResult,
  type NftAttestation,
} from '@gleif/verifier-core';
import { resolveIotaDid } from './iota-identity-service';

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

  try {
    console.log('[Attestation] Minting vLEI attestation on IOTA testnet...');

    const client = new IotaClient({ url: env.iotaNodeUrl });
    const keypair = Ed25519Keypair.deriveKeypair(mnemonic);

    // Build and sign a W3C VC JWT attesting the DID linkage
    let signedVc = '';
    let vcVerificationMethod = '';

    if (effectiveLinkageInfo.didIota) {
      try {
        // Resolve IOTA DID to get the actual verification method ID
        const iotaDoc = await resolveIotaDid(effectiveLinkageInfo.didIota);
        const vm = iotaDoc.verificationMethod?.[0];
        vcVerificationMethod = vm?.id || `${effectiveLinkageInfo.didIota}#key-0`;

        const vcPayload = buildLinkageVcPayload(
          effectiveLinkageInfo.didIota,
          effectiveLinkageInfo.didWebs,
          verificationResult.leLei,
          verificationResult.credentialSaid,
        );
        const vcHeader = buildVcJwtHeader(vcVerificationMethod);
        const unsignedJwt = encodeVcAsJwt(vcHeader, vcPayload);

        const encoder = new TextEncoder();
        const signature = await keypair.sign(encoder.encode(unsignedJwt));
        signedVc = assembleSignedJwt(unsignedJwt, signature);

        console.log('[Attestation] Signed VC JWT created, kid:', vcVerificationMethod);
      } catch (vcError) {
        console.warn('[Attestation] VC signing failed (non-fatal):', vcError);
      }
    }

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
        txb.pure.string(signedVc),
        txb.pure.string(effectiveLinkageInfo.didIota),
        txb.pure.string(vcVerificationMethod),
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
        signedVc: signedVc || undefined,
        vcVerificationMethod: vcVerificationMethod || undefined,
      },
    };
  } catch (error) {
    console.error('[Attestation] Failed to mint:', error);
    throw new Error(`Attestation minting failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
