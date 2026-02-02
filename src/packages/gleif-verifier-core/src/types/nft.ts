/** IRC27 attestation metadata */
interface IRC27AttestationMetadata {
  standard: 'IRC27';
  version: 'v1.0';
  name: string;
  collectionName: string;
  issuerName: string;
  description: string;
  didWebs: string;
  didIota: string;
  leAid: string;
  leLei: string;
  credentialSaid: string;
  verificationTimestamp: string;
  /** Signed W3C VC JWT (EdDSA, Ed25519) */
  signedVc?: string;
  /** did:webs verification method used for signing */
  vcVerificationMethod?: string;
}

/** NFT attestation result */
export interface NftAttestation {
  nftId: string;
  explorerUrl: string;
  metadata: IRC27AttestationMetadata;
}
