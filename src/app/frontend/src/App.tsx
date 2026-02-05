import { useState, useCallback } from 'react';
import { PocContext } from './components/PocContext';
import { VerificationPanel } from './components/VerificationPanel';
import { ResultDisplay } from './components/ResultDisplay';
import { NftAttestation as NftAttestationPanel } from './components/NftAttestation';
import { LinkageVerification } from './components/LinkageVerification';
import type { PublicTrustChainConfig, VerificationResult, NftAttestation } from '@gleif/verifier-core';
import './App.css';

function App() {
  const [config, setConfig] = useState<PublicTrustChainConfig | null>(null);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [nftAttestation, setNftAttestation] = useState<NftAttestation | null>(null);

  const handleConfigLoaded = useCallback((loadedConfig: PublicTrustChainConfig) => {
    setConfig(loadedConfig);
  }, []);

  const handleVerificationComplete = useCallback((result: VerificationResult) => {
    setVerificationResult(result);
    setNftAttestation(null);
  }, []);

  const handleMintComplete = useCallback((attestation: NftAttestation) => {
    setNftAttestation(attestation);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>vLEI Linkage Verifier</h1>
        <p className="subtitle">Proof of Concept</p>
      </header>

      <main className="app-main">
        <PocContext />

        <VerificationPanel
          onConfigLoaded={handleConfigLoaded}
          onVerificationComplete={handleVerificationComplete}
        />

        {verificationResult && (
          <ResultDisplay
            result={verificationResult}
            config={config}
          />
        )}

        {verificationResult && (
          <NftAttestationPanel
            verificationResult={verificationResult}
            onMintComplete={handleMintComplete}
            existingAttestation={nftAttestation}
          />
        )}

        <LinkageVerification config={config} />
      </main>

      <footer className="app-footer">
        <p>GLEIF vLEI Ecosystem</p>
      </footer>
    </div>
  );
}

export default App;
