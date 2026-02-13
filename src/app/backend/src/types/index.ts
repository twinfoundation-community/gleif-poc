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
    registryId?: string;
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

