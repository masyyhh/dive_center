const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const file = path.resolve(__dirname, '../backend/.env.local');
if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) throw Error('Expected a regular local configuration file.');
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
if (!/^AUTHENTICATOR_ENCRYPTION_KEY(?:_FILE)?=.+$/m.test(text) && !process.env.AUTHENTICATOR_ENCRYPTION_KEY && !process.env.AUTHENTICATOR_ENCRYPTION_KEY_FILE) {
  fs.appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}AUTHENTICATOR_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
}
if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
console.log('Local authenticator-key configuration is ready; existing keys were preserved.');
