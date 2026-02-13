import { useEffect, useState, useCallback, useRef } from 'react';
import type { PublicTrustChainConfig, VerificationResult, PocBrowserConfig, KeriCredential } from '@gleif/verifier-core';
import type { SignifyClient } from 'signify-ts';
import { fetchConfig } from '../api/client';
import {
  stepFetchConfig,
  stepConnectToKeria,
  stepLoadLeCredential,
  stepIssueDesignatedAliases,
  stepResolveSallyOobi,
  stepPresentToSally,
  stepAwaitVerification,
  type ConfigResult,
  type ConnectResult,
  type CredentialResult,
  type DaResult,
  type OobiResult,
  type GrantResult,
} from '../keri/keri-client';

interface Props {
  onVerificationComplete: (result: VerificationResult) => void;
  onConfigLoaded: (config: PublicTrustChainConfig) => void;
}

type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface StepDef {
  id: number;
  group: string;
  name: string;
  description: string;
  technicalDetail: string;
}

const STEPS: StepDef[] = [
  {
    id: 1,
    group: 'Setup',
    name: 'Load Configuration',
    description: 'Fetch trust chain config and LE credentials info from the backend.',
    technicalDetail: 'GET /api/poc-config',
  },
  {
    id: 2,
    group: 'Setup',
    name: 'Connect to KERIA',
    description: 'Initialize signify-ts in the browser and connect to the KERIA cloud agent using the LE passcode.',
    technicalDetail: 'new SignifyClient(url, passcode, Tier.low) → client.connect()',
  },
  {
    id: 3,
    group: 'DID Linkage',
    name: 'Load LE Credential',
    description: 'Retrieve the Legal Entity vLEI credential from KERIA.',
    technicalDetail: 'client.credentials().list() → filter by LE schema SAID',
  },
  {
    id: 4,
    group: 'DID Linkage',
    name: 'Issue Designated Aliases',
    description: 'Self-issue the Designated Aliases ACDC and publish the did:webs DID document -- binds the KERI AID to both did:webs and did:iota.',
    technicalDetail: 'client.credentials().issue(leName, { i, ri, s, a: { ids }, r: { rules } }) → POST /keri/:aid/publish',
  },
  {
    id: 5,
    group: 'vLEI Verification',
    name: 'Resolve Sally OOBI',
    description: 'Resolve the OOBI for Sally (GLEIF\'s vLEI verification service) so KERIA can communicate with it.',
    technicalDetail: 'client.oobis().resolve(sallyOobi, "sally")',
  },
  {
    id: 6,
    group: 'vLEI Verification',
    name: 'Present to Sally',
    description: 'Send the LE credential to Sally via IPEX grant for trust chain verification (GLEIF → QVI → LE).',
    technicalDetail: 'client.ipex().grant({...}) → client.ipex().submitGrant()',
  },
  {
    id: 7,
    group: 'vLEI Verification',
    name: 'Await Verification',
    description: 'Poll the backend for Sally\'s webhook response confirming the credential is valid.',
    technicalDetail: 'Poll GET /api/verification-status/:said',
  },
];

