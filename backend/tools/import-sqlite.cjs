const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });
const { PrismaClient, Prisma } = require('@prisma/client');

const order = ['Property', 'User', 'UserProperty', 'StaffMember', 'Category', 'Item', 'Bill', 'BillItem', 'Attendance', 'MonthLock', 'AuditLog', 'Authenticator', 'PasswordReset'];
function normalize(field, value) {
  if (value === null) { if (field.isRequired) throw Error('A required source field is null.'); return null; }
  if (field.isList) { const parsed = typeof value === 'string' ? JSON.parse(value) : value; if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== 'string')) throw Error('Invalid list in source database.'); return parsed; }
  if (field.type === 'DateTime') {
    let parsed;
    if (typeof value === 'number' || /^-?\d+(?:\.0+)?$/.test(String(value))) parsed = new Date(Number(value));
    else { const text = String(value).replace(' ', 'T'); parsed = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`); }
    if (!Number.isFinite(parsed.getTime())) throw Error('Invalid date in source database.');
    return parsed;
  }
  if (field.type === 'Boolean') { if (![0, 1, true, false].includes(value)) throw Error('Invalid boolean in source database.'); return Boolean(value); }
  return value;
}
const stable = rows => JSON.stringify(rows.map(row => Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]]))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
async function importSqlite(sourcePath, targetUrl) {
  if (!sourcePath || !fs.existsSync(sourcePath)) throw Error('Provide an existing SQLite snapshot file.');
  const parsed = new URL(targetUrl);
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) throw Error('The target must be PostgreSQL.');
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });
  try {
    if (source.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || source.prepare('PRAGMA foreign_key_check').all().length) throw Error('The source snapshot failed integrity or foreign-key validation.');
    const tables = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const dataset = order.map(name => {
      const model = Prisma.dmmf.datamodel.models.find(model => model.name === name);
      if (!tables.has(name)) throw Error('Source schema is incomplete. Upgrade the SQLite source before importing.');
      const columns = new Set(source.prepare(`PRAGMA table_info("${name}")`).all().map(row => row.name));
      const fields = model.fields.filter(field => field.kind === 'scalar');
      const additive = new Set(name === 'Property' ? ['pmsPropertyCodes'] : name === 'StaffMember' ? ['userId'] : name === 'User' ? ['deletedAt'] : name === 'Item' ? ['includesComplimentaryMedia'] : name === 'BillItem' ? ['includesComplimentaryMedia', 'poolTypeSnapshot', 'poolContributionAmount', 'linePosition', 'autoPhotoForLineId'] : []);
      if (fields.some(field => !columns.has(field.name) && !additive.has(field.name))) throw Error('Source schema is outdated. Use the final SQLite application schema before importing.');
      const records = source.prepare(`SELECT * FROM "${name}"`).all().map(row => Object.fromEntries(fields.map(field => [field.name, columns.has(field.name) ? normalize(field, row[field.name]) : field.name === 'pmsPropertyCodes' ? (row.pmsPropertyCode ? [row.pmsPropertyCode] : []) : field.name === 'includesComplimentaryMedia' ? false : field.name === 'linePosition' ? 0 : null])));
      return { name, delegate: name[0].toLowerCase() + name.slice(1), fields, records };
    });
    // Derive additive pool snapshots for old SQLite files using their original
    // catalogue amounts and locks before converting course/dive rates to 10%.
    const rowsFor = name => dataset.find(table => table.name === name).records;
    const billsById = new Map(rowsFor('Bill').map(bill => [bill.id, bill]));
    const itemsById = new Map(rowsFor('Item').map(item => [item.id, item]));
    const lockedMonths = new Set(rowsFor('MonthLock').filter(lock => lock.isLocked).map(lock => JSON.stringify([lock.propertyId, lock.yearMonth])));
    for (const line of rowsFor('BillItem')) {
      if (line.poolTypeSnapshot != null && line.poolContributionAmount != null) continue;
      const bill = billsById.get(line.billId);
      const candidate = itemsById.get(line.itemId);
      const item = candidate?.propertyId === bill?.propertyId ? candidate : null;
      line.poolTypeSnapshot = item?.poolType || 'NONE';
      const percentage = ['COURSE_POOL', 'DIVE_POOL'].includes(line.poolTypeSnapshot);
      line.poolContributionAmount = percentage && !lockedMonths.has(JSON.stringify([bill.propertyId, bill.businessDate.slice(0, 7)]))
        ? Math.max(0, line.lineTotal) * 0.10
        : item && ['COURSE_POOL', 'DIVE_POOL', 'CERTIFICATION_POOL'].includes(item.poolType) && Number.isFinite(item.poolContribution) && item.poolContribution >= 0
          ? item.poolContribution * line.quantity : 0;
    }
    for (const item of rowsFor('Item')) if (['COURSE_POOL', 'DIVE_POOL'].includes(item.poolType)) item.poolContribution = 10;
    await target.$transaction(async tx => {
      for (const table of dataset) if (await tx[table.delegate].count()) throw Error('Target application tables must be empty. Existing records will never be replaced.');
      for (const table of dataset) {
        for (let i = 0; i < table.records.length; i += 500) await tx[table.delegate].createMany({ data: table.records.slice(i, i + 500) });
      }
      for (const table of dataset) {
        const rows = await tx[table.delegate].findMany();
        if (stable(rows) !== stable(table.records)) throw Error('Imported rows do not match the source snapshot.');
      }
    }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 120000 });
    return dataset.map(table => ({ table: table.name, count: table.records.length }));
  } finally { source.close(); await target.$disconnect(); }
}
if (require.main === module) {
  (async () => {
    const file = process.env.DATABASE_URL_FILE;
    if (file && process.env.DATABASE_URL) throw Error('Set only DATABASE_URL or DATABASE_URL_FILE.');
    const url = file ? fs.readFileSync(file, 'utf8').trim() : process.env.DATABASE_URL;
    const counts = await importSqlite(process.argv[2], url);
    for (const row of counts) console.log(`${row.table}: ${row.count} verified rows`);
    console.log('Import committed. Source snapshot was opened read-only and remains unchanged.');
  })().catch(() => { console.error('Import failed. The target must be migrated and empty, and the snapshot must match the final SQLite schema. Import changes were rolled back. No source rows were changed.'); process.exitCode = 1; });
}
module.exports = { importSqlite, normalize };
