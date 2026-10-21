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
      const additive = new Set(name === 'Property' ? ['pmsPropertyCodes'] : name === 'StaffMember' ? ['userId'] : []);
      if (fields.some(field => !columns.has(field.name) && !additive.has(field.name))) throw Error('Source schema is outdated. Use the final SQLite application schema before importing.');
      const records = source.prepare(`SELECT * FROM "${name}"`).all().map(row => Object.fromEntries(fields.map(field => [field.name, columns.has(field.name) ? normalize(field, row[field.name]) : field.name === 'pmsPropertyCodes' ? (row.pmsPropertyCode ? [row.pmsPropertyCode] : []) : null])));
      return { name, delegate: name[0].toLowerCase() + name.slice(1), fields, records };
    });
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
