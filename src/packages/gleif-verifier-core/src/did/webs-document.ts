import type { DIDDocument } from '../types/did.js';
import { keriKeyToJwk } from './key-conversion.js';
import type { KeriKeyState } from '../types/keri.js';

/** Input for building a did:webs DID document */
export interface iBuildWebsDidDocument {
  aid: string;
  keyState: KeriKeyState;
  domain: string;
  path?: string;
  alsoKnownAs?: string[];
}

/**
 * Build a did:webs DID document from KERI key state.
 *
 * Pure function -- no network calls. Converts KERI keys to JWK verification
 * methods and constructs the document per the did:webs spec.
 */
export function buildWebsDidDocument(input: iBuildWebsDidDocument): DIDDocument {
  const { aid, keyState, domain, path, alsoKnownAs } = input;

  const didId = path
    ? `did:webs:${domain}:${path}:${aid}`
    : `did:webs:${domain}:${aid}`;

  const verificationMethod = keyState.k.map((key: string) => {
    const jwk = keriKeyToJwk(key);
    return {
      id: `#${key}`,
      type: 'JsonWebKey',
      controller: didId,
      publicKeyJwk: {
        kid: jwk.kid || key,
        kty: jwk.kty,
        crv: jwk.crv || 'Ed25519',
        x: jwk.x || '',
      },
    };
  });

  const doc: DIDDocument = {
    id: didId,
    verificationMethod,
    service: [],
  };

  if (alsoKnownAs && alsoKnownAs.length > 0) {
    const didKeriId = `did:keri:${aid}`;
    const didWebId = path
      ? `did:web:${domain}:${path}:${aid}`
      : `did:web:${domain}:${aid}`;
    const extras = [didKeriId, didWebId].filter(id => !alsoKnownAs.includes(id));
    doc.alsoKnownAs = [...alsoKnownAs, ...extras];
  }

  return doc;
}
