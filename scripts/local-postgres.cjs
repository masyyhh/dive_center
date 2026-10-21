const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.local');
const data = path.join(directory, 'postgres');
const passwordFile = path.join(directory, 'postgres.password');
const envFile = path.join(root, 'backend/.env.local');
const port = Number(process.env.LOCAL_POSTGRES_PORT || 55432);
const action = process.argv[2] || 'start';
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !['start', 'stop', 'status'].includes(action)) throw Error('Use start, stop, or status and a valid LOCAL_POSTGRES_PORT.');
try {
  const bin = process.env.PG_BINDIR || execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
  const run = (name, args, options = {}) => execFileSync(path.join(bin, name), args, { stdio: 'pipe', ...options });
  const running = () => fs.existsSync(data) && spawnSync(path.join(bin, 'pg_ctl'), ['-D', data, 'status'], { stdio: 'ignore' }).status === 0;
  if (action === 'status') { console.log(running() ? 'Local PostgreSQL is running.' : 'Local PostgreSQL is stopped.'); process.exit(0); }
  if (action === 'stop') { if (running()) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']); console.log('Local PostgreSQL stopped; data retained.'); process.exit(0); }
  if (fs.existsSync(directory) && (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())) throw Error('Expected a private .local directory.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
  if (!fs.existsSync(passwordFile)) fs.writeFileSync(passwordFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  if (!fs.lstatSync(passwordFile).isFile() || fs.lstatSync(passwordFile).isSymbolicLink()) throw Error('Invalid password file.');
  const password = fs.readFileSync(passwordFile, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(password)) throw Error('Invalid local database password file.');
  if (!fs.existsSync(path.join(data, 'PG_VERSION'))) run('initdb', ['-D', data, '--username=dive_center', `--pwfile=${passwordFile}`, '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--no-locale']);
  if (!running()) run('pg_ctl', ['-D', data, '-l', path.join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  const env = { ...process.env, PGPASSWORD: password, PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'dive_center', PGDATABASE: 'postgres' };
  for (const database of ['dive_center', 'dive_center_test']) {
    if (run('psql', ['-At', '-v', 'ON_ERROR_STOP=1', '-c', `SELECT 1 FROM pg_database WHERE datname='${database}'`], { env, encoding: 'utf8' }).trim() !== '1') run('createdb', ['--owner=dive_center', database], { env });
  }
  if (fs.existsSync(envFile) && (!fs.lstatSync(envFile).isFile() || fs.lstatSync(envFile).isSymbolicLink())) throw Error('Invalid local configuration.');
  let text = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  for (const [name, database] of [['DATABASE_URL', 'dive_center'], ['TEST_DATABASE_URL', 'dive_center_test']]) {
    const line = `${name}=postgresql://dive_center:${password}@127.0.0.1:${port}/${database}?schema=public&connection_limit=10`;
    const pattern = new RegExp(`^${name}=.*$`, 'm');
    text = pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(envFile, text, { mode: 0o600 }); fs.chmodSync(envFile, 0o600);
  console.log(`PostgreSQL is ready on 127.0.0.1:${port}. Private app/test URLs saved in backend/.env.local.`);
} catch { console.error('Local PostgreSQL setup failed. Check PostgreSQL tools, port availability and .local/postgres.log.'); process.exitCode = 1; }
