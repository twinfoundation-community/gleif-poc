import { useState } from 'react';

export function PocContext() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="panel poc-context">
      <button
        className="poc-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="poc-toggle-icon">{expanded ? '▼' : '▶'}</span>
        <span className="poc-toggle-text">What's pre-configured in this PoC?</span>
      </button>

      {expanded && (
        <div className="poc-content">
          <p className="poc-intro">
            This PoC demonstrates the verification flow. The following would normally be
            done by separate organizations but are <strong>simulated by the setup script</strong>:
          </p>

          <div className="poc-section">
            <h4>Trust Chain (setup script creates all three)</h4>
            <ul>
              <li><strong>GLEIF Root</strong> — In production: the real Global Legal Entity Identifier Foundation</li>
              <li><strong>QVI (Qualified vLEI Issuer)</strong> — In production: an accredited organization authorized by GLEIF</li>
              <li><strong>Legal Entity</strong> — In production: a real company applying for vLEI credentials</li>
            </ul>
          </div>

          <div className="poc-section">
            <h4>Credentials (pre-issued)</h4>
            <ul>
              <li><strong>QVI Credential</strong> — GLEIF → QVI (normally: QVI applies to GLEIF for accreditation)</li>
              <li><strong>LE Credential</strong> — QVI → LE (normally: LE applies to QVI with legal documentation)</li>
              <li><strong>Designated Aliases</strong> — LE self-issues (links did:webs to did:iota)</li>
            </ul>
          </div>

          <div className="poc-section">
            <h4>DID Linkage (auto-created)</h4>
            <ul>
              <li><strong>IOTA DID</strong> — Created via backend API (normally: LE signs up through TWIN Identity to obtain their did:iota)</li>
              <li><strong>Forward link</strong> — did:webs alsoKnownAs → did:iota (normally: LE signs with their signing key via signify-ts)</li>
              <li><strong>Reverse link</strong> — did:iota alsoKnownAs → did:webs (normally: TWIN Identity signs on behalf of the LE)</li>
            </ul>
            <p className="poc-link-note">
              Bidirectional linking proves control of both identities — in production, KERI keys are user-controlled (Signify), IOTA keys are system-custodied (TWIN Identity).
            </p>
          </div>

          <div className="poc-section">
            <h4>Sally Verifier (pre-configured)</h4>
            <ul>
              <li><strong>Trust anchor</strong> — Sally knows GLEIF's AID (normally: verifier maintains trust list)</li>
              <li><strong>QVI credential</strong> — Pre-loaded for chain verification (normally: discovered by walking the trust chain)</li>
            </ul>
          </div>

          <div className="poc-section">
            <h4>How did:webs resolution works (in production)</h4>
            <p className="poc-arch-note">
              The LE's credentials and key events are stored in <strong>KERIA</strong> (their KERI cloud agent).
              In production, the LE (or their QVI/provider) hosts KERIA and a public <strong>did:webs endpoint</strong> on
              a domain they control. The Designated Aliases credential (which links did:webs to did:iota) is stored
              in KERIA and reflected in the DID document served at that domain.
            </p>
            <div className="poc-flow">
              <code>
                LE signs credential (Signify, edge) &rarr; stored in KERIA (cloud agent)
                &rarr; served as did:webs at <strong>https://identity.acme-corp.com/keri/&#123;aid&#125;/did.json</strong>
              </code>
            </div>
            <p className="poc-arch-note">
              Anyone can then resolve <code>did:webs:identity.acme-corp.com:keri:&#123;aid&#125;</code> by fetching the
              DID document and KERI event log (<code>keri.cesr</code>) from that domain &mdash; no special access needed.
              In this PoC, the domain is a Docker-internal hostname (<code>backend</code>), but the resolution
              mechanism is identical to production.
            </p>
          </div>

          <div className="poc-section">
            <h4>Browser-side KERI (this PoC)</h4>
            <ul>
              <li><strong>signify-ts runs in the browser</strong> - credential presentation and KERI signing happen client-side, not on the backend</li>
              <li><strong>Passcode</strong> - loaded from backend config for convenience; in production, the user enters it and it never leaves their device</li>
              <li><strong>KERIA connection</strong> -- the browser talks directly to the KERI cloud agent via HTTP</li>
              <li><strong>Backend</strong> - only handles IOTA on-chain operations and receives Sally's webhook callback</li>
            </ul>
          </div>

          <p className="poc-demo-note">
            <strong>What this demo actually shows:</strong> The runtime verification flow -- presenting
            credentials to Sally from the browser via signify-ts, walking the trust chain, verifying
            DID linkage in both directions, and minting an on-chain attestation.
          </p>
        </div>
      )}
    </div>
  );
}
