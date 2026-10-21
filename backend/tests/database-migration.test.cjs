const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Prisma } = require('@prisma/client');
const { createTestDatabase } = require('./helpers/postgres.cjs');
const { importSqlite, normalize } = require('../tools/import-sqlite.cjs');
const { loadTypeScript } = require('./helpers/runtime.cjs');
const database = createTestDatabase('import');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcm-import-'));
const timestamp = 1760932800000;
const snapshot = (filename, badReference = false) => {
  const sqlite = new DatabaseSync(filename);
  const samples = {
    Property: { id: 'p', code: 'P', name: 'Preserved Centre', deletedAt: null },
    User: { id: 'u', username: 'preserved.admin', name: 'Preserved User', passwordHash: 'preserve-this-hash', role: 'GLOBAL_ADMIN' },
    UserProperty: { id: 'up', userId: 'u', propertyId: 'p' },
    StaffMember: { id: 's', propertyId: 'p', name: 'Preserved Staff', roleTitle: 'Instructor', hireDate: '2026-01-01' },
    Category: { id: 'c', propertyId: 'p', name: 'Dives' },
    Item: { id: 'i', propertyId: 'p', categoryId: 'c', code: 'DIVE', name: 'Dive', price: 123.45 },
    Bill: { id: 'b', propertyId: 'p', createdById: badReference ? 'missing' : 'u', checkNumber: 1001, businessDate: '2026-10-20', guestName: 'Preserved Guest', roomNumber: '104', netAmount: 123.45 },
    BillItem: { id: 'bi', billId: 'b', itemId: 'i', itemName: 'Dive', categoryName: 'Dives', quantity: 1, unitPrice: 123.45, lineTotal: 123.45, sellerStaffId: 's' },
    Attendance: { id: 'a', propertyId: 'p', staffMemberId: 's', date: '2026-10-20' },
    MonthLock: { id: 'm', propertyId: 'p', yearMonth: '2026-09', lockedById: 'u' },
    AuditLog: { id: 'al', propertyId: 'p', userId: 'u', action: 'FIXTURE', targetType: 'Property', targetId: 'p' },
    Authenticator: { userId: 'u', version: 'binding-v1', secretCiphertext: 'preserve-encrypted-secret', recoveryCodeHashes: '["preserved-backup-hash"]', enrolledAt: timestamp },
    PasswordReset: { userId: 'u', credentialHash: 'preserved-credential', tokenHash: 'preserved-token', authenticatorVersion: 'binding-v1' },
  };
  for (const model of Prisma.dmmf.datamodel.models) {
    const fields = model.fields.filter(field => field.kind === 'scalar');
    sqlite.exec(`CREATE TABLE "${model.name}" (${fields.map(field => `"${field.name}" ${field.type === 'Float' ? 'REAL' : ['Int', 'Boolean'].includes(field.type) ? 'INTEGER' : 'TEXT'}`).join(',')})`);
    const values = fields.map(field => {
      if (field.name in samples[model.name]) return samples[model.name][field.name];
      if (!field.isRequired) return null;
      if (field.type === 'DateTime') return field.name === 'createdAt' ? '2025-10-20 04:00:00' : timestamp;
      if (field.type === 'Boolean') return field.default === true ? 1 : 0;
      if (typeof field.default === 'string' || typeof field.default === 'number') return field.default;
      if (field.name === 'version') return 'version';
      throw Error(`Missing fixture field ${model.name}.${field.name}`);
    }).map(value => typeof value === 'boolean' ? Number(value) : value);
    sqlite.prepare(`INSERT INTO "${model.name}" VALUES (${fields.map(() => '?').join(',')})`).run(...values);
  }
  sqlite.close();
};
const clear = async () => {
  for (const name of ['passwordReset', 'authenticator', 'auditLog', 'monthLock', 'attendance', 'billItem', 'bill', 'item', 'category', 'staffMember', 'userProperty', 'user', 'property']) await database.prisma[name].deleteMany();
};
test.beforeEach(clear);
test.after(async () => { await database.dispose(); fs.rmSync(temp, { recursive: true, force: true }); });

test('SQLite import preserves every row, credential, encrypted authenticator, date, boolean and money value', async () => {
  const filename = path.join(temp, 'valid.db'); snapshot(filename);
  const digest = () => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  const before = digest(); const imported = await importSqlite(filename, database.databaseUrl);
  assert.equal(imported.length, 13); assert.equal(imported.every(row => row.count === 1), true);
  assert.equal(digest(), before);
  const user = await database.prisma.user.findUnique({ where: { id: 'u' } });
  assert.equal(user.passwordHash, 'preserve-this-hash'); assert.equal(user.isActive, true);
  assert.equal(user.createdAt.toISOString(), '2025-10-20T04:00:00.000Z');
  assert.equal(user.updatedAt.getTime(), timestamp);
  assert.equal((await database.prisma.bill.findUnique({ where: { id: 'b' } })).netAmount, 123.45);
  assert.equal((await database.prisma.authenticator.findUnique({ where: { userId: 'u' } })).secretCiphertext, 'preserve-encrypted-secret');
  await assert.rejects(importSqlite(filename, database.databaseUrl), /must be empty/);
  assert.equal(await database.prisma.bill.count(), 1);
});
test('an invalid relationship aborts and rolls back the entire PostgreSQL import', async () => {
  const filename = path.join(temp, 'invalid.db'); snapshot(filename, true);
  await assert.rejects(importSqlite(filename, database.databaseUrl));
  assert.equal(await database.prisma.property.count(), 0);
  assert.equal(await database.prisma.user.count(), 0);
});
test('legacy conversion validates boolean/date fields and PostgreSQL URL configuration', () => {
  assert.throws(() => normalize({ type: 'Boolean', isRequired: true }, 7));
  assert.throws(() => normalize({ type: 'DateTime', isRequired: true }, 'bad-date'));
  const { loadDatabaseUrl } = loadTypeScript('src/config/database.ts');
  assert.throws(() => loadDatabaseUrl({ DATABASE_URL: 'file:./dev.db' }), /PostgreSQL/);
  assert.throws(() => loadDatabaseUrl({ DATABASE_URL: 'invalid' }), /PostgreSQL/);
  assert.equal(loadDatabaseUrl({ DATABASE_URL: database.databaseUrl }), database.databaseUrl);
});
