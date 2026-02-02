/** result from vLEI verification */
export interface VerificationResult {
  verified: boolean;
  revoked: boolean;
  leAid: string;
  leLei: string;
  credentialSaid: string;
  timestamp: string;
  error?: string;
}

/** public trust chain config -- safe for frontend, no secrets */
export interface PublicTrustChainConfig {
  gleif: { aid: string; oobi: string };
  qvi: { aid: string; oobi: string };
  le: { aid: string; oobi: string; lei: string; iotaDid?: string; didWebs?: string };
  qviCredential: { said: string };
  leCredential: { said: string };
  designatedAliasesCredential?: { said: string; linkedDids: string[] };
  sally: { configured: boolean };
}
