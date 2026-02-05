import { useEffect, useState, useCallback } from 'react';
import type { PublicTrustChainConfig, VerificationResult } from '@gleif/verifier-core';
import { fetchConfig, verifyCredential, ApiError } from '../api/client';

interface Props {
  onVerificationComplete: (result: VerificationResult) => void;
  onConfigLoaded: (config: PublicTrustChainConfig) => void;
}

export function VerificationPanel({ onVerificationComplete, onConfigLoaded }: Props) {
  const [config, setConfig] = useState<PublicTrustChainConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchConfig();
      setConfig(data);
      onConfigLoaded(data);
    } catch (err) {
      const message = err instanceof ApiError
        ? `Failed to load config: ${err.message}`
        : 'Failed to connect to backend. Is it running?';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [onConfigLoaded]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  async function handleVerify() {
    setVerifying(true);
    setError(null);
    try {
      const result = await verifyCredential();
      onVerificationComplete(result);
    } catch (err) {
      const message = err instanceof ApiError
        ? `Verification failed: ${err.message}`
        : 'Failed to connect to backend';
      setError(message);
    } finally {
      setVerifying(false);
    }
  }

  if (loading) {
    return (
      <div className="panel">
        <div className="spinner" />
        <p>Loading configuration...</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>vLEI Credential Verification</h2>

      {error && (
        <div className="error-message">
          {error}
          <button className="retry-btn" onClick={loadConfig}>Retry</button>
        </div>
      )}

      {config && (
        <div className="config-info">
          <h3>Pre-configured Legal Entity</h3>
          <div className="info-grid">
            <div className="info-item">
              <label>AID</label>
              <code>{config.le.aid}</code>
              <span className="field-hint">Autonomic Identifier — KERI-based decentralized identity</span>
            </div>
            <div className="info-item">
              <label>LEI</label>
              <code>{config.le.lei}</code>
              <span className="field-hint">Legal Entity Identifier — 20-character business ID from GLEIF</span>
            </div>
            <div className="info-item">
              <label>Credential SAID</label>
              <code>{config.leCredential.said}</code>
              <span className="field-hint">Self-Addressing Identifier — content-addressable hash of the credential</span>
            </div>
          </div>
        </div>
      )}

      <button
        className="primary-btn"
        onClick={handleVerify}
        disabled={!config || verifying}
      >
        {verifying ? (
          <>
            <span className="spinner small" />
            Verifying...
          </>
        ) : (
          'Verify Credential'
        )}
      </button>
    </div>
  );
}
