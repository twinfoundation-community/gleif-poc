import { base64urlToBytes } from '../utils/encoding.js';
import type { VcJwtHeader, LinkageVcPayload } from './sign.js';

/** decoded JWT components */
interface DecodedVcJwt {
  header: VcJwtHeader;
  payload: LinkageVcPayload;
  signature: Uint8Array;
  /** The signing input (header.payload) for signature verification */
  signingInput: string;
}

/** decode a VC JWT into its components */
export function decodeVcJwt(jwt: string): DecodedVcJwt {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 parts');
  }

  const decoder = new TextDecoder();
  const header = JSON.parse(decoder.decode(base64urlToBytes(parts[0]))) as VcJwtHeader;
  const payload = JSON.parse(decoder.decode(base64urlToBytes(parts[1]))) as LinkageVcPayload;
  const signature = base64urlToBytes(parts[2]);

  return {
    header,
    payload,
    signature,
    signingInput: `${parts[0]}.${parts[1]}`,
  };
}

/** true if the JWT has expired or isn't valid yet (checks exp/nbf) */
export function isVcExpired(jwt: string): boolean {
  const { payload } = decodeVcJwt(jwt);
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.nbf === 'number' && now < payload.nbf) return true;
  if (typeof payload.exp === 'number' && now > payload.exp) return true;
  return false;
}

/**
 * Verify a VC JWT signature using Ed25519 via WebCrypto.
 * Also rejects expired JWTs.
 *
 * @param jwt - full signed JWT string
 * @param publicKeyBytes - raw 32-byte Ed25519 public key
 */
export async function verifyVcSignature(
  jwt: string,
  publicKeyBytes: Uint8Array
): Promise<boolean> {
  if (isVcExpired(jwt)) return false;

  const { signature, signingInput } = decodeVcJwt(jwt);
  const encoder = new TextEncoder();
  const data = encoder.encode(signingInput);

  const key = await crypto.subtle.importKey(
    'raw',
    publicKeyBytes as unknown as ArrayBuffer,
    { name: 'Ed25519' },
    false,
    ['verify']
  );

  return crypto.subtle.verify(
    'Ed25519',
    key,
    signature as unknown as ArrayBuffer,
    data as unknown as ArrayBuffer
  );
}
