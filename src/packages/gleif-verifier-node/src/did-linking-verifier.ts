/**
 * DID Linking Verifier
 *
 * Full DID linking verification flow:
 * 1. Resolve did:webs (dkr resolver, KEL publisher fallback)
 * 2. Extract alsoKnownAs (did:iota)
 * 3. Check bidirectional link (did:iota links back to did:webs)
 * 4. Present credential to Sally via IPEX
 * 5. Sally walks trust chain: LE -> QVI -> GLEIF root
 * 6. Return result with linked DID info + bidirectional status
 */

import {
  isoTimestamp,
  getErrorMessage,
  extractIotaDid,
  extractAidFromDidWebs,
  extractKeriServiceEndpoint,
  type DIDDocument,
  type VerificationResult,
} from '@gleif/verifier-core';

/** verification result extended with DID linking info */
export interface DidLinkingVerificationResult extends VerificationResult {
  /** resolved did:webs */
  didWebs?: string;
  /** linked did:iota from alsoKnownAs */
  linkedIotaDid?: string;
  /** true if did:iota links back to did:webs */
  bidirectional?: boolean;
  /** KERI service endpoint from the DID document */
  keriServiceEndpoint?: string;
  /** full did:webs document */
  websDocument?: DIDDocument;
  /** full did:iota document */
  iotaDocument?: IotaDidDocLike;
  /** alsoKnownAs from did:webs document (what KERI side claims) */
  websAlsoKnownAs?: string[];
  /** alsoKnownAs from did:iota document (what IOTA side claims) */
  iotaAlsoKnownAs?: string[];
  /** DA credential verified via dkr resolver CESR verification */
  daVerified?: boolean;
}

/** deps injected into DidLinkingVerifier -- lets the caller control resolution/verification */
/** minimal IOTA DID doc shape; concrete impls may be more specific */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IotaDidDocLike = { id: string; alsoKnownAs?: any; [key: string]: any };

interface DidLinkingDeps {
  /** resolve did:webs via dkr resolver (cryptographically verifies DA credential) */
  resolveDidWebs: (did: string) => Promise<DIDDocument>;
  /** build DID doc from local KEL publisher (fallback -- DA credential NOT verified) */
  getDidDocument: (aid: string, domain: string, path: string) => Promise<DIDDocument>;
  /** resolve did:iota from the IOTA network */
  resolveIotaDid: (did: string) => Promise<IotaDidDocLike>;
  /** Extract did:webs from a resolved IOTA DID document */
  extractWebsDid: (doc: IotaDidDocLike) => string | null;
  /** Verify LE credential via Sally (IPEX grant + webhook) */
  verifyLeCredential: () => Promise<VerificationResult>;
}

/** config for the DID linking verifier */
interface DidLinkingConfig {
  /** Default domain for KEL publisher fallback (e.g., 'backend') */
  kelPublisherDomain?: string;
  /** Default path for KEL publisher fallback (e.g., 'keri') */
  kelPublisherPath?: string;
}

/**
 * Orchestrates the full DID linking verification flow.
 *
 * Given a did:webs, verifies the DID document, bidirectional linkage
 * between did:webs and did:iota, and the vLEI trust chain via Sally.
 */
export class DidLinkingVerifier {
  private readonly domain: string;
  private readonly path: string;

  constructor(
    private readonly deps: DidLinkingDeps,
    config?: DidLinkingConfig,
  ) {
    this.domain = config?.kelPublisherDomain ?? 'localhost';
    this.path = config?.kelPublisherPath ?? 'keri';
  }

  /** run the full DID linking verification for a did:webs identifier */
  async verify(didWebs: string): Promise<DidLinkingVerificationResult> {
    let didDocument: DIDDocument;
    let linkedIotaDid: string | null = null;
    let keriServiceEndpoint: string | null = null;
    let resolvedViaDkr = false;

    // Step 1: Resolve did:webs
    // try dkr first (verifies DA cred in CESR), fall back to local KEL publisher
    const aid = extractAidFromDidWebs(didWebs);
    if (!aid) {
      throw new Error(`Invalid did:webs format: ${didWebs}`);
    }

    try {
      didDocument = await this.deps.resolveDidWebs(didWebs);
      resolvedViaDkr = true;
    } catch (resolverError: unknown) {
      const resolverMessage = getErrorMessage(resolverError);
      // fall back to local KEL publisher (DA unverified)
      try {
        didDocument = await this.deps.getDidDocument(aid, this.domain, this.path);
      } catch (kelError: unknown) {
        throw new Error(
          `Failed to resolve ${didWebs}: Resolver: ${resolverMessage}, KEL publisher: ${getErrorMessage(kelError)}`,
        );
      }
    }

    // Validate we got a real document
    if (!didDocument || !didDocument.id || didDocument.id.includes('Keystore')) {
      throw new Error(`Invalid DID document for ${didWebs}`);
    }

    // DA is verified if dkr resolved it and we got alsoKnownAs
    const daVerified = resolvedViaDkr && (didDocument.alsoKnownAs?.length ?? 0) > 0;

    // Step 2: Extract alsoKnownAs (did:iota) from document
    linkedIotaDid = extractIotaDid(didDocument);
    keriServiceEndpoint = extractKeriServiceEndpoint(didDocument);

    // Step 3: Verify bidirectional link (did:iota should link back to did:webs)
    let bidirectional = false;
    let iotaAlsoKnownAs: string[] | undefined;
    let iotaDocumentResolved: IotaDidDocLike | undefined;

    if (linkedIotaDid) {
      try {
        const iotaDocument = await this.deps.resolveIotaDid(linkedIotaDid);
        iotaDocumentResolved = iotaDocument;
        const reverseLinkedWebs = this.deps.extractWebsDid(iotaDocument);

        // normalize alsoKnownAs to array
        const iotaAka = iotaDocument.alsoKnownAs;
        iotaAlsoKnownAs = Array.isArray(iotaAka) ? iotaAka : iotaAka ? [String(iotaAka)] : [];

        // Check if the did:iota links back to our did:webs
        bidirectional = reverseLinkedWebs === didWebs;
      } catch {
        // continue without bidirectional -- the vLEI chain is still valid
      }
    }

    // Step 4: Verify credential via Sally
    try {
      const verificationResult = await this.deps.verifyLeCredential();

      return {
        ...verificationResult,
        didWebs,
        linkedIotaDid: linkedIotaDid || undefined,
        bidirectional,
        keriServiceEndpoint: keriServiceEndpoint || undefined,
        websDocument: didDocument,
        iotaDocument: iotaDocumentResolved,
        websAlsoKnownAs: didDocument.alsoKnownAs || [],
        iotaAlsoKnownAs,
        daVerified,
      };
    } catch (error: unknown) {
      return {
        verified: false,
        revoked: false,
        leAid: '',
        leLei: '',
        credentialSaid: '',
        timestamp: isoTimestamp(),
        error: `Verification failed: ${getErrorMessage(error)}`,
        didWebs,
        linkedIotaDid: linkedIotaDid || undefined,
        bidirectional,
        keriServiceEndpoint: keriServiceEndpoint || undefined,
        websDocument: didDocument,
        iotaDocument: iotaDocumentResolved,
        websAlsoKnownAs: didDocument.alsoKnownAs || [],
        iotaAlsoKnownAs,
        daVerified: false,
      };
    }
  }
}
