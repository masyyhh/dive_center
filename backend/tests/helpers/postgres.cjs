const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });
const { PrismaClient } = require('@prisma/client');

function createTestDatabase(label) {
  let url;
  try { url = new URL(process.env.TEST_DATABASE_URL || ''); }
  catch { throw new Error('Set TEST_DATABASE_URL to a separate PostgreSQL database ending in _test.'); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !/^\/[A-Za-z0-9_]*_test$/.test(url.pathname)) throw new Error('Integration tests require a separate database whose name ends in _test.');
  const schema = `dcm_test_${label.replace(/[^a-z0-9]/g, '')}_${randomUUID().replace(/-/g, '')}`;
  url.searchParams.set('schema', schema);
  const databaseUrl = url.toString();
  execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(root, 'prisma/schema.prisma')], { env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_URL_FILE: '', CHECKPOINT_DISABLE: '1' }, stdio: 'pipe' });
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  return { prisma, schema, databaseUrl, async dispose() {
    try { await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); } finally { await prisma.$disconnect(); }
  } };
}
module.exports = { createTestDatabase };
