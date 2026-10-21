import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { readSecret } from './secrets';

dotenv.config({ path: resolve(__dirname, '../../.env.local') });
dotenv.config({ path: resolve(__dirname, '../../.env') });

export const loadDatabaseUrl = (env: NodeJS.ProcessEnv = process.env) => {
  const value = readSecret('DATABASE_URL', env);
  try {
    const parsed = new URL(value);
    if (!['postgresql:', 'postgres:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2) throw new Error();
  } catch { throw new Error('Configure a valid PostgreSQL DATABASE_URL or DATABASE_URL_FILE.'); }
  return value;
};
