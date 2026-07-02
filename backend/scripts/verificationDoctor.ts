import 'dotenv/config';
import { prisma } from '../src/prisma/prisma.js';
import { verificationSchemaReadiness } from '../src/services/verification-v2/readiness.service.js';
import {clefScreeningConfiguration} from '../src/services/verification-v2/provider.service.js';
import { cleanlinessReleaseStatus } from '../src/services/verification-v2/cleanlinessRelease.js';

// Read-only. Never migrates, starts cron, infers photos, or prints credentials.
try {
  const schema = await verificationSchemaReadiness();
  const checks = {
    schema,
    processing: { mode:'DIRECT_REQUEST_V1', separateWorker:false, queue:false },
    credentials: Object.fromEntries(['VERIFICATION_QR_SECRET','VERIFICATION_SLOT_SECRET','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN'].map(name => [name, Boolean(process.env[name]?.trim())])),
    screening: { provider:'cloudflare', ...clefScreeningConfiguration() },
    cleanliness: { model: process.env.CLEF_MODEL ?? 'clef', candidateThresholdConfigured: Boolean(process.env.CLEF_CONFIDENCE_THRESHOLD?.trim()), candidateVersionConfigured: Boolean(process.env.CLEF_THRESHOLD_VERSION?.trim()), releaseByFixture: Object.fromEntries(['TOILET','SINK','MIRROR','FLOOR','BIN'].map(type=>[type,cleanlinessReleaseStatus(type)])) },
    spatial: { automaticAcceptance: false, assistedRecapture: process.env.VERIFICATION_SPATIAL_RECAPTURE_ENABLED === 'true' },
  };
  console.log(JSON.stringify(checks, null, 2));
  if (!schema.ready) process.exitCode = 1;
} catch {
  console.error('Could not inspect verification readiness. Check backend database connectivity. No changes were made.');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
