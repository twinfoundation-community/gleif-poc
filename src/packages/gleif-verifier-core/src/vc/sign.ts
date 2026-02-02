import { bytesToBase64url } from '../utils/encoding.js';

/** W3C VC payload for DID linkage attestation */
interface VcClaim {
  '@context': string[];
  type: string[];
  credentialSubject: {
    id: string;
    linkage: {
      didWebs: string;
      didIota: string;
      lei: string;
      designatedAliasesSaid: string;
    };
  };
}

export interface LinkageVcPayload {
  iss: string;
  sub: string;
  jti: string;
  nbf: number;
  iat: number;
  exp: number;
  vc: VcClaim;
}

/** JWT header for EdDSA signing */
export interface VcJwtHeader {
  alg: 'EdDSA';
  kid: string;
  typ: 'JWT';
}

/** build a W3C VC payload for DID linkage attestation */
export function buildLinkageVcPayload(
  issuerDid: string,
  subjectDid: string,
  lei: string,
  designatedAliasesSaid: string
): LinkageVcPayload {
  const now = Math.floor(Date.now() / 1000);
  const oneYear = 365 * 24 * 60 * 60;
  return {
    iss: issuerDid,
    sub: subjectDid,
    jti: `urn:uuid:${crypto.randomUUID()}`,
    nbf: now,
    iat: now,
    exp: now + oneYear,
    vc: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'DIDLinkageAttestation'],
      credentialSubject: {
        id: subjectDid,
        linkage: { didWebs: issuerDid, didIota: subjectDid, lei, designatedAliasesSaid },
      },
    },
  };
}

/** build the JWT header for VC signing */
export function buildVcJwtHeader(verificationMethodId: string): VcJwtHeader {
  return {
    alg: 'EdDSA',
    kid: verificationMethodId,
    typ: 'JWT',
  };
}

/**
 * Encode VC as unsigned JWT -- returns base64url(header).base64url(payload)
 * ready for signing.
 */
export function encodeVcAsJwt(header: VcJwtHeader, payload: LinkageVcPayload): string {
  const encoder = new TextEncoder();
  const headerB64 = bytesToBase64url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = bytesToBase64url(encoder.encode(JSON.stringify(payload)));
  return `${headerB64}.${payloadB64}`;
}

/** assemble a signed JWT from the unsigned part + signature bytes */
export function assembleSignedJwt(unsignedJwt: string, signatureBytes: Uint8Array): string {
  return `${unsignedJwt}.${bytesToBase64url(signatureBytes)}`;
}
