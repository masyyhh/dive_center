const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });
if (process.env.DATABASE_URL_FILE) {
  if (process.env.DATABASE_URL) { console.error('Set only DATABASE_URL or DATABASE_URL_FILE.'); process.exit(1); }
  try { process.env.DATABASE_URL = fs.readFileSync(process.env.DATABASE_URL_FILE, 'utf8').trim(); delete process.env.DATABASE_URL_FILE; }
  catch { console.error('Unable to read DATABASE_URL_FILE.'); process.exit(1); }
}
const child = spawnSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), ...process.argv.slice(2)], { cwd: root, env: process.env, stdio: 'inherit' });
process.exit(child.status ?? 1);
