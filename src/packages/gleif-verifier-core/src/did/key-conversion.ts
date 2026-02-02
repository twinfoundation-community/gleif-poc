import type { JWK } from '../types/did.js';
import { base64urlToBytes, bytesToBase64url } from '../utils/encoding.js';

/**
 * Convert a KERI key to JWK format for did:webs.
 *
 * KERI keys use qualified base64 -- the derivation code is part of the string.
 * For Ed25519 ('D' prefix): 44 chars base64url = 33 bytes (1 prefix + 32 key).
 * The dkr resolver expects publicKeyJwk with the raw key bytes re-encoded.
 */
export function keriKeyToJwk(keriKey: string): JWK {
  // decode full KERI qualified base64 to bytes
  // first byte is the derivation code; remaining 32 are the actual key
  const fullBytes = base64urlToBytes(keriKey);

  // skip the derivation prefix byte to get the raw key
  const rawKeyBytes = fullBytes.slice(1);

  // re-encode raw key bytes to base64url for JWK
  const x = bytesToBase64url(rawKeyBytes);

  return {
    kid: keriKey, // Use full KERI key as kid
    kty: 'OKP',
    crv: 'Ed25519',
    x,
  };
}
