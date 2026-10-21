import { auditApiActivity } from './middleware/audit';
import express, { Request, Response, NextFunction } from 'express';

import { prisma } from './db';
import { configureSecurity, apiLimiter } from './middleware/security';
import { guestsRouter } from './routes/guests.routes';
import { passwordRouter } from './routes/password.routes';
import { authRouter } from './routes/auth.routes';
import { propertiesRouter } from './routes/properties.routes';
import { usersRouter } from './routes/users.routes';
import { staffRouter } from './routes/staff.routes';
import { itemsRouter } from './routes/items.routes';
import { billsRouter } from './routes/bills.routes';
import { presenceRouter } from './routes/presence.routes';
import { reportsRouter } from './routes/reports.routes';
import { auditRouter } from './routes/audit.routes';

const app = express();

// Setup Security, Helmet, CORS
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
configureSecurity(app);

// JSON and URL-encoded body parser
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Apply general API rate limiter
app.use('/api', auditApiActivity);
app.use('/api', apiLimiter);

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Dive Centre Manager API',
  });
});

app.get('/api/ready', async (_req: Request, res: Response) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ status: 'ready' }); }
  catch { res.status(503).json({ error: 'Database unavailable.' }); }
});

// Mount modular API routes
app.use('/api/auth', passwordRouter);
app.use('/api/auth', authRouter);
app.use('/api/properties', propertiesRouter);
app.use('/api/users', usersRouter);
app.use('/api/staff', staffRouter);
app.use('/api/items', itemsRouter);
app.use('/api/guests', guestsRouter);
app.use('/api/bills', billsRouter);
app.use('/api/presence', presenceRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/audit', auditRouter);

// Never return internal exception details in production.
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;
  if (status >= 500) console.error('Unhandled API error:', err);
  res.status(status).json({ error: status === 400 ? 'Invalid request.' : status === 413 ? 'Request body is too large.' : 'An unexpected server error occurred.' });
});

export default app;
