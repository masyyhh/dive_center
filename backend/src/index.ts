import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
dotenv.config();

import { configureSecurity, apiLimiter } from './middleware/security';
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
const PORT = process.env.PORT || 5001;

// Setup Security, Helmet, CORS
configureSecurity(app);

// JSON and URL-encoded body parser
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Apply general API rate limiter
app.use('/api', apiLimiter);

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Dive Centre Manager API',
  });
});

// Mount modular API routes
app.use('/api/auth', authRouter);
app.use('/api/properties', propertiesRouter);
app.use('/api/users', usersRouter);
app.use('/api/staff', staffRouter);
app.use('/api/items', itemsRouter);
app.use('/api/bills', billsRouter);
app.use('/api/presence', presenceRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/audit', auditRouter);

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled Server Error:', err);
  const status = err.status || 500;
  const message = err.message || 'An unexpected internal server error occurred.';
  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
});

// Start listening
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🚀 Dive Centre Manager Backend running on port ${PORT}`);
  console.log(`🔒 Security enabled (Helmet, Rate Limiter, CORS, RBAC)`);
  console.log(`===============================================`);
});

export default app;
