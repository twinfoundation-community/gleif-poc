/** JWK (JSON Web Key) */
export interface JWK {
  kid?: string;
  kty: string;
  crv?: string;
  x?: string;
  [key: string]: unknown;
}

/** verification method in a DID document */
interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase?: string;
  publicKeyJwk?: JWK;
}

/** service endpoint in a DID document */
interface DIDService {
  id: string;
  type: string;
  serviceEndpoint: string | string[] | Record<string, unknown>;
}

/** DID document (W3C DID Core spec) */
export interface DIDDocument {
  '@context'?: string | string[];
  id: string;
  verificationMethod?: VerificationMethod[];
  authentication?: (string | VerificationMethod)[];
  assertionMethod?: (string | VerificationMethod)[];
  alsoKnownAs?: string[];
  service?: DIDService[];
}

/** result from DID linkage verification */
export interface DidLinkageResult {
  /** true only when both bidirectional linkage AND DA credential verification passed */
  verified: boolean;
  /** true when both DID documents reference each other in alsoKnownAs */
  bidirectional?: boolean;
  didWebs?: string;
  didIota?: string;
  linkedIotaDid?: string;
  linkedWebsDid?: string;
  vLeiVerified?: boolean;
  leAid?: string;
  leLei?: string;
  timestamp?: string;
  error?: string;
  /** Full did:webs DID document */
  websDocument?: DIDDocument;
  /** Full did:iota DID document */
  iotaDocument?: Record<string, unknown>;
  /** alsoKnownAs from did:webs document (what KERI side claims) */
  websAlsoKnownAs?: string[];
  /** alsoKnownAs from did:iota document (what IOTA side claims) */
  iotaAlsoKnownAs?: string[];
  /** Whether the Designated Aliases credential was verified (via dkr resolver CESR verification) */
  daVerified?: boolean;
  service?: unknown[];
}
