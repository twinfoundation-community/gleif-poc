import {
  getNftConnector,
  isNftDisabled,
  getExplorerUrl,
  parseObjectIdFromUrn,
} from './nft-connector-setup';
import { createLeClient } from './sally-client';
import { getFullConfig } from './config';
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

/**
 * IRC27 NFT Metadata (IOTA TIP-0027)
 * On IOTA Rebased (Move), this lives as JSON in the Move object's immutable_metadata.
 */
interface IRC27Metadata {
  standard: 'IRC27';
  version: 'v1.0';
  type: string;
  uri: string;
  name: string;
  collectionName: string;
  issuerName: string;
  description: string;
  attributes: Array<{ trait_type: string; value: string }>;
}

/** Mutable metadata -- can be updated, e.g. to mark as revoked */
interface AttestationMutableMetadata {
  status: 'active' | 'revoked';
  lastVerified: string;
}

/**
 * Linkage information for the attestation
 */
export interface LinkageInfo {
  didWebs: string;
  didIota: string;
}

/**
 * Trust chain information
 */
export interface TrustChainInfo {
  gleifAid: string;
  qviAid: string;
  qviCredentialSaid: string;
}

/**
 * NFT Identity for the attestation service
 */
const NFT_IDENTITY = process.env.NFT_IDENTITY || 'attestation-service';

/**
 * Collection name for all TWIN-GLEIF attestations
 */
const COLLECTION_NAME = 'TWIN-GLEIF-Attestations';

/**
 * Build IRC27 compliant metadata for the attestation NFT
 */
function buildIRC27Metadata(
  verificationResult: VerificationResult,
  linkageInfo: LinkageInfo,
  trustChainInfo?: TrustChainInfo,
  signedVc?: { jwt: string; verificationMethod: string }
): IRC27Metadata {
  const attributes: Array<{ trait_type: string; value: string }> = [
    // The linkage being attested (most important)
    { trait_type: 'did:webs', value: linkageInfo.didWebs },
    { trait_type: 'did:iota', value: linkageInfo.didIota },

    // The verified entity
    { trait_type: 'leAid', value: verificationResult.leAid },
    { trait_type: 'leLei', value: verificationResult.leLei },
    { trait_type: 'leCredentialSaid', value: verificationResult.credentialSaid },

    // Trust chain
    { trait_type: 'gleifAid', value: trustChainInfo?.gleifAid || '' },
    { trait_type: 'qviAid', value: trustChainInfo?.qviAid || '' },
    { trait_type: 'qviCredentialSaid', value: trustChainInfo?.qviCredentialSaid || '' },

    // Attestation metadata
    { trait_type: 'attestationType', value: 'vLEI-IOTA-Linkage' },
    { trait_type: 'attestationVersion', value: '1.0.0' },
    { trait_type: 'verifiedAt', value: verificationResult.timestamp },
    { trait_type: 'verifiedBy', value: 'TWIN' },
  ];

  // Signed W3C VC (if available)
  if (signedVc) {
    attributes.push(
      { trait_type: 'signedVc', value: signedVc.jwt },
      { trait_type: 'vcIssuer', value: linkageInfo.didWebs },
      { trait_type: 'vcVerificationMethod', value: signedVc.verificationMethod },
    );
  }

  return {
    standard: 'IRC27',
    version: 'v1.0',
    type: 'application/json',
    uri: '', // No external URI - all data is on-chain in attributes
    name: `vLEI Linkage: ${verificationResult.leLei}`,
    collectionName: COLLECTION_NAME,
    issuerName: 'TWIN',
    description: `Attestation that Legal Entity (LEI: ${verificationResult.leLei}) has a verified vLEI credential linked to IOTA DID. Bidirectional linkage between ${linkageInfo.didWebs} and ${linkageInfo.didIota}.`,
    attributes,
  };
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

  // Get the LE's AID state to find the current signing key
  const aidState = await client.identifiers().get(config.le.name);
  const currentKey = aidState.state.k[0]; // First (primary) signing key

  // Build verification method ID: did:webs:...#{keriKey}
  const verificationMethod = `${linkageInfo.didWebs}#${currentKey}`;

  // Build VC payload and JWT header
  const payload = buildLinkageVcPayload(
    linkageInfo.didWebs,
    linkageInfo.didIota,
    lei,
    designatedAliasesSaid
  );
  const header = buildVcJwtHeader(verificationMethod);
  const unsignedJwt = encodeVcAsJwt(header, payload);

  // Sign with the LE's KERI key
  const keeper = client.manager!.get(aidState);
  const sigs = await keeper.sign(signifyBytes(unsignedJwt), false); // non-indexed
  const sigQb64 = (sigs as string[])[0];

  // Extract raw Ed25519 signature (64 bytes) from CESR encoding
  const cigar = new Cigar({ qb64: sigQb64 });
  const signatureBytes = cigar.raw;

  const jwt = assembleSignedJwt(unsignedJwt, signatureBytes);
  console.log(`[NFT] Signed VC JWT (${jwt.length} chars)`);

  return { jwt, verificationMethod };
}

