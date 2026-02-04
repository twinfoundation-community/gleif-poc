/**
 * trust anchor config from .trust-anchors.json -- poc-specific, includes secrets
 */
export interface TrustAnchorConfig {
  gleif: {
    name: string;
    aid: string;
    passcode: string;
    oobi: string;
    registryId: string;
  };
  qvi: {
    name: string;
    aid: string;
    passcode: string;
    oobi: string;
    registryId: string;
  };
  le: {
    name: string;
    aid: string;
    passcode: string;
    oobi: string;
    lei: string;
    iotaDid?: string;
  };
  qviCredential: {
    said: string;
    schema: string;
    issuer: string;
    issuee: string;
  };
  leCredential: {
    said: string;
    schema: string;
    issuer: string;
    issuee: string;
  };
  designatedAliasesCredential?: {
    said: string;
    schema: string;
    issuer: string;
    ids: string[];
  };
  sally: {
    aid: string;
    configured: boolean;
    gleifOobiResolved: boolean;
    qviCredentialPreloaded: boolean;
  };
  timestamp: string;
}

// Re-export KERI types from shared package
export type { KeriKeyState, KeriCredential, KeriOperation } from '@gleif/verifier-core';

/** verification method in DID document -- for did:webs */
export interface DidWebsVerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyJwk: {
    kid: string;
    kty: string;
    crv: string;
    x: string;
  };
}
