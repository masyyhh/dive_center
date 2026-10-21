import { loadDatabaseUrl } from './config/database';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({ datasources: { db: { url: loadDatabaseUrl() } } });
