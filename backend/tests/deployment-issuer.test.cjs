const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/runtime.cjs');
test('one backend image preserves the existing testing and production authenticator issuers', () => {
  const before = process.env.AUTHENTICATOR_ISSUER;
  try {
    const { totp } = loadTypeScript('src/services/authenticatorService.ts');
    delete process.env.AUTHENTICATOR_ISSUER;
    assert.equal(totp('JBSWY3DPEHPK3PXP').issuer, 'Dive Centre Manager');
    process.env.AUTHENTICATOR_ISSUER = 'Dive Centre Manager Testing';
    assert.equal(totp('JBSWY3DPEHPK3PXP').issuer, 'Dive Centre Manager Testing');
    process.env.AUTHENTICATOR_ISSUER = 'unrecognized';
    assert.equal(totp('JBSWY3DPEHPK3PXP').issuer, 'Dive Centre Manager');
  } finally {
    if (before === undefined) delete process.env.AUTHENTICATOR_ISSUER;
    else process.env.AUTHENTICATOR_ISSUER = before;
  }
});
