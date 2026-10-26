import { isIP } from 'node:net';
import { Express } from 'express';

// Address-based trust is required when the API is published outside Docker.
// A hop count alone would let direct clients spoof forwarded headers.
export const configureProxySecurity = (app: Express, env: NodeJS.ProcessEnv = process.env) => {
  const proxyOnly = env.REQUIRE_TRUSTED_PROXY === '1';
  const addresses = env.TRUST_PROXY_ADDRESSES?.split(',').map(value => value.trim());
  if (addresses) {
    for (const address of addresses) {
      const [ip, prefix, extra] = address.split('/');
      const family = isIP(ip);
      if (!family || extra !== undefined || (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128)))) {
        throw new Error('TRUST_PROXY_ADDRESSES must contain explicit proxy IP addresses or nonzero CIDRs.');
      }
    }
    app.set('trust proxy', addresses);
  } else {
    if (proxyOnly) throw new Error('TRUST_PROXY_ADDRESSES is required when REQUIRE_TRUSTED_PROXY=1.');
    app.set('trust proxy', env.TRUST_PROXY === '1' ? 1 : false);
  }

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // Container probes remain reachable without spoofing forwarded headers.
    const probe = (req.method === 'GET' || req.method === 'HEAD') &&
      (req.path === '/health' || req.path === '/ready');
    if (proxyOnly && !probe) {
      const trusted = app.get('trust proxy fn');
      if (!req.socket.remoteAddress || !trusted(req.socket.remoteAddress, 0)) {
        res.status(403).json({ error: 'Access through the configured reverse proxy is required.' });
        return;
      }
      if (!req.secure) {
        res.status(403).json({ error: 'HTTPS is required through the reverse proxy.' });
        return;
      }
    }
    next();
  });
};
