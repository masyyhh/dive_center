if (process.env.CI !== 'true' || process.env.SMOKE_TEST !== '1') {
  console.error('This restore fixture check requires CI=true and SMOKE_TEST=1.');
  process.exit(1);
}
const { createHash } = require('node:crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
const { loadDatabaseUrl } = require('../dist/config/database');
const { decryptSecret } = require('../dist/services/authenticatorService');
const sourceUrl = loadDatabaseUrl();
const restoredUrl = new URL(sourceUrl); restoredUrl.pathname = '/dive_center_restore_test';
const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
const restored = new PrismaClient({ datasources: { db: { url: restoredUrl.toString() } } });
const digest = rows => createHash('sha256').update(JSON.stringify(rows.map(row => Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]]))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest('hex');
(async () => {
  for (const model of Prisma.dmmf.datamodel.models) {
    const delegate = model.name[0].toLowerCase() + model.name.slice(1);
    const [before, after] = await Promise.all([source[delegate].findMany(), restored[delegate].findMany()]);
    if (digest(before) !== digest(after)) throw Error('Restored application data mismatch.');
  }
  const bindings = await restored.authenticator.findMany({ where: { enrolledAt: { not: null } } });
  if (!bindings.length) throw Error('Missing restored authenticator fixture.');
  for (const binding of bindings) decryptSecret(binding.userId, binding.secretCiphertext);
  const index = await restored.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'Bill_live_check_number_key'`;
  if (index.length !== 1) throw Error('Missing restored live-check uniqueness index.');
  console.log('Restore smoke check passed: every application model matches, authenticator decryption works and the unique index exists.');
})().catch(() => { console.error('Restore smoke check failed. No record contents or credentials are printed.'); process.exitCode = 1; }).finally(async () => { await Promise.all([source.$disconnect(), restored.$disconnect()]); });
