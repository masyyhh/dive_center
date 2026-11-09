// Read-only release verification. Hash every original column in every business table.
const fs = require('node:fs');
const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
const addedCreditTables = ['BillItemInstructor', 'BillItemPhotoStaff'];
async function fingerprint(prisma, baseline, schema = 'public') {
  await prisma.$executeRawUnsafe("SET TIME ZONE 'UTC'");
  const columns = await prisma.$queryRawUnsafe(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema=$1 AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE')
    AND table_name <> '_prisma_migrations' ORDER BY table_name, ordinal_position`, schema);
  const actual = {};
  for (const row of columns) (actual[row.table_name] ||= []).push(row.column_name);
  const original = baseline ? Object.fromEntries(Object.entries(baseline.tables).map(([name, entry]) => [name, entry.columns])) : actual;
  for (const [name, fields] of Object.entries(original)) {
    if (!actual[name] || fields.some(field => !actual[name].includes(field))) throw Error('An original table or column is missing: ' + name);
  }
  if (baseline && Object.keys(actual).some(name => !original[name] && !addedCreditTables.includes(name))) throw Error('Unexpected new production table.');
  const tables = {};
  for (const [name, fields] of Object.entries(original)) {
    const [result] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::text AS count,
      encode(sha256(convert_to(COALESCE(string_agg(row_hash, '' ORDER BY row_hash), ''), 'UTF8')), 'hex') AS sha256
      FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex') AS row_hash
        FROM (SELECT ${fields.map(quote).join(', ')} FROM ${quote(schema)}.${quote(name)}) t) row_hashes`);
    tables[name] = { columns: fields, count: result.count, sha256: result.sha256 };
  }
  if (baseline) {
    for (const [table, legacy] of [['BillItemInstructor', 'instructorStaffId'], ['BillItemPhotoStaff', 'photoStaffId']]) {
      if (!actual[table]) throw Error('New credit table is missing: ' + table);
      const [row] = await prisma.$queryRawUnsafe(`SELECT
        (SELECT COUNT(*)::text FROM ${quote(schema)}."BillItem" WHERE ${quote(legacy)} IS NOT NULL) AS expected,
        (SELECT COUNT(*)::text FROM ${quote(schema)}.${quote(table)}) AS actual,
        (SELECT COUNT(*)::text FROM ${quote(schema)}."BillItem" line WHERE line.${quote(legacy)} IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ${quote(schema)}.${quote(table)} credit WHERE credit."billItemId"=line.id AND credit."staffId"=line.${quote(legacy)})) AS missing`);
      if (row.missing !== '0' || (!baseline.tables[table] && row.expected !== row.actual)) throw Error('Historical credit backfill does not match: ' + table);
    }
  }
  return { tables };
}
module.exports = { fingerprint };
if (require.main === module) {
  const { prisma } = require('/app/dist/db');
  const baseline = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : undefined;
  fingerprint(prisma, baseline).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error('Production data verification failed:', error.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
