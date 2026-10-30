const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve(__dirname, '../secrets-testing/allowed_live_users.json');
try {
  const users = JSON.parse(process.argv[2]);
  if (!Array.isArray(users) || users.length > 200 || users.some(user => typeof user.id !== 'string' || !user.id || user.id.length > 100 || typeof user.username !== 'string')) throw Error('Invalid live-user selection.');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Selected-user list must be a regular file.');
  // Keep the inode: Docker's file bind mount must see updates without a restart.
  fs.chmodSync(file, 0o600);
  try { fs.writeFileSync(file, `${JSON.stringify([...new Set(users.map(user => user.id))])}\n`); }
  finally { fs.chmodSync(file, 0o444); }
  console.log(`Testing access is now limited to ${users.length} selected live user(s).`);
  for (const user of users) console.log(`- ${user.username}`);
} catch (error) { console.error(`Could not update testing access: ${error.message}`); process.exitCode = 1; }
