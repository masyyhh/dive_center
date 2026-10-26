const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '..');
function fixture(t, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dcm-deployment-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(path.join(source, 'scripts', name), path.join(root, 'scripts', name));
  return root;
}
const prepare = root => spawnSync(process.execPath, [path.join(root, 'scripts/prepare-production.cjs'), 'dive.example.test', 'admin@example.test'], { encoding: 'utf8' });
test('production preparation preserves imported keys/config and rejects symlinks or mismatched credentials', t => {
  const root = fixture(t, 'prepare-production.cjs');
  fs.mkdirSync(path.join(root, 'secrets'), { mode: 0o700 });
  const imported = 'ab'.repeat(32);
  fs.writeFileSync(path.join(root, 'secrets/authenticator_key'), imported);
  assert.equal(prepare(root).status, 0);
  assert.equal(fs.readFileSync(path.join(root, 'secrets/authenticator_key'), 'utf8'), imported);
  const jwt = fs.readFileSync(path.join(root, 'secrets/jwt_secret'), 'utf8');
  const config = fs.readFileSync(path.join(root, '.env.production'), 'utf8');
  assert.equal(prepare(root).status, 0);
  assert.equal(fs.readFileSync(path.join(root, '.env.production'), 'utf8'), config);
  assert.equal(fs.readFileSync(path.join(root, 'secrets/jwt_secret'), 'utf8'), jwt);
  assert.equal(fs.statSync(path.join(root, '.env.production')).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(path.join(root, 'secrets/pms_api_key'), 'utf8'), '');
  const file = path.join(root, 'secrets/database_url');
  fs.chmodSync(file, 0o600); fs.writeFileSync(file, 'postgresql://invalid');
  assert.notEqual(prepare(root).status, 0);
  assert.equal(fs.readFileSync(path.join(root, 'secrets/jwt_secret'), 'utf8'), jwt);
  fs.unlinkSync(file); fs.symlinkSync(path.join(root, '.env.production'), file);
  assert.notEqual(prepare(root).status, 0);
  assert.equal(fs.readFileSync(path.join(root, '.env.production'), 'utf8'), config);
});
test('production preparation refuses malformed domains and dotenv interpolation in email', t => {
  const root = fixture(t, 'prepare-production.cjs');
  for (const [domain, email] of [['https://bad/path', 'a@example.test'], ['a.example.test', 'a$SECRET@example.test'], ['a.example.test', 'a\nADMIN_EMAIL=bad@example.test']]) {
    assert.notEqual(spawnSync(process.execPath, [path.join(root, 'scripts/prepare-production.cjs'), domain, email]).status, 0);
  }
  assert.equal(fs.existsSync(path.join(root, 'secrets')), false);
});
test('backup publishes only nonempty archives accepted by pg_restore and cleans failed attempts', t => {
  const root = fixture(t, 'backup.sh');
  fs.writeFileSync(path.join(root, '.env.production'), 'APP_DOMAIN=fixture.example.test\n');
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  // Exercise the real backup shell script with an isolated Docker stand-in.
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
case "$*" in
  *pg_dump*) [ "\$MODE" != dump-failure ] || exit 7; [ "\$MODE" != empty ] || exit 0; printf 'fixture archive';;
  *pg_restore*) cat > /dev/null; [ "\$MODE" != invalid-archive ] || exit 8;;
  *) exit 9;;
