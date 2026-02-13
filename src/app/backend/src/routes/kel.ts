/**
 * KEL Publishing Routes
 *
 * Serves KERI event logs and DID documents for did:webs resolution.
 * Mounted at root so the resolver can fetch /keri/{AID}/did.json and keri.cesr.
 */

import express, { Request, Response, NextFunction } from 'express';
import { getDidDocument, getKeriCesr, isValidAid, getAvailableAids, publishDidData } from '../services/kel-publisher';
import { getErrorMessage } from '@gleif/verifier-core';

const router: express.Router = express.Router();

/** Validates AID format and sends a 400 response if invalid. Returns true if invalid (response sent). */
function rejectInvalidAid(aid: string, res: Response): boolean {
  if (!isValidAid(aid)) {
    res.status(400).json({ error: 'Invalid AID format' });
    return true;
  }
  return false;
}

/**
 * GET /keri/aids
 * Lists available AIDs from trust anchors config.
 */
router.get('/keri/aids', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const aids = getAvailableAids();
    res.json({
      aids,
      didWebsFormat: 'did:webs:localhost%3A3000:keri:{AID}',
      endpoints: {
        didJson: '/keri/{AID}/did.json',
        keriCesr: '/keri/{AID}/keri.cesr',
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /keri/:aid/did.json
 * DID document for a KERI AID in did:webs format.
 * The did-webs-resolver hits this endpoint.
 */
router.get('/keri/:aid/did.json', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const aid = req.params.aid as string;
    if (rejectInvalidAid(aid, res)) return;

    // Determine the domain from the request
    const host = req.get('host') || 'localhost:3000';
    const domain = host.replace(':', '%3A'); // URL encode the port separator

    console.log(`[kel-publisher] Generating did.json for AID: ${aid}`);

    const didDocument = await getDidDocument(aid, domain, 'keri');

    res.setHeader('Content-Type', 'application/did+ld+json');
    res.json(didDocument);
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    if (message.includes('Unable to get key state')) {
      res.status(404).json({
        error: `AID not found: ${req.params.aid}`,
      });
      return;
    }
    next(error);
  }
});

/**
 * GET /keri/:aid/keri.cesr
 * KERI event log in CESR format for an AID.
 * The did-webs-resolver hits this endpoint.
 */
router.get('/keri/:aid/keri.cesr', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const aid = req.params.aid as string;
    if (rejectInvalidAid(aid, res)) return;

    console.log(`[kel-publisher] Fetching keri.cesr for AID: ${aid}`);

    const cesrData = await getKeriCesr(aid);

    res.setHeader('Content-Type', 'application/cesr');
    res.send(cesrData);
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    if (message.includes('Failed to fetch')) {
      res.status(404).json({
        error: `Failed to fetch CESR for AID: ${req.params.aid}`,
      });
      return;
    }
    next(error);
  }
});

/**
 * POST /keri/:aid/publish
 * Browser pushes DID document + DA CESR after DA credential issuance.
 */
router.post('/keri/:aid/publish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const aid = req.params.aid as string;
    if (rejectInvalidAid(aid, res)) return;

    const { didDocument, daCesr } = req.body;

    if (!didDocument || !didDocument.id) {
      res.status(400).json({ error: 'Missing or invalid didDocument in request body' });
      return;
    }

    publishDidData(aid, didDocument, daCesr);

    console.log(`[kel-publisher] Published DID data for AID: ${aid}`);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
