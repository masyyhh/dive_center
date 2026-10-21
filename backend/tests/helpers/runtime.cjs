const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadTypeScript(relativePath, stubs = {}, globals = {}) {
  const filename = path.resolve(__dirname, '../..', relativePath);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const module = { exports: {} };
  const localRequire = name => {
    if (name in stubs) return stubs[name];
    if (name.startsWith('.')) return loadTypeScript(path.relative(path.resolve(__dirname, '../..'), path.resolve(path.dirname(filename), `${name}.ts`)), stubs, globals);
    return require(name);
  };
  new Function('require', 'module', 'exports', '__dirname', ...Object.keys(globals), outputText)(localRequire, module, module.exports, path.dirname(filename), ...Object.values(globals));
  return module.exports;
}

function request(router, method, url, data = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, url, body: {}, query: {}, params: {}, headers: {}, user: { id: 'manager', role: 'PROPERTY_MANAGER', assignedPropertyIds: ['male'] }, ...data };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); return this; } };
    router.handle(req, res, error => reject(error || new Error('Route did not respond')));
  });
}

// 02:00 on October 20 in Maldives, still October 19 in UTC.
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-19T21:00:00.000Z'])); }
  static now() { return new FixedDate().getTime(); }
}
module.exports = { loadTypeScript, request, FixedDate };