/**
 * Mint an attestation NFT for a successful verification.
 * Linkage info is required for IRC27; trust chain info makes the metadata richer.
 */
export async function mintAttestationNft(
  verificationResult: VerificationResult,
  linkageInfo?: LinkageInfo,
  trustChainInfo?: TrustChainInfo
): Promise<NftAttestation> {
  if (!verificationResult.verified) {
    throw new Error('Cannot mint attestation for failed verification');
  }

  // Default linkage info if not provided (derive from AID)
  const effectiveLinkageInfo: LinkageInfo = linkageInfo || {
    didWebs: `did:webs:backend:keri:${verificationResult.leAid}`,
    didIota: '', // Unknown if not provided
  };

  // Sign a W3C VC with the LE's KERI key
  const config = getFullConfig();
  const designatedAliasesSaid = config.designatedAliasesCredential?.said || '';
  const signedVc = await signVcWithLeKey(
    effectiveLinkageInfo,
    verificationResult.leLei,
    designatedAliasesSaid
  );

  // Build IRC27 compliant metadata
  const immutableMetadata = buildIRC27Metadata(
    verificationResult,
    effectiveLinkageInfo,
    trustChainInfo,
    signedVc
  );

  // Prepare mutable metadata
  const mutableMetadata: AttestationMutableMetadata = {
    status: 'active',
    lastVerified: isoTimestamp(),
  };

  // Require NFT minting to be enabled
  if (isNftDisabled()) {
    throw new Error('NFT minting requires NFT_MNEMONIC to be configured. Set NFT_MNEMONIC environment variable.');
  }

  // Use NFT connector
  const connector = getNftConnector();
  if (!connector) {
    throw new Error('NFT connector not available. Ensure NFT_MNEMONIC is configured and NFT connector is initialized.');
  }

  try {
    console.log('[NFT] Minting IRC27 attestation NFT on IOTA testnet...');

    const nftUrn = await connector.mint(
      NFT_IDENTITY,
      'vlei-attestation',
      immutableMetadata,
      mutableMetadata
    );

    console.log('[NFT] NFT minted successfully:', nftUrn);

    // Parse object ID from URN: urn:nft:iota:testnet:{packageId}:{objectId}
    const objectId = parseObjectIdFromUrn(nftUrn);
    const explorerUrl = getExplorerUrl(objectId);

    console.log('[NFT] Object ID:', objectId);
    console.log('[NFT] Explorer URL:', explorerUrl);

    return {
      nftId: objectId,
      explorerUrl,
      metadata: {
        standard: 'IRC27',
        version: 'v1.0',
        name: immutableMetadata.name,
        collectionName: immutableMetadata.collectionName,
        issuerName: immutableMetadata.issuerName,
        description: immutableMetadata.description,
        didWebs: effectiveLinkageInfo.didWebs,
        didIota: effectiveLinkageInfo.didIota,
        leAid: verificationResult.leAid,
        leLei: verificationResult.leLei,
        credentialSaid: verificationResult.credentialSaid,
        verificationTimestamp: verificationResult.timestamp,
        signedVc: signedVc?.jwt,
        vcVerificationMethod: signedVc?.verificationMethod,
      },
    };
  } catch (error) {
    console.error('[NFT] Failed to mint NFT:', error);
    throw new Error(`NFT minting failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