export function VerificationPanel({ onVerificationComplete, onConfigLoaded }: Props) {
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(
    STEPS.map(() => 'pending'),
  );
  const [stepErrors, setStepErrors] = useState<(string | null)[]>(
    STEPS.map(() => null),
  );
  const [stepResults, setStepResults] = useState<(string | null)[]>(
    STEPS.map(() => null),
  );

  // Accumulated state across steps
  const pocConfigRef = useRef<PocBrowserConfig | null>(null);
  const clientRef = useRef<SignifyClient | null>(null);
  const credentialRef = useRef<KeriCredential | null>(null);
  const credentialSaidRef = useRef<string | null>(null);

  const [configLoaded, setConfigLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load public config on mount (separate from wizard step 1)
  const loadConfig = useCallback(async () => {
    try {
      const data = await fetchConfig();
      onConfigLoaded(data);
      setConfigLoaded(true);
    } catch {
      setLoadError('Failed to connect to backend. Is it running?');
    }
  }, [onConfigLoaded]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  function setStatus(stepIndex: number, status: StepStatus) {
    setStepStatuses((prev) => {
      const next = [...prev];
      next[stepIndex] = status;
      return next;
    });
  }

  function setError(stepIndex: number, error: string | null) {
    setStepErrors((prev) => {
      const next = [...prev];
      next[stepIndex] = error;
      return next;
    });
  }

  function setResult(stepIndex: number, result: string | null) {
    setStepResults((prev) => {
      const next = [...prev];
      next[stepIndex] = result;
      return next;
    });
  }

  function canRun(stepIndex: number): boolean {
    if (stepStatuses[stepIndex] === 'active') return false;
    if (stepIndex === 0) return stepStatuses[0] !== 'done';
    return stepStatuses[stepIndex - 1] === 'done';
  }

  async function runStep(stepIndex: number) {
    setStatus(stepIndex, 'active');
    setError(stepIndex, null);
    setResult(stepIndex, null);

    try {
      switch (stepIndex) {
        case 0: {
          const { config }: ConfigResult = await stepFetchConfig();
          pocConfigRef.current = config;
          const lines = [
            `LE AID: ${config.le.aid}`,
            `LEI: ${config.le.lei}`,
            config.le.didWebs ? `did:webs: ${config.le.didWebs}` : null,
            config.le.iotaDid ? `did:iota: ${config.le.iotaDid}` : null,
            `KERIA: ${config.poc.keriaUrl}`,
            `Sally: ${config.poc.sallyAid.slice(0, 16)}...`,
          ].filter(Boolean);
          setResult(stepIndex, lines.join('\n'));
          break;
        }
        case 1: {
          const config = pocConfigRef.current!;
          const { client, agentPrefix }: ConnectResult = await stepConnectToKeria(config);
          clientRef.current = client;
          setResult(stepIndex, [
            `Connected to ${config.poc.keriaUrl}`,
            `Agent: ${agentPrefix.slice(0, 24)}...`,
          ].join('\n'));
          break;
        }
        case 2: {
          const { credential, said, schema, issuer }: CredentialResult = await stepLoadLeCredential(
            clientRef.current!,
            pocConfigRef.current!,
          );
          credentialRef.current = credential;
          credentialSaidRef.current = said;
          setResult(stepIndex, [
            `SAID: ${said}`,
            `Schema: ${schema}`,
            `Issuer: ${issuer.slice(0, 24)}...`,
          ].join('\n'));
          break;
        }
        case 3: {
          const { said, linkedDids }: DaResult = await stepIssueDesignatedAliases(
            clientRef.current!,
            pocConfigRef.current!,
          );
          setResult(stepIndex, [
            `SAID: ${said}`,
            `Linked: ${linkedDids.join(', ')}`,
          ].join('\n'));
          break;
        }
        case 4: {
          const { sallyAid }: OobiResult = await stepResolveSallyOobi(
            clientRef.current!,
            pocConfigRef.current!,
          );
          setResult(stepIndex, `Sally AID resolved: ${sallyAid.slice(0, 24)}...`);
          break;
        }
        case 5: {
          const { credentialSaid }: GrantResult = await stepPresentToSally(
            clientRef.current!,
            pocConfigRef.current!,
            credentialRef.current!,
          );
          credentialSaidRef.current = credentialSaid;
          setResult(stepIndex, `IPEX grant submitted for credential ${credentialSaid.slice(0, 24)}...`);
          break;
        }
        case 6: {
          const result: VerificationResult = await stepAwaitVerification(
            credentialSaidRef.current!,
          );
          if (result.verified) {
            setResult(stepIndex, [
              'Verified by Sally',
              `LE AID: ${result.leAid}`,
              `LEI: ${result.leLei}`,
            ].join('\n'));
          } else {
            setResult(stepIndex, `Verification failed: ${result.error || 'Unknown reason'}`);
          }
          onVerificationComplete(result);
          break;
        }
      }
      setStatus(stepIndex, 'done');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(stepIndex, message);
      setStatus(stepIndex, 'error');
    }
  }

  if (loadError) {
    return (
      <div className="panel">
        <div className="error-message">
          {loadError}
          <button className="retry-btn" onClick={loadConfig}>Retry</button>
        </div>
      </div>
    );
  }

  if (!configLoaded) {
    return (
      <div className="panel">
        <div className="spinner" />
        <p>Connecting to backend...</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>vLEI Trust Chain &amp; DID Linkage</h2>

      <div className="poc-disclaimer">
        <strong>PoC Note:</strong> In this demo, the Legal Entity's passcode is loaded from
        backend config. In production, the passcode is something <strong>you</strong> provide
        - it never leaves the user device and is never shared with any server.
      </div>

      <div className="wizard-steps">
        {STEPS.map((step, i) => {
          const status = stepStatuses[i];
          const error = stepErrors[i];
          const result = stepResults[i];
          const enabled = canRun(i);
          const showGroupHeader = i === 0 || STEPS[i - 1].group !== step.group;
          const isNext = status === 'pending' && enabled;

          return (
            <div key={step.id}>
            {showGroupHeader && (
              <h3 className="wizard-group-header">{step.group}</h3>
            )}
            <div
              className={`wizard-step wizard-step--${status}${isNext ? ' wizard-step--next' : ''}`}
            >
              <div className="wizard-step-header">
                <div className={`wizard-step-indicator wizard-step-indicator--${status}`}>
                  {status === 'done' && <span>&#10003;</span>}
                  {status === 'error' && <span>&#10007;</span>}
                  {status === 'active' && <span className="spinner small" />}
                  {status === 'pending' && <span>{step.id}</span>}
                </div>
                <div className="wizard-step-info">
                  <div className="wizard-step-name">{step.name}</div>
                  <div className="wizard-step-desc">{step.description}</div>
                </div>
                <button
                  className="wizard-step-btn"
                  onClick={() => runStep(i)}
                  disabled={!enabled}
                >
                  {status === 'active' ? 'Running...' : status === 'done' ? 'Done' : status === 'error' ? 'Retry' : 'Run'}
                </button>
              </div>

              <div className="wizard-step-technical">
                <code>{step.technicalDetail}</code>
              </div>

              {error && (
                <div className="wizard-step-error">{error}</div>
              )}

              {result && (
                <pre className="wizard-step-result">{result}</pre>
              )}
            </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
