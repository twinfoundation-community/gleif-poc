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
 * Register a pending verification and wait for Sally's webhook callback.
 */
export function registerPendingVerification(
  credentialSaid: string,
  leAid: string,
  leLei: string
): Promise<VerificationResult> {
  return stateManager.registerPendingVerification(credentialSaid, leAid, leLei);
}

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

