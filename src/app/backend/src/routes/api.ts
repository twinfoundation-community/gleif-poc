import express, { Request, Response, NextFunction } from 'express';
import { getPublicConfig, loadTrustAnchors, getEnvConfig } from '../services/config';
import { verifyLeCredential, checkSallyStatus } from '../services/sally-client';
import { mintAttestationNft, type LinkageInfo, type TrustChainInfo } from '../services/attestation-service';
import { resolveVerification } from '../services/verification-state';
import { resolveDid } from '../services/did-webs-client';
import { verifyDidLinking } from '../services/did-linking-verifier';
import {
  createIotaDid,
  resolveIotaDid,
  addServiceToIotaDid,
  addAlsoKnownAsToIotaDid,
  extractWebsDid,
  getConfiguredIdentity,
} from '../services/iota-identity-service';
import {
  isoTimestamp,
  getErrorMessage,
  extractIotaDid,
  extractKeriServiceEndpoint,
  type VerificationResult,
} from '@gleif/verifier-core';

const router: express.Router = express.Router();

// Store the last verification result for the mint endpoint
let lastVerificationResult: VerificationResult | null = null;

/**
 * GET /api/config
 * Returns public trust chain config -- no secrets
 */
router.get('/config', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getPublicConfig();
    res.json(config);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/status
 * Check system status (Sally availability, config loaded)
 */
router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const sallyAvailable = await checkSallyStatus();
    let configLoaded = false;

    try {
      loadTrustAnchors();
      configLoaded = true;
    } catch {
      configLoaded = false;
    }

    res.json({
      configLoaded,
      sallyAvailable,
      timestamp: isoTimestamp(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/verify
 * Trigger Sally verification for the pre-configured test LE
 */
router.post('/verify', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await verifyLeCredential();

    // Store for potential NFT minting
    lastVerificationResult = result;

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/nft/mint
 * Mint a vLEI linkage attestation on IOTA
 */
router.post('/nft/mint', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const verificationResult = lastVerificationResult;

    if (!verificationResult) {
      res.status(400).json({
        error: 'No verification result available. Run /api/verify first.',
      });
      return;
    }

    if (!verificationResult.verified) {
      res.status(400).json({
        error: 'Cannot mint attestation for failed verification.',
        verificationResult,
      });
      return;
    }

    let linkageInfo: LinkageInfo | undefined;
    let trustChainInfo: TrustChainInfo | undefined;

    try {
      const config = loadTrustAnchors();
      const didWebs = `did:webs:backend:keri:${config.le.aid}`;

      linkageInfo = {
        didWebs,
        didIota: config.le.iotaDid || '',
      };

      trustChainInfo = {
        gleifAid: config.gleif.aid,
        qviAid: config.qvi.aid,
        qviCredentialSaid: config.qviCredential.said,
      };

      console.log('Minting vLEI attestation with linkage info:', linkageInfo);
    } catch (configError) {
      console.warn('Could not load trust anchors config, minting with minimal info');
    }

    const attestation = await mintAttestationNft(verificationResult, linkageInfo, trustChainInfo);

    console.log('NFT minted:', attestation);

    res.json(attestation);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/resolve-did/:did
 * Resolve a DID and return the document with extracted info.
 * :did should be URL-encoded if it contains special characters.
 */
router.get('/resolve-did/:did', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const did = decodeURIComponent(req.params.did as string);

    if (!did || !did.startsWith('did:')) {
      res.status(400).json({
        error: 'Invalid DID format. DID must start with "did:"',
      });
      return;
    }

    console.log(`Resolving DID: ${did}`);

    const document = await resolveDid(did);
    const iotaDid = extractIotaDid(document);
    const keriServiceEndpoint = extractKeriServiceEndpoint(document);

    res.json({
      document,
      iotaDid,
      keriServiceEndpoint,
      hasIotaLinkage: iotaDid !== null,
    });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    if (message.includes('DID resolution failed')) {
      res.status(404).json({
        error: message,
      });
      return;
    }
    next(error);
  }
});

/**
 * POST /api/verify-did-linking
 * Full DID linking verification for a did:webs identifier.
 *
 * Body: { didWebs: string }
 *
 * Resolves did:webs -> extracts linked did:iota -> verifies bidirectional link
 * -> presents LE credential to Sally via IPEX -> Sally walks the trust chain
 */
router.post('/verify-did-linking', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { didWebs } = req.body;

    if (!didWebs) {
      res.status(400).json({
        error: 'Missing didWebs parameter',
      });
      return;
    }

    if (!didWebs.startsWith('did:webs:')) {
      res.status(400).json({
        error: 'Invalid did:webs format',
      });
      return;
    }

    console.log(`Starting DID linking verification for: ${didWebs}`);

    const result = await verifyDidLinking(didWebs);

    // Store for potential NFT minting
    if (result.verified) {
      lastVerificationResult = result;
    }

    res.json(result);
  } catch (error: unknown) {
    next(error);
  }
});

/**
 * POST /api/iota/create-did
 * Create a new IOTA DID on-chain.
 *
 * Body (optional): { controller: string }
 * Defaults to the configured identity; controller must have a mnemonic in the vault.
 */
router.post('/iota/create-did', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { controller } = req.body;
    const result = await createIotaDid(controller);
    res.json({
      ...result,
      controller: controller || getConfiguredIdentity(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/iota/add-service
 * Add a service endpoint to an IOTA DID document.
 *
 * Body: { documentId, serviceId, serviceType, endpoint, controller? }
 * controller defaults to configured identity from NFT setup.
 */
router.post('/iota/add-service', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { controller, documentId, serviceId, serviceType, endpoint } = req.body;

    if (!documentId || !serviceId || !serviceType || !endpoint) {
      res.status(400).json({
        error: 'Missing required fields: documentId, serviceId, serviceType, endpoint (controller is optional)',
      });
      return;
    }

    await addServiceToIotaDid(controller, documentId, serviceId, serviceType, endpoint);
    res.json({
      success: true,
      controller: controller || getConfiguredIdentity(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/iota/add-also-known-as
 * Add alsoKnownAs entries to an IOTA DID document -- establishes
 * the reverse link for bidirectional DID verification.
 *
 * Body: { documentId, aliases, controller? }
 * aliases is an array of DID strings; controller defaults to configured identity.
 */
router.post('/iota/add-also-known-as', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { controller, documentId, aliases } = req.body;

    if (!documentId || !aliases) {
      res.status(400).json({
        error: 'Missing required fields: documentId, aliases (controller is optional)',
      });
      return;
    }

    if (!Array.isArray(aliases) || aliases.length === 0) {
      res.status(400).json({
        error: 'aliases must be a non-empty array of DID strings',
      });
      return;
    }

    await addAlsoKnownAsToIotaDid(controller, documentId, aliases);
    res.json({
      success: true,
      controller: controller || getConfiguredIdentity(),
      documentId,
      aliases,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/iota/resolve/:did
 * Resolves an IOTA DID document
 */
router.get('/iota/resolve/:did', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const did = decodeURIComponent(req.params.did as string);

    if (!did.startsWith('did:iota:')) {
      res.status(400).json({
        error: 'Invalid DID format. Must be a did:iota: identifier',
      });
      return;
    }

    const document = await resolveIotaDid(did);
    res.json(document);
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    if (message.includes('not found') || message.includes('resolve')) {
      res.status(404).json({
        error: `Failed to resolve DID: ${message}`,
      });
      return;
    }
    next(error);
  }
});

/**
 * GET /api/verify-linkage/from-iota/:did
 * Direction 2: verify did:iota -> did:webs linkage with bidirectional check.
 *
 * Resolves IOTA DID -> extracts linked did:webs -> verifies vLEI chain via Sally
 * -> confirms bidirectional linkage
 */
router.get('/verify-linkage/from-iota/:did', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const didIota = decodeURIComponent(req.params.did as string);

    if (!didIota.startsWith('did:iota:')) {
      res.status(400).json({
        error: 'Invalid DID format. Must be a did:iota: identifier',
      });
      return;
    }

    console.log(`[verify-linkage] Starting Direction 2 verification for: ${didIota}`);

    // Step 1: Resolve IOTA DID (required - no fallback)
    let iotaDoc;
    try {
      iotaDoc = await resolveIotaDid(didIota);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      console.log(`[verify-linkage] IOTA DID resolution failed: ${message}`);
      res.status(502).json({
        verified: false,
        error: `Failed to resolve IOTA DID: ${message}`,
        didIota,
      });
      return;
    }

    // Step 2: Extract linked did:webs from resolved document
    const linkedWebsDid = extractWebsDid(iotaDoc);

    if (!linkedWebsDid) {
      res.json({
        verified: false,
        error: 'No did:webs found in IOTA DID document',
        didIota,
        alsoKnownAs: iotaDoc?.alsoKnownAs || [],
        service: iotaDoc?.service || [],
      });
      return;
    }

    console.log(`[verify-linkage] Found linked did:webs: ${linkedWebsDid}`);

    // Step 3: Verify did:webs has valid vLEI chain
    const websVerification = await verifyDidLinking(linkedWebsDid);

    // Step 4: Verify bidirectional link
    const bidirectional = websVerification.linkedIotaDid === didIota;

    // Normalize iotaDoc alsoKnownAs to array
    const iotaAka = iotaDoc?.alsoKnownAs;
    const iotaAlsoKnownAs = Array.isArray(iotaAka) ? iotaAka : iotaAka ? [iotaAka] : [];

    res.json({
      verified: websVerification.verified && bidirectional,
      bidirectional,
      didIota,
      linkedWebsDid,
      vLeiVerified: websVerification.verified,
      leAid: websVerification.leAid,
      leLei: websVerification.leLei,
      timestamp: isoTimestamp(),
      iotaDocument: iotaDoc,
      websDocument: websVerification.websDocument,
      iotaAlsoKnownAs,
      websAlsoKnownAs: websVerification.websAlsoKnownAs || [],
      daVerified: websVerification.daVerified,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /webhook/sally
 * Webhook for Sally verification callbacks.
 *
 * Sally posts here after processing credentials. Credential SAID comes from
 * either the `sally-resource` header or `credential` in the body.
 */
router.post('/webhook/sally', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sallyResource = req.headers['sally-resource'] as string | undefined;
    const sallyTimestamp = req.headers['sally-timestamp'];

    console.log('Sally webhook received:');
    console.log('  Resource:', sallyResource);
    console.log('  Timestamp:', sallyTimestamp);
    const { action, data } = req.body;

    // Extract credential SAID from body.data or header
    // Sally webhook structure is: { action, actor, data: { credential, schema, ... } }
    let credentialSaid: string | undefined;

    // Get from data.credential first (Sally's actual payload structure)
    if (data?.credential) {
      // credential might be a full object with .d or just a SAID string
      credentialSaid = typeof data.credential === 'object' ? data.credential.d : data.credential;
    }

    // Fall back to sally-resource header (format may vary)
    if (!credentialSaid && sallyResource) {
      // Sally-resource might be formatted as "/credential/{said}" or just the SAID
      const match = sallyResource.match(/([A-Za-z0-9_-]{44})/);
      if (match) {
        credentialSaid = match[1];
      }
    }

    if (!credentialSaid) {
      console.warn('Could not extract credential SAID from webhook');
      res.status(200).json({ received: true, warning: 'No credential SAID found' });
      return;
    }

    console.log(`  Credential SAID: ${credentialSaid}`);

    const verified = action === 'iss';
    const revoked = action === 'rev';

    if (verified) {
      console.log('Credential verified by Sally');
    } else if (revoked) {
      console.log('Credential marked as revoked by Sally');
    } else {
      console.log(`Unknown action from Sally: ${action}`);
    }

    // Resolve any pending verification for this credential
    const resolved = resolveVerification(credentialSaid, verified, revoked);

    res.status(200).json({
      received: true,
      action,
      credentialSaid,
      resolved,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
