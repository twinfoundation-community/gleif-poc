import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import apiRouter from './routes/api';
import kelRouter from './routes/kel';
import { getEnvConfig, loadTrustAnchors } from './services/config';
import { initializeIotaConnector } from './services/iota-connector-setup';
import { initializeIdentityConnector } from './services/identity-connector-setup';
import { isoTimestamp } from '@gleif/verifier-core';

const app = express();
const env = getEnvConfig();

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3001', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: isoTimestamp(),
    version: '0.0.1',
  });
});

app.use('/api', apiRouter);

// KEL routes -- mounted at root so did:webs resolver can fetch
// /keri/{AID}/did.json and /keri/{AID}/keri.cesr directly
app.use('/', kelRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err.message);
  console.error(err.stack);

  res.status(500).json({
    error: err.message || 'Internal server error',
    timestamp: isoTimestamp(),
  });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
    timestamp: isoTimestamp(),
  });
});

async function start() {
  console.log('Starting vLEI Linkage Verifier Backend...');

  try {
    const config = loadTrustAnchors();
    console.log('Trust anchors loaded:');
    console.log(`  GLEIF AID: ${config.gleif.aid}`);
    console.log(`  QVI AID: ${config.qvi.aid}`);
    console.log(`  LE AID: ${config.le.aid}`);
    console.log(`  LE LEI: ${config.le.lei}`);
    console.log(`  Sally configured: ${config.sally.configured}`);
  } catch (error) {
    console.warn('Trust anchors not loaded:', error);
    console.warn('Run setup-trust-anchors.ts first to configure the trust chain.');
  }

  console.log('Environment:');
  console.log(`  Port: ${env.port}`);
  console.log(`  Sally URL: ${env.sallyUrl}`);
  console.log(`  KERIA URL: ${env.keriaUrl}`);
  console.log(`  IOTA Node URL: ${env.iotaNodeUrl}`);

  // Initialize IOTA connector (vault + wallet for attestation minting and identity)
  const nftMnemonic = process.env.NFT_MNEMONIC;
  const nftIdentity = process.env.NFT_IDENTITY || 'attestation-service';
  const iotaEnabled = await initializeIotaConnector(nftMnemonic, nftIdentity);
  console.log(`  Attestation Minting: ${iotaEnabled ? 'enabled' : 'disabled (set NFT_MNEMONIC to enable)'}`);

  // Initialize IOTA identity connector (must be after IOTA connector for vault access)
  try {
    const identityEnabled = await initializeIdentityConnector(nftIdentity);
    console.log(`  IOTA Identity: ${identityEnabled ? 'enabled (real on-chain DIDs)' : 'not available'}`);
  } catch (error) {
    console.warn('  IOTA Identity: failed to initialize -', error);
  }

  app.listen(env.port, () => {
    console.log(`Server running on port ${env.port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
