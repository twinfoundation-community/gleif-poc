/** vLEI attestation metadata (on-chain Move object fields) */
export interface AttestationMetadata {
  didWebs: string;
  didIota: string;
  lei: string;
  leAid: string;
  credentialSaid: string;
  gleifAid?: string;
  qviAid?: string;
  qviCredentialSaid?: string;
  verifiedAt: string;
  verifiedBy: string;
  /** Signed W3C VC JWT (EdDSA, Ed25519) */
  signedVc?: string;
  /** did:webs verification method used for signing */
  vcVerificationMethod?: string;
}

/** NFT attestation result */
export interface NftAttestation {
  nftId: string;
  explorerUrl: string;
  metadata: AttestationMetadata;
}
