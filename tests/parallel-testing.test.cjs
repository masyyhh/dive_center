const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { parseEnv } = require('node:util');
const source = path.resolve(__dirname, '..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dcm-parallel-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'bin')); fs.mkdirSync(path.join(root, 'secrets'));
  for (const script of ['prepare-parallel-testing.cjs', 'parallel-testing.sh', 'write-testing-allowlist.cjs']) fs.copyFileSync(path.join(source, 'scripts', script), path.join(root, 'scripts', script));
  fs.writeFileSync(path.join(root, '.env.production'), 'APP_DOMAIN=dive.example.test\nADMIN_EMAIL=admin@example.test\n');
  fs.writeFileSync(path.join(root, 'secrets/jwt_secret'), 'live-secret-preserved');
  fs.writeFileSync(path.join(root, 'bin/docker'), `#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync('commands.log',JSON.stringify(args)+'\\n');
if(args[0]==='compose' && args.includes('exec') && args.includes('-e')) process.stdout.write(JSON.stringify([{id:'selected-live-id',username:args.at(-1)}]));
else if(args[0]==='compose' && args.includes('ps')) process.stdout.write(args.at(-1));
else if(args[0]==='inspect') {const s=args[1];process.stdout.write(JSON.stringify([{State:{Running:true},Image:'sha256:'+((s==='web'?'a':'b').repeat(64)),Config:{Labels:{'com.docker.compose.project':'dive-centre'}},Mounts:[{Destination:'/etc/caddy/Caddyfile',Source:'/srv/deploy/'+(process.env.MOCK_MODE==='unknown'?'custom':process.env.MOCK_MODE==='split'?'Caddyfile.reverse-proxy':'Caddyfile.proxy-relay')}]}]));}
else if(args[0]==='image' && args[1]==='inspect') process.stdout.write('sha256:'+(args.at(-1).includes('web')?'a':'b').repeat(64));
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${path.join(root, 'bin')}:${process.env.PATH}` };
  const prepare = (extra = {}) => spawnSync(process.execPath, [path.join(root, 'scripts/prepare-parallel-testing.cjs')], { env: { ...env, ...extra }, encoding: 'utf8' });
  const run = command => spawnSync('sh', [path.join(root, 'scripts/parallel-testing.sh'), command], { env, encoding: 'utf8' });
  return { root, prepare, run, commands: () => fs.readFileSync(path.join(root, 'commands.log'), 'utf8').trim().split('\n').map(JSON.parse) };
}
test('preparation freezes actual running images and preserves independent credentials on repeat', t => {
  const f = fixture(t); assert.equal(f.prepare().status, 0);
  const snapshot = parseEnv(fs.readFileSync(path.join(f.root, '.env.parallel-live'), 'utf8'));
  assert.equal(snapshot.PARALLEL_PROXY_MODE, 'relay'); assert.equal(snapshot.LIVE_COMPOSE_PROJECT, 'dive-centre');
  assert.equal(snapshot.FROZEN_LIVE_WEB_IMAGE, `dive-centre-frozen-web:${'a'.repeat(12)}`);
  const password = fs.readFileSync(path.join(f.root, 'secrets-testing/database_password'), 'utf8');
  const url = fs.readFileSync(path.join(f.root, 'secrets-testing/database_url'), 'utf8');
  assert.equal(new URL(url).hostname, 'testdb'); assert.equal(new URL(url).pathname, '/dive_center_testing');
  assert.equal(fs.readFileSync(path.join(f.root, 'secrets-testing/pms_api_key'), 'utf8'), '');
  assert.equal(fs.readFileSync(path.join(f.root, 'secrets/jwt_secret'), 'utf8'), 'live-secret-preserved');
  assert.equal(f.prepare().status, 0); assert.equal(fs.readFileSync(path.join(f.root, 'secrets-testing/database_password'), 'utf8'), password);
  assert.equal(fs.statSync(path.join(f.root, 'secrets-testing')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(f.root, '.env.testing')).mode & 0o777, 0o600);
  assert(f.commands().every(args => args[0] === 'inspect' || args[0] === 'image' || args.includes('ps')));
});
test('preparation detects split routing and rejects unknown live proxy configurations', t => {
  const split = fixture(t); assert.equal(split.prepare({ MOCK_MODE: 'split' }).status, 0);
  assert.equal(parseEnv(fs.readFileSync(path.join(split.root, '.env.parallel-live'), 'utf8')).PARALLEL_PROXY_MODE, 'split');
  const unknown = fixture(t); assert.notEqual(unknown.prepare({ MOCK_MODE: 'unknown' }).status, 0);
  assert.equal(fs.existsSync(path.join(unknown.root, 'secrets-testing')), false);
});
test('preparation rejects redirected secrets and mismatched test credentials without changing live files', t => {
  const f = fixture(t); assert.equal(f.prepare().status, 0);
  const key = path.join(f.root, 'secrets-testing/jwt_secret'); fs.unlinkSync(key); fs.symlinkSync(path.join(f.root, 'secrets/jwt_secret'), key);
  assert.notEqual(f.prepare().status, 0); assert.equal(fs.readFileSync(path.join(f.root, 'secrets/jwt_secret'), 'utf8'), 'live-secret-preserved');
  fs.unlinkSync(key); fs.writeFileSync(key, 'c'.repeat(96));
  const url = path.join(f.root, 'secrets-testing/database_url'); fs.chmodSync(url, 0o600); fs.writeFileSync(url, 'postgresql://live:wrong@db/live');
  assert.notEqual(f.prepare().status, 0);
});
test('start builds only testing services and recreates only the frozen live web router', t => {
  const f = fixture(t); assert.equal(f.prepare().status, 0); const result = f.run('start'); assert.equal(result.status, 0, result.stderr);
  const commands = f.commands();
  const builds = commands.filter(args => args.includes('build')); assert.equal(builds.length, 1);
  assert(builds[0].includes('dive-centre-testing')); assert.deepEqual(builds[0].slice(-3), ['build', 'testbackend', 'testweb']);
  const liveUp = commands.filter(args => args.includes('up') && !args.includes('dive-centre-testing')); assert.equal(liveUp.length, 1);
  assert.deepEqual(liveUp[0].slice(-5), ['up', '-d', '--no-deps', '--no-build', 'web']);
  assert(liveUp[0].includes('deploy/compose.frozen-live.yaml')); assert(liveUp[0].includes('deploy/compose.parallel-relay.yaml'));
  assert(!commands.some(args => args.includes('migrate') || args.includes('--volumes')));
});
test('stop restores live routing before removing test containers and preserves every data volume', t => {
  const f = fixture(t); assert.equal(f.prepare().status, 0); assert.equal(f.run('stop').status, 0);
  const changes = f.commands().filter(args => args.includes('up') || args.includes('down'));
  assert.equal(changes.length, 2); assert(changes[0].includes('--no-deps')); assert(changes[0].includes('deploy/compose.frozen-live.yaml'));
  assert(!changes[0].includes('deploy/compose.parallel-live.yaml')); assert(changes[1].includes('dive-centre-testing')); assert(!changes[1].includes('--volumes'));
});

 test('container smoke tooling refuses a non-CI host and ordinary project name', () => {
   const script = path.join(source, 'scripts/test-parallel-testing.sh');
   for (const env of [{ CI: '', COMPOSE_PROJECT_NAME: 'dive-centre' }, { CI: 'true', COMPOSE_PROJECT_NAME: 'dive-centre' }]) {
     assert.notEqual(spawnSync('sh', [script], { env: { ...process.env, ...env } }).status, 0);
   }
 });

test('selected-user changes use a read-only live lookup and update the mounted list without replacing its inode', t => {
  const f = fixture(t); assert.equal(f.prepare().status, 0);
  const file = path.join(f.root, 'secrets-testing/allowed_live_users.json');
  const inode = fs.statSync(file).ino;
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), []);
  const result = f.run('allow'); assert.notEqual(result.status, 0);
  const allow = spawnSync('sh', [path.join(f.root, 'scripts/parallel-testing.sh'), 'allow', 'tester@example.test'], { env: { ...process.env, PATH: `${path.join(f.root, 'bin')}:${process.env.PATH}` }, encoding: 'utf8' });
  assert.equal(allow.status, 0, allow.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), ['selected-live-id']);
  assert.equal(fs.statSync(file).ino, inode);
  assert.equal(fs.statSync(file).mode & 0o777, 0o444);
  const clear = spawnSync('sh', [path.join(f.root, 'scripts/parallel-testing.sh'), 'allow', '--none'], { env: { ...process.env, PATH: `${path.join(f.root, 'bin')}:${process.env.PATH}` }, encoding: 'utf8' });
  assert.equal(clear.status, 0); assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), []);
  assert.equal(fs.statSync(file).ino, inode);
});