esac
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const run = mode => spawnSync('sh', [path.join(root, 'scripts/backup.sh')], { env: { ...env, MODE: mode }, encoding: 'utf8' });
  for (const mode of ['dump-failure', 'empty', 'invalid-archive']) {
    assert.notEqual(run(mode).status, 0);
    assert.deepEqual(fs.readdirSync(path.join(root, 'backups')), []);
  }
  const result = run('success'); assert.equal(result.status, 0, result.stderr);
  const file = result.stdout.trim(); assert(file.startsWith(path.join(root, 'backups/')));
  assert.equal(fs.readFileSync(file, 'utf8'), 'fixture archive');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(root, 'backups')).mode & 0o777, 0o700);
  assert.equal(run('success').status, 0);
  assert.equal(fs.readdirSync(path.join(root, 'backups')).length, 2);
});
test('backup rejects a symlink destination and smoke tooling refuses non-CI execution', t => {
  const root = fixture(t, 'backup.sh');
  fs.writeFileSync(path.join(root, '.env.production'), 'fixture');
  const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(root, 'backups'));
  assert.notEqual(spawnSync('sh', [path.join(root, 'scripts/backup.sh')]).status, 0);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.notEqual(spawnSync('sh', [path.join(source, 'scripts/smoke-production.sh')], { env: { ...process.env, CI: '', COMPOSE_PROJECT_NAME: '' } }).status, 0);
  assert.notEqual(spawnSync(process.execPath, [path.join(source, 'backend/tools/smoke-production.cjs')], { env: { ...process.env, CI: '', SMOKE_TEST: '' } }).status, 0);
  assert.notEqual(spawnSync(process.execPath, [path.join(source, 'backend/tools/smoke-restore.cjs')], { env: { ...process.env, CI: '', SMOKE_TEST: '' } }).status, 0);
});
test('local secret setup preserves other settings and existing generated keys', t => {
  const root = fixture(t, 'setup-local-secrets.cjs');
  fs.copyFileSync(path.join(source, 'scripts/setup-authenticator-key.cjs'), path.join(root, 'scripts/setup-authenticator-key.cjs'));
  fs.mkdirSync(path.join(root, 'backend'));
  const file = path.join(root, 'backend/.env.local'); fs.writeFileSync(file, 'PORT=5001\n');
  const env = { ...process.env, JWT_SECRET: '', JWT_SECRET_FILE: '', AUTHENTICATOR_ENCRYPTION_KEY: '', AUTHENTICATOR_ENCRYPTION_KEY_FILE: '' };
  for (let pass = 0; pass < 2; pass++) {
    for (const name of ['setup-local-secrets.cjs', 'setup-authenticator-key.cjs']) assert.equal(spawnSync(process.execPath, [path.join(root, 'scripts', name)], { env }).status, 0);
    const text = fs.readFileSync(file, 'utf8');
    assert(text.startsWith('PORT=5001\n'));
    assert.equal((text.match(/^JWT_SECRET=/gm) || []).length, 1);
    assert.equal((text.match(/^AUTHENTICATOR_ENCRYPTION_KEY=/gm) || []).length, 1);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
});
test('production preparation requires HTTPS and rejects unsafe existing config without changing keys', t => {
  for (const target of ['--no-domain', ':80', '192.168.1.50', '127.0.0.1:80', 'localhost', 'http://dive.example.test']) {
    const root = fixture(t, 'prepare-production.cjs');
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/prepare-production.cjs'), target, 'admin@example.test'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(root, 'secrets')), false);
  }
  const root = fixture(t, 'prepare-production.cjs');
  assert.equal(prepare(root).status, 0);
  const file = path.join(root, '.env.production');
  const safe = fs.readFileSync(file, 'utf8');
  assert(safe.includes('APP_DOMAIN=dive.example.test'));
  assert(safe.includes('CORS_ORIGIN=https://dive.example.test'));
  const keyFile = path.join(root, 'secrets/jwt_secret');
  const key = fs.readFileSync(keyFile, 'utf8');
  for (const unsafe of ['APP_DOMAIN=:80\nCORS_ORIGIN=http://localhost\n', 'APP_DOMAIN=dive.example.test\nCORS_ORIGIN=http://dive.example.test\n', 'APP_DOMAIN=dive.example.test\nCORS_ORIGIN=https://other.example.test\n']) {
    fs.writeFileSync(file, unsafe);
    assert.notEqual(prepare(root).status, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), unsafe);
    assert.equal(fs.readFileSync(keyFile, 'utf8'), key);
  }
  fs.writeFileSync(file, safe);
  assert.equal(prepare(root).status, 0);
});

test('API entrypoint migrates before serving, fails closed on migration error and leaves tooling commands alone', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dcm-entrypoint-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entrypoint = path.join(root, 'entrypoint.sh');
  fs.copyFileSync(path.join(source, 'backend/entrypoint.sh'), entrypoint);
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  const log = path.join(root, 'calls.log');
  fs.writeFileSync(path.join(bin, 'node'), `#!/bin/sh
printf '%s\\n' "$*" >> "$ENTRYPOINT_TEST_LOG"
if [ "$1" = tools/prisma.cjs ] && [ "\${MIGRATION_FAIL:-}" = 1 ]; then exit 7; fi
`, { mode: 0o755 });
  const secret = path.join(root, 'database-url');
  fs.writeFileSync(secret, 'postgresql://fixture');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ENTRYPOINT_TEST_LOG: log, DATABASE_URL: '', DATABASE_URL_FILE: secret, PRISMA_SCHEMA_ENGINE_BINARY: '/fixture-engine' };
  const run = (args, extra = {}) => spawnSync('sh', [entrypoint, ...args], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
  const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(run(['node', 'dist/index.js']).status, 0);
  assert.deepEqual(calls(), ['tools/prisma.cjs migrate deploy', 'dist/index.js']);
  fs.writeFileSync(log, '');
  assert.equal(run(['node', 'dist/index.js'], { MIGRATION_FAIL: '1' }).status, 7);
  assert.deepEqual(calls(), ['tools/prisma.cjs migrate deploy']);
  fs.writeFileSync(log, '');
  assert.equal(run(['node', 'tools/prisma.cjs', 'migrate', 'deploy']).status, 0);
  assert.deepEqual(calls(), ['tools/prisma.cjs migrate deploy']);
  fs.writeFileSync(log, '');
  assert.equal(run(['node', 'dist/scripts/bootstrap-admin.js']).status, 0);
  assert.deepEqual(calls(), ['dist/scripts/bootstrap-admin.js']);
});
