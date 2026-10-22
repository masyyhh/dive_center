const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const [target, email] = process.argv.slice(2);
const isDomain = Boolean(target && target.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(target));
const isIpv4 = Boolean(target && /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(?::[0-9]{1,5})?$/.test(target));
const isLocalhost = Boolean(target && /^localhost(?::[0-9]{1,5})?$/i.test(target));
const isNoDomain = Boolean(target && (/^:80$/i.test(target) || /^--no-domain$/i.test(target) || isIpv4 || isLocalhost));

if (!target || (!isDomain && !isNoDomain)) {
  console.error('Error: Invalid domain or host target.');
  console.error('Usage: node scripts/prepare-production.cjs [app.example.com | <server-ip> | --no-domain] admin@example.com');
  process.exit(1);
}

if (!email || email.length > 254 || !/^[^\s=@$#"'`\\]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Error: Missing or invalid administrator email.');
  console.error(`Usage: node scripts/prepare-production.cjs ${target} admin@example.com`);
  console.error('The email is required for Let\'s Encrypt TLS renewal notices and your initial admin login.');
  process.exit(1);
}

const appDomain = isDomain ? target.toLowerCase() : ':80';
const corsOrigin = isDomain
  ? `https://${target.toLowerCase()}`
  : isIpv4
  ? `http://${target.toLowerCase()},http://localhost,http://127.0.0.1`
  : 'http://localhost,http://127.0.0.1';
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'secrets');
const regularFile = file => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Secret/configuration paths must be regular files.');
};
try {
  if (fs.existsSync(directory) && (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())) throw Error('Invalid secrets directory.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const secret = (name, bytes, valid) => {
    const file = path.join(directory, name);
    try { fs.writeFileSync(file, randomBytes(bytes).toString('hex'), { flag: 'wx', mode: 0o444 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    regularFile(file);
    const value = fs.readFileSync(file, 'utf8').trim();
    if (!valid(value)) throw Error(`Invalid existing ${name}; no existing key was replaced.`);
    fs.chmodSync(file, 0o444);
    return value;
  };
  const hexKey = value => /^[a-f0-9]{64}$/i.test(value);
  secret('jwt_secret', 48, value => value.length >= 32 && !/change.?me|example|placeholder|change.?in.?prod/i.test(value));
  secret('admin_password', 24, value => Buffer.byteLength(value) >= 12 && Buffer.byteLength(value) <= 72);
  secret('authenticator_key', 32, hexKey);
  const adminPassword = secret('postgres_admin_password', 32, hexKey);
  const password = secret('database_password', 32, value => /^[a-f0-9]{64}$/.test(value));
  if (adminPassword === password) throw Error('Application and PostgreSQL administrator passwords must differ.');
  const urlFile = path.join(directory, 'database_url');
  const url = `postgresql://dive_center:${password}@db:5432/dive_center?schema=public&connection_limit=10`;
  try { fs.writeFileSync(urlFile, url, { flag: 'wx', mode: 0o444 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  regularFile(urlFile);
  if (fs.readFileSync(urlFile, 'utf8').trim() !== url) throw Error('Existing database_url does not match the generated application credential. Resolve configuration without rotating live credentials blindly.');
  fs.chmodSync(urlFile, 0o444);
  const pmsFile = path.join(directory, 'pms_api_key');
  try { fs.writeFileSync(pmsFile, '', { flag: 'wx', mode: 0o444 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  regularFile(pmsFile); fs.chmodSync(pmsFile, 0o444);
  const envFile = path.join(root, '.env.production');
  const envContent = `APP_DOMAIN=${appDomain}\nCORS_ORIGIN=${corsOrigin}\nACME_EMAIL=${email}\nADMIN_EMAIL=${email}\nADMIN_NAME=Administrator\n`;
  try { fs.writeFileSync(envFile, envContent, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  regularFile(envFile); fs.chmodSync(envFile, 0o600);
  console.log('Production configuration prepared. Existing keys and configuration were preserved.');
  console.log('Keep secrets/ private and back it up encrypted. The bootstrap password is in secrets/admin_password.');
} catch (error) {
  console.error(`Production preparation failed: ${error.message}`);
  process.exitCode = 1;
}
