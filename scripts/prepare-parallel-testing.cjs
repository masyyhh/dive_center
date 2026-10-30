// Capture running release images; prepare independent testing secrets. Never builds,
// starts, migrates, or stops the live backend/database.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parseEnv } = require('node:util');
const root = path.resolve(__dirname, '..');
const regular = file => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`${path.basename(file)} must be a regular file.`);
};
const docker = args => {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw Error('Docker command failed. Check that Docker is running and the live stack is available.');
  return result.stdout.trim();
};
try {
  const productionFile = path.join(root, '.env.production'); regular(productionFile);
  const production = parseEnv(fs.readFileSync(productionFile, 'utf8'));
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(production.APP_DOMAIN || '')) throw Error('Set the live HTTPS domain in .env.production first.');
  const compose = ['compose', '--env-file', '.env.production', '-f', 'compose.yaml'];
  const current = {};
  for (const service of ['backend', 'web']) {
    const id = docker([...compose, 'ps', '-q', service]);
    if (!id || /\s/.test(id)) throw Error(`Expected one running live ${service} container.`);
    const [info] = JSON.parse(docker(['inspect', id]));
    if (!info.State.Running || !/^sha256:[a-f0-9]{64}$/.test(info.Image)) throw Error(`Live ${service} must be running.`);
    current[service] = info;
  }
  const project = current.web.Config.Labels['com.docker.compose.project'];
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project) || current.backend.Config.Labels['com.docker.compose.project'] !== project) throw Error('Live containers must belong to the same Compose project.');
  const snapshotFile = path.join(root, '.env.parallel-live');
  let snapshot;
  if (fs.existsSync(snapshotFile)) {
    regular(snapshotFile); snapshot = parseEnv(fs.readFileSync(snapshotFile, 'utf8'));
    if (snapshot.LIVE_COMPOSE_PROJECT !== project || !['relay', 'split'].includes(snapshot.PARALLEL_PROXY_MODE)) throw Error('Existing live snapshot does not match this deployment.');
    for (const service of ['backend', 'web']) {
      const prefix = `FROZEN_LIVE_${service.toUpperCase()}`;
      if (snapshot[`${prefix}_ID`] !== current[service].Image || docker(['image', 'inspect', '--format', '{{.Id}}', snapshot[`${prefix}_IMAGE`]]) !== current[service].Image) throw Error('Live images differ from the saved snapshot. Keep the snapshot; review the release before changing it.');
    }
  } else {
    const mount = current.web.Mounts.find(entry => entry.Destination === '/etc/caddy/Caddyfile');
    const filename = mount && path.basename(mount.Source);
    const mode = filename === 'Caddyfile.proxy-relay' ? 'relay' : filename === 'Caddyfile.reverse-proxy' ? 'split' : null;
    if (!mode) throw Error('Unrecognized live Caddy configuration. Review the existing proxy setup before configuring parallel testing.');
    snapshot = { LIVE_COMPOSE_PROJECT: project, PARALLEL_PROXY_MODE: mode };
    for (const service of ['backend', 'web']) {
      const image = current[service].Image;
      const tag = `dive-centre-frozen-${service}:${image.slice(7, 19)}`;
      docker(['image', 'tag', image, tag]);
      snapshot[`FROZEN_LIVE_${service.toUpperCase()}_IMAGE`] = tag;
      snapshot[`FROZEN_LIVE_${service.toUpperCase()}_ID`] = image;
    }
    fs.writeFileSync(snapshotFile, Object.entries(snapshot).map(([key, value]) => `${key}=${value}\n`).join(''), { flag: 'wx', mode: 0o600 });
  }
  const envFile = path.join(root, '.env.testing');
  if (fs.existsSync(envFile)) regular(envFile);
  else fs.writeFileSync(envFile, 'TESTING_SUBNET=172.30.252.0/29\nTESTING_GATEWAY_IP=172.30.252.2\nTESTING_WEB_IP=172.30.252.3\nTESTING_BACKEND_IP=172.30.252.4\n', { flag: 'wx', mode: 0o600 });
  const directory = path.join(root, 'secrets-testing');
  if (fs.existsSync(directory) && (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())) throw Error('secrets-testing must be a private directory.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
  const secret = (name, bytes) => {
    const file = path.join(directory, name);
    try { fs.writeFileSync(file, randomBytes(bytes).toString('hex'), { flag: 'wx', mode: 0o444 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    regular(file);
    const value = fs.readFileSync(file, 'utf8').trim();
    if (!new RegExp(`^[a-f0-9]{${bytes * 2}}$`).test(value)) throw Error(`Invalid existing testing ${name}; it was not replaced.`);
    const live = path.join(root, 'secrets', name === 'postgres_password' ? 'postgres_admin_password' : name);
    if (fs.existsSync(live) && fs.readFileSync(live, 'utf8').trim() === value) throw Error(`Testing ${name} must differ from live.`);
    fs.chmodSync(file, 0o444);
    return value;
  };
  const admin = secret('postgres_password', 32);
  const password = secret('database_password', 32);
  if (admin === password) throw Error('Testing application and database administrator passwords must differ.');
  secret('jwt_secret', 48); secret('authenticator_key', 32);
  const url = `postgresql://dive_center_testing:${password}@testdb:5432/dive_center_testing?schema=public&connection_limit=10`;
  const urlFile = path.join(directory, 'database_url');
  try { fs.writeFileSync(urlFile, url, { flag: 'wx', mode: 0o444 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  regular(urlFile);
  if (fs.readFileSync(urlFile, 'utf8').trim() !== url) throw Error('Testing database_url does not match its independent credentials. Existing secrets were preserved.');
  const pmsFile = path.join(directory, 'pms_api_key');
  try { fs.writeFileSync(pmsFile, '', { flag: 'wx', mode: 0o444 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  regular(pmsFile);
  if (fs.readFileSync(pmsFile, 'utf8').trim()) throw Error('Keep testing PMS credentials empty; this environment is for fictional guest data.');
  const allowFile = path.join(directory, 'allowed_live_users.json');
  try { fs.writeFileSync(allowFile, '[]\n', { flag: 'wx', mode: 0o444 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  regular(allowFile);
  const ids = JSON.parse(fs.readFileSync(allowFile, 'utf8'));
  if (!Array.isArray(ids) || ids.length > 200 || ids.some(id => typeof id !== 'string' || !id || id.length > 100)) throw Error('Invalid selected testing user list.');
  console.log(`Live ${snapshot.PARALLEL_PROXY_MODE} images captured. Independent testing configuration prepared.`);
  console.log('Next: sh scripts/parallel-testing.sh users, then allow <live-usernames>, then start.');
  console.log('Testing uses selected live sign-ins. Production passwords and authenticator secrets are never copied.');
} catch (error) { console.error(`Parallel testing preparation failed: ${error.message}`); process.exitCode = 1; }
