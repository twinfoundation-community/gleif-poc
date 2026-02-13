import type { VerificationResult } from '../types/verification.js';
import { isoTimestamp } from '../utils/timestamps.js';

const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

interface PendingVerification {
  leAid: string;
  leLei: string;
  credentialSaid: string;
  resolve: (result: VerificationResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  startTime: number;
}

interface VerificationStateManagerOptions {
  timeoutMs?: number;
}

/**
 * Tracks pending verifications by credential SAID -- bridges the gap between
 * the verification request and Sally's webhook callback.
 */
export class VerificationStateManager {
  private pendingVerifications = new Map<string, PendingVerification>();
  private timeoutMs: number;

  constructor(options?: VerificationStateManagerOptions) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** register a pending verification; resolves when Sally's webhook comes back */
  registerPendingVerification(
    credentialSaid: string,
    leAid: string,
    leLei: string
  ): Promise<VerificationResult> {
    // already pending for this one -- chain the promise
    const existing = this.pendingVerifications.get(credentialSaid);
    if (existing) {
      // chain onto the existing pending entry
      return new Promise((resolve, reject) => {
        const originalResolve = existing.resolve;
        const originalReject = existing.reject;

        existing.resolve = (result) => {
          originalResolve(result);
          resolve(result);
        };
        existing.reject = (error) => {
          originalReject(error);
          reject(error);
        };
      });
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pendingVerifications.get(credentialSaid);
        if (pending) {
          this.pendingVerifications.delete(credentialSaid);
          console.log(`[verification-state] Verification timeout for ${credentialSaid}`);

          // resolve with timeout instead of rejecting
          resolve({
            verified: false,
            revoked: false,
            leAid: pending.leAid,
            leLei: pending.leLei,
            credentialSaid: pending.credentialSaid,
            timestamp: isoTimestamp(),
            error: `Verification timeout - no response from Sally within ${this.timeoutMs / 1000} seconds`,
          });
        }
      }, this.timeoutMs);

      const pending: PendingVerification = {
        leAid,
        leLei,
        credentialSaid,
        resolve,
        reject,
        timeout,
        startTime: Date.now(),
      };

      this.pendingVerifications.set(credentialSaid, pending);
    });
  }

  /**
   * Resolve a pending verification with Sally's webhook result.
   * Returns true if we had a pending entry for this SAID, false otherwise.
   */
  resolveVerification(
    credentialSaid: string,
    verified: boolean,
    revoked: boolean
  ): boolean {
    const pending = this.pendingVerifications.get(credentialSaid);
    if (!pending) {
      console.log(`[verification-state] No pending verification found for ${credentialSaid}`);
      return false;
    }

    // Clear the timeout
    clearTimeout(pending.timeout);

    // Remove from pending map
    this.pendingVerifications.delete(credentialSaid);

    const elapsedMs = Date.now() - pending.startTime;
    console.log(
      `[verification-state] Resolving verification for ${credentialSaid} ` +
      `(verified=${verified}, revoked=${revoked}, elapsed=${elapsedMs}ms)`
    );

    // resolve the promise
    pending.resolve({
      verified,
      revoked,
      leAid: pending.leAid,
      leLei: pending.leLei,
      credentialSaid: pending.credentialSaid,
      timestamp: isoTimestamp(),
    });

    return true;
  }

  /** pending SAIDs (for debugging) */
  getPendingSaids(): string[] {
    return Array.from(this.pendingVerifications.keys());
  }

  // --- Poll-based pattern for browser-side verification ---

  private completedVerifications = new Map<string, VerificationResult>();
  private static COMPLETED_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Store a completed verification result.
   * Browser can poll for this via getCompletedResult().
   */
  storeCompletedResult(
    credentialSaid: string,
    verified: boolean,
    revoked: boolean,
    leAid: string,
    leLei: string
  ): void {
    const result: VerificationResult = {
      verified,
      revoked,
      leAid,
      leLei,
      credentialSaid,
      timestamp: isoTimestamp(),
    };
    this.completedVerifications.set(credentialSaid, result);

    // TTL cleanup
    setTimeout(() => {
      this.completedVerifications.delete(credentialSaid);
    }, VerificationStateManager.COMPLETED_TTL_MS);
  }

  /** Get a completed verification result (non-blocking, for polling). */
  getCompletedResult(credentialSaid: string): VerificationResult | null {
    return this.completedVerifications.get(credentialSaid) ?? null;
  }
}
