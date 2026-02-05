import type { PublicTrustChainConfig, VerificationResult } from '@gleif/verifier-core';
import { formatTimestamp } from '@gleif/verifier-core';

interface Props {
  result: VerificationResult;
  config: PublicTrustChainConfig | null;
}

export function ResultDisplay({ result, config }: Props) {

  return (
    <div className="panel result-panel">
      <h2>Verification Result</h2>

      <div className={`status-badge ${result.verified ? 'verified' : 'failed'}`}>
        {result.verified ? (
          <>
            <span className="checkmark">&#10003;</span>
            Credential Verified
          </>
        ) : (
          <>
            <span className="cross">&#10007;</span>
            Verification Failed
          </>
        )}
      </div>

      {config && (
        <div className="trust-chain">
          <h3>Trust Chain</h3>
          <div className="chain-visualization">
            <div className="chain-node gleif">
              <div className="node-label">GLEIF</div>
              <div className="node-aid">{config.gleif.aid}</div>
              <div className="node-role">Root of Trust</div>
            </div>

            <div className="chain-arrow">&#8595;</div>

            <div className="chain-node qvi">
              <div className="node-label">QVI</div>
              <div className="node-aid">{config.qvi.aid}</div>
              <div className="node-role">Qualified vLEI Issuer</div>
            </div>

            <div className="chain-arrow">&#8595;</div>

            <div className="chain-node le">
              <div className="node-label">LE</div>
              <div className="node-aid">{config.le.aid}</div>
              <div className="node-role">Legal Entity</div>
            </div>
          </div>
        </div>
      )}

      <div className="credential-details">
        <h3>Credential Details</h3>
        <div className="details-grid">
          <div className="detail-item">
            <label>Legal Entity AID</label>
            <code>{result.leAid}</code>
          </div>
          <div className="detail-item">
            <label>LEI</label>
            <code>{result.leLei}</code>
          </div>
          <div className="detail-item">
            <label>Verified At</label>
            <code>{formatTimestamp(result.timestamp)}</code>
          </div>
        </div>
      </div>
    </div>
  );
}
