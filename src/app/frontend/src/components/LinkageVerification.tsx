import { useState } from 'react';
import { verifyLinkage, fetchKeriCesr } from '../api/client';
import type { DidLinkageResult, PublicTrustChainConfig } from '@gleif/verifier-core';
import { formatTimestamp } from '@gleif/verifier-core';

interface LinkageVerificationProps {
  config?: PublicTrustChainConfig | null;
}

// build explorer URL for a did:iota
function getIotaExplorerUrl(did: string): string {
  // Extract object ID from did:iota:network:objectId
  const parts = did.split(':');
  const objectId = parts[parts.length - 1];
  return `https://explorer.iota.org/object/${objectId}?network=testnet`;
}

function ExplorerLink({ did }: { did: string }) {
  return (
    <a href={getIotaExplorerUrl(did)} target="_blank" rel="noopener noreferrer" className="explorer-link">
      View on IOTA Explorer &#8599;
    </a>
  );
}

export function LinkageVerification({ config }: LinkageVerificationProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DidLinkageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keriCesr, setKeriCesr] = useState<string | null>(null);
  const [cesrExpanded, setCesrExpanded] = useState(false);

  const handleVerify = async () => {
    if (!input.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setKeriCesr(null);
    setCesrExpanded(false);

    try {
      const res = await verifyLinkage(input.trim());
      setResult(res);

      // fetch keri.cesr if we have an AID
      if (res.leAid) {
        fetchKeriCesr(res.leAid).then(setKeriCesr).catch((e) => {
          console.warn('[keri.cesr] Failed to fetch:', e);
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && input.trim()) {
      handleVerify();
    }
  };

  const handleQuickSelect = (did: string) => {
    setInput(did);
    setResult(null);
    setError(null);
  };

  return (
    <div className="panel">
      <h2>Verify DID Linkage</h2>
      <div className="linkage-info">
        <p className="info-text">
          Verifies <strong>bi-directional linkage</strong> between KERI (did:webs) and IOTA (did:iota) identities:
        </p>
        <ul className="info-list">
          <li><strong>Direction 1:</strong> did:webs → resolves alsoKnownAs → did:iota</li>
          <li><strong>Direction 2:</strong> did:iota → resolves alsoKnownAs → did:webs</li>
        </ul>
        <p className="info-text info-purpose">
          Both directions verify the vLEI credential chain via Sally and confirm the reverse link exists.
        </p>
      </div>

      {config?.le.didWebs && config?.le.iotaDid && (
        <div className="quick-select">
          <span className="quick-select-label">Test with configured DIDs:</span>
          <div className="quick-select-buttons">
            <button
              className="quick-select-btn"
              onClick={() => handleQuickSelect(config.le.didWebs!)}
              disabled={loading}
              title="Direction 1: did:webs → did:iota"
            >
              did:webs (Direction 1)
            </button>
            <button
              className="quick-select-btn"
              onClick={() => handleQuickSelect(config.le.iotaDid!)}
              disabled={loading}
              title="Direction 2: did:iota → did:webs"
            >
              did:iota (Direction 2)
            </button>
          </div>
        </div>
      )}

      <div className="input-group">
        <input
          type="text"
          className="did-input"
          placeholder="Enter did:webs:... or did:iota:..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          className="primary-btn verify-btn"
          onClick={handleVerify}
          disabled={loading || !input.trim()}
        >
          {loading ? (
            <>
              <span className="spinner small"></span>
              Verifying...
            </>
          ) : (
            'Verify Linkage'
          )}
        </button>
      </div>

      {input.trim() && !result && !loading && (
        <div className="verification-steps">
          {input.startsWith('did:webs:') ? (
            <>
              <p className="steps-title">Verification steps (Direction 1):</p>
              <ol className="steps-list">
                <li>Resolve did:webs document from the LE's domain (fetches did.json + keri.cesr, derived from credentials stored in KERIA)</li>
                <li>Extract linked did:iota from alsoKnownAs (set by the Designated Aliases credential the LE self-issued)</li>
                <li>Resolve did:iota from IOTA network and verify it links back (bidirectional check)</li>
                <li>Present LE credential to Sally verifier via IPEX</li>
                <li>Sally walks trust chain: LE → QVI → GLEIF root</li>
              </ol>
            </>
          ) : input.startsWith('did:iota:') ? (
            <>
              <p className="steps-title">Verification steps (Direction 2):</p>
              <ol className="steps-list">
                <li>Resolve did:iota document from IOTA network (on-chain DID object)</li>
                <li>Extract linked did:webs from alsoKnownAs</li>
                <li>Resolve did:webs from the LE's domain (fetches did.json + keri.cesr, derived from KERIA)</li>
                <li>Verify did:webs links back to did:iota (bidirectional check via Designated Aliases credential)</li>
                <li>Present LE credential to Sally verifier via IPEX</li>
                <li>Sally walks trust chain: LE → QVI → GLEIF root</li>
              </ol>
            </>
          ) : (
            <p className="steps-hint">Enter a did:webs: or did:iota: identifier to see verification steps</p>
          )}
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      {result && (
        <div className="linkage-result">
          <div className="status-badges">
            <div className={`status-badge ${result.verified ? 'verified' : 'failed'}`}>
              {result.verified ? (
                <>
                  <span className="checkmark">&#10003;</span>
                  Linked &amp; Verified
                </>
              ) : (
                <>
                  <span className="cross">&#10007;</span>
                  Not Verified
                </>
              )}
            </div>

            {result.bidirectional !== undefined && (
              <div className={`status-badge ${result.bidirectional ? 'verified' : 'failed'}`}>
                {result.bidirectional ? 'Bidirectional' : 'One-way only'}
              </div>
            )}

            {result.daVerified !== undefined && (
              <div className={`status-badge ${result.daVerified ? 'verified' : 'failed'}`}>
                {result.daVerified ? 'DA Credential Verified' : 'DA Credential Unverified'}
              </div>
            )}
          </div>

          {result.error && (
            <div className="error-message">{result.error}</div>
          )}

          <div className="info-grid linkage-details">
            {result.didWebs && (
              <div className="info-item">
                <label>did:webs</label>
                <code>{result.didWebs}</code>
              </div>
            )}

            {result.didIota && (
              <div className="info-item">
                <label>did:iota</label>
                <code>{result.didIota}</code>
                <ExplorerLink did={result.didIota} />
              </div>
            )}

            {result.linkedIotaDid && (
              <div className="info-item">
                <label>Linked IOTA DID</label>
                <code>{result.linkedIotaDid}</code>
                <ExplorerLink did={result.linkedIotaDid} />
              </div>
            )}

            {result.linkedWebsDid && (
              <div className="info-item">
                <label>Linked Webs DID</label>
                <code>{result.linkedWebsDid}</code>
              </div>
            )}

            {result.leAid && (
              <div className="info-item">
                <label>LE AID</label>
                <code>{result.leAid}</code>
              </div>
            )}

            {result.leLei && (
              <div className="info-item">
                <label>LEI</label>
                <code>{result.leLei}</code>
              </div>
            )}

            {result.vLeiVerified !== undefined && (
              <div className="info-item">
                <label>vLEI Verified</label>
                <code>{result.vLeiVerified ? 'Yes' : 'No'}</code>
              </div>
            )}

            {result.timestamp && (
              <div className="info-item">
                <label>Verified At</label>
                <code>{formatTimestamp(result.timestamp)}</code>
              </div>
            )}
          </div>

          {/* alsoKnownAs details section */}
          {(result.websAlsoKnownAs?.length || result.iotaAlsoKnownAs?.length) && (
            <div className="also-known-as-section">
              <h4 className="aka-title">alsoKnownAs Linkage Proof</h4>
              <p className="aka-explanation">
                Both DID documents declare each other in their <code>alsoKnownAs</code> property.
                Each side requires a different private key — an on-chain transaction (IOTA controller key)
                and a signed ACDC credential (KERI key via Signify). Bidirectional linkage proves common
                control: neither side alone can forge the other's assertion.
              </p>

              <div className="aka-json-grid">
                {/* did:webs document */}
                <div className="aka-json-card">
                  <div className="aka-json-header">did:webs Document</div>
                  <pre className="aka-json">
{JSON.stringify(result.websDocument || {
  id: result.didWebs || result.linkedWebsDid || 'did:webs:...',
  alsoKnownAs: result.websAlsoKnownAs || []
}, null, 2)}
                  </pre>
                </div>

                {/* did:iota document */}
                <div className="aka-json-card">
                  <div className="aka-json-header">did:iota Document</div>
                  <pre className="aka-json">
{JSON.stringify(result.iotaDocument || {
  id: result.didIota || result.linkedIotaDid || 'did:iota:...',
  alsoKnownAs: result.iotaAlsoKnownAs || []
}, null, 2)}
                  </pre>
                </div>
              </div>

              {result.bidirectional ? (
                <div className="aka-verified">
                  <span className="checkmark">✓</span>
                  Bidirectional linkage verified: both DIDs reference each other
                </div>
              ) : (
                <div className="aka-not-verified">
                  <span className="cross">✗</span>
                  Not bidirectional: alsoKnownAs values do not match
                </div>
              )}

              {keriCesr && (
                <div className="cesr-section">
                  <button
                    className="cesr-toggle"
                    onClick={() => setCesrExpanded(!cesrExpanded)}
                  >
                    <span className="cesr-toggle-icon">{cesrExpanded ? '▼' : '▶'}</span>
                    {' '}keri.cesr (KERI Event Log)
                  </button>
                  {cesrExpanded && (
                    <pre className="aka-json cesr-content">{keriCesr}</pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
