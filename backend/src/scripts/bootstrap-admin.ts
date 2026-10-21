import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { readSecret } from '../config/secrets';

export const bootstrapAdmin = async () => {
  const input = z.object({ email: z.string().email(), name: z.string().trim().min(2), password: z.string().min(12).max(72) }).parse({
    email: process.env.ADMIN_EMAIL, name: process.env.ADMIN_NAME || 'Administrator', password: readSecret('ADMIN_PASSWORD'),
  });
  const existing = await prisma.user.count({ where: { role: 'GLOBAL_ADMIN' } });
  if (existing > 0) throw new Error('An administrator already exists. Use account management; bootstrap will never overwrite credentials.');
  await prisma.user.create({ data: { username: input.email.toLowerCase(), email: input.email.toLowerCase(), name: input.name, role: 'GLOBAL_ADMIN', passwordHash: await bcrypt.hash(input.password, 12) } });
  console.log('Initial administrator created. No demo accounts or business records were added.');
};

if (require.main === module) bootstrapAdmin().catch(() => { console.error('Administrator setup failed. Check input and whether an administrator already exists.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
