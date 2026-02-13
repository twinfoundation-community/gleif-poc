import type { PublicTrustChainConfig, VerificationResult, NftAttestation, DidLinkageResult } from '@gleif/verifier-core';

export const API_BASE = 'http://localhost:3000';

export class ApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text().catch(() => 'Request failed');
    throw new ApiError(message, response.status);
  }
  return response.json();
}

export async function fetchConfig(): Promise<PublicTrustChainConfig> {
  const response = await fetch(`${API_BASE}/api/config`);
  return handleResponse<PublicTrustChainConfig>(response);
}

export async function mintNft(verificationResult?: VerificationResult): Promise<NftAttestation> {
  const response = await fetch(`${API_BASE}/api/nft/mint`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(verificationResult ? { verificationResult } : {}),
  });
  return handleResponse<NftAttestation>(response);
}

async function verifyLinkageFromWebs(didWebs: string): Promise<DidLinkageResult> {
  const response = await fetch(`${API_BASE}/api/verify-did-linking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ didWebs }),
  });
  return handleResponse<DidLinkageResult>(response);
}

async function verifyLinkageFromIota(didIota: string): Promise<DidLinkageResult> {
  const response = await fetch(
    `${API_BASE}/api/verify-linkage/from-iota/${encodeURIComponent(didIota)}`
  );
  return handleResponse<DidLinkageResult>(response);
}

export async function fetchKeriCesr(aid: string): Promise<string> {
  const response = await fetch(`${API_BASE}/keri/${aid}/keri.cesr`);
  if (!response.ok) {
    throw new ApiError('Failed to fetch keri.cesr', response.status);
  }
  return response.text();
}

export async function verifyLinkage(did: string): Promise<DidLinkageResult> {
  if (did.startsWith('did:webs:')) {
    return verifyLinkageFromWebs(did);
  } else if (did.startsWith('did:iota:')) {
    return verifyLinkageFromIota(did);
  }
  throw new ApiError('Unsupported DID format. Use did:webs: or did:iota:');
}
