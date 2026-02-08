import { useState, useEffect, useCallback } from 'react';
import type { NftAttestation, VerificationResult } from '@gleif/verifier-core';
import { decodeVcJwt, verifyVcSignature, base64urlToBytes } from '@gleif/verifier-core';
import { mintNft, ApiError } from '../api/client';

const API_BASE = 'http://localhost:3000';

interface Props {
  verificationResult: VerificationResult;
  onMintComplete: (attestation: NftAttestation) => void;
  existingAttestation: NftAttestation | null;
}

interface VcVerificationState {
  status: 'idle' | 'verifying' | 'verified' | 'failed';
  issuer?: string;
  error?: string;
}

// pull the ed25519 pubkey from the did:webs doc, matched against the JWT kid
async function resolvePublicKey(kid: string): Promise<Uint8Array> {
  // kid format: did:webs:backend:keri:{AID}#{keriKey}
  const hashIdx = kid.indexOf('#');
  if (hashIdx === -1) throw new Error('Invalid kid: missing fragment');

  const did = kid.substring(0, hashIdx);

  const res = await fetch(`${API_BASE}/api/resolve-did/${encodeURIComponent(did)}`);
  if (!res.ok) throw new Error(`Failed to resolve ${did}`);

  const { document } = await res.json();

  // Find the verification method matching the kid
  const vm = document?.verificationMethod?.find(
    (m: { id: string }) => m.id === kid || m.id.endsWith(kid.substring(hashIdx))
  );

  if (!vm?.publicKeyJwk?.x) {
    throw new Error(`Verification method ${kid} not found in DID document`);
  }

  // JWK x value is base64url-encoded raw 32-byte Ed25519 public key
  return base64urlToBytes(vm.publicKeyJwk.x);
}

export function NftAttestation({ verificationResult, onMintComplete, existingAttestation }: Props) {
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vcState, setVcState] = useState<VcVerificationState>({ status: 'idle' });
  const [showVcDetails, setShowVcDetails] = useState(false);

  const verifySignedVc = useCallback(async (jwt: string) => {
    setVcState({ status: 'verifying' });
    try {
      const decoded = decodeVcJwt(jwt);
      const publicKey = await resolvePublicKey(decoded.header.kid);
      const valid = await verifyVcSignature(jwt, publicKey);

      if (valid) {
        setVcState({
          status: 'verified',
          issuer: decoded.payload.iss,
        });
      } else {
        setVcState({ status: 'failed', error: 'Signature invalid' });
      }
    } catch (err) {
      setVcState({
        status: 'failed',
        error: err instanceof Error ? err.message : 'Verification failed',
      });
    }
  }, []);

  // Auto-verify when attestation has a signed VC
  useEffect(() => {
    if (existingAttestation?.metadata?.signedVc && vcState.status === 'idle') {
      verifySignedVc(existingAttestation.metadata.signedVc);
    }
  }, [existingAttestation, vcState.status, verifySignedVc]);

  async function handleMint() {
    setMinting(true);
    setError(null);
    setVcState({ status: 'idle' });
    try {
      const attestation = await mintNft();
      onMintComplete(attestation);
    } catch (err) {
      const message = err instanceof ApiError
        ? `Minting failed: ${err.message}`
        : 'Failed to connect to backend';
      setError(message);
    } finally {
      setMinting(false);
    }
  }

  if (!verificationResult.verified) {
    return null;
  }

  return (
    <div className="panel nft-panel">
      <h2>NFT Attestation</h2>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="attestation-info">
        <p className="info-text">
          Creates a <strong>vLEI Linkage Attestation</strong> on IOTA with a <strong>signed W3C
          Verifiable Credential</strong> attesting the bidirectional linkage between did:webs (vLEI)
          and did:iota. The LE signs the VC with their KERI key (Ed25519), making the attestation
          independently verifiable.
        </p>
        <ul className="info-list">
          <li><strong>Signed VC</strong> (JWT with EdDSA signature)</li>
          <li><strong>Linked DIDs</strong> (did:webs and did:iota)</li>
          <li>LE identifier (AID) and LEI</li>
          <li>Trust chain (GLEIF &rarr; QVI &rarr; LE)</li>
        </ul>
        <p className="info-text info-purpose">
          Third parties verify by: reading the attestation &rarr; extracting the JWT &rarr;
          resolving did:webs &rarr; checking the Ed25519 signature. No KERI infrastructure needed.
        </p>
      </div>

      {existingAttestation ? (
        <div className="attestation-result">
          <div className="success-message">
            <span className="checkmark">&#10003;</span>
            NFT Minted Successfully
          </div>
          <div className="nft-details">
            {existingAttestation.metadata?.didWebs && (
              <div className="detail-item">
                <label>did:webs</label>
                <code className="did-value">{existingAttestation.metadata.didWebs}</code>
              </div>
            )}
            {existingAttestation.metadata?.didIota && (
              <div className="detail-item">
                <label>did:iota</label>
                <code className="did-value">{existingAttestation.metadata.didIota}</code>
              </div>
            )}
            <div className="detail-item">
              <label>LEI</label>
              <code>{existingAttestation.metadata?.lei || verificationResult.leLei}</code>
            </div>
            <div className="detail-item">
              <label>NFT ID</label>
              <code>{existingAttestation.nftId}</code>
            </div>
            <div className="detail-item">
              <label>Explorer</label>
              <a
                href={existingAttestation.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="explorer-link"
              >
                View on IOTA Explorer &#8599;
              </a>
            </div>

            {/* Signed VC verification status */}
            {existingAttestation.metadata?.signedVc && (
              <>
                <div className="detail-item vc-signature">
                  <label>Signed VC</label>
                  {vcState.status === 'verifying' && (
                    <span className="vc-status verifying">
                      <span className="spinner small" /> Verifying signature...
                    </span>
                  )}
                  {vcState.status === 'verified' && (
                    <span className="vc-status verified">
                      <span className="checkmark">&#10003;</span> Signature verified
                    </span>
                  )}
                  {vcState.status === 'failed' && (
                    <span className="vc-status failed">
                      &#10007; {vcState.error}
                    </span>
                  )}
                </div>
                {vcState.issuer && (
                  <div className="detail-item">
                    <label>Signed by</label>
                    <code className="did-value">{vcState.issuer}</code>
                  </div>
                )}
                {existingAttestation.metadata?.vcVerificationMethod && (
                  <div className="detail-item">
                    <label>Verification method</label>
                    <code className="did-value">{existingAttestation.metadata.vcVerificationMethod}</code>
                  </div>
                )}

                <div className="detail-item">
                  <button
                    className="toggle-btn"
                    onClick={() => setShowVcDetails(!showVcDetails)}
                  >
                    {showVcDetails ? 'Hide' : 'Show'} JWT details
                  </button>
                </div>
                {showVcDetails && (
                  <div className="vc-details">
                    <pre className="jwt-payload">
                      {(() => {
                        try {
                          const decoded = decodeVcJwt(existingAttestation.metadata.signedVc!);
                          return JSON.stringify(decoded.payload, null, 2);
                        } catch {
                          return 'Failed to decode JWT';
                        }
                      })()}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="mint-section">
          <button
            className="primary-btn mint-btn"
            onClick={handleMint}
            disabled={minting}
          >
            {minting ? (
              <>
                <span className="spinner small" />
                Minting...
              </>
            ) : (
              'Mint NFT Attestation'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
