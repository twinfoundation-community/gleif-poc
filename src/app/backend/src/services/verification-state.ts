/**
 * Verification State Service
 *
 * Wraps the VerificationStateManager from @gleif/verifier-core
 * and exports the same interface for backward compatibility.
 */

import { VerificationStateManager, type VerificationResult } from '@gleif/verifier-core';

// Global instance of the verification state manager
const stateManager = new VerificationStateManager({ timeoutMs: 30000 });

/**
 * Resolve a pending verification with the result from Sally's webhook.
 * Returns true if a pending verification was found and resolved.
 */
export function resolveVerification(
  credentialSaid: string,
  verified: boolean,
  revoked: boolean
): boolean {
  return stateManager.resolveVerification(credentialSaid, verified, revoked);
}

/**
 * Store the completed verification result for browser polling.
 */
export function storeCompletedResult(
  credentialSaid: string,
  verified: boolean,
  revoked: boolean,
  leAid: string,
  leLei: string
): void {
  stateManager.storeCompletedResult(credentialSaid, verified, revoked, leAid, leLei);
}

/**
 * Get the completed verification result.
 */
export function getCompletedResult(credentialSaid: string): VerificationResult | null {
  return stateManager.getCompletedResult(credentialSaid);
}
