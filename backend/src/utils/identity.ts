import { z } from 'zod';
export const usernameSchema = z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._@+\-]+$/, 'Use letters, numbers, dots, underscores, @, + or hyphens.').transform(value => value.toLowerCase());
// Existing email-shaped IDs are preserved as usernames by the migration.
export const findLoginUser = async (db: any, identifier: string, include: any = undefined) => db.user.findUnique({ where: { username: identifier.trim().toLowerCase() }, include });
