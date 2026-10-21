import { readFileSync } from 'node:fs';

export const readSecret = (name: string, env: NodeJS.ProcessEnv = process.env): string => {
  const value = env[name];
  const file = env[`${name}_FILE`];
  if (value && file) throw new Error(`Set only ${name} or ${name}_FILE, not both.`);
  return (file ? readFileSync(file, 'utf8') : value || '').trim();
};

export const loadJwtSecret = (env: NodeJS.ProcessEnv = process.env): string => {
  const secret = readSecret('JWT_SECRET', env);
  if (secret.length < 32 || /change.?in.?prod|change.?me|example|placeholder/i.test(secret)) {
    throw new Error('JWT_SECRET must be an independently generated secret of at least 32 characters.');
  }
  return secret;
};
