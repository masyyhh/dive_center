const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const file = path.resolve(__dirname, '../backend/.env.local');
if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) throw Error('Expected a regular local configuration file.');
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
if (!/^JWT_SECRET(?:_FILE)?=.+$/m.test(text) && !process.env.JWT_SECRET && !process.env.JWT_SECRET_FILE) {
  fs.appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}JWT_SECRET=${randomBytes(48).toString('hex')}\n`, { mode: 0o600 });
}
if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
console.log('Local signing-key configuration is ready; existing keys were preserved.');
