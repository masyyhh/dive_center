import rateLimit from 'express-rate-limit';
import cors from 'cors';
import helmet from 'helmet';
import { Express } from 'express';

export const configureSecurity = (app: Express) => {
  // Helmet security headers
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false, // Vite React SPA in dev
    })
  );

  // CORS configuration
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : ['http://localhost:5173', 'http://127.0.0.1:5173'];

  if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) throw new Error('CORS_ORIGIN is required in production.');

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, postman)
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Property-Id'],
    })
  );
};

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' },
});

// Strict Login rate limiter to prevent brute-force attacks
export const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // max 20 attempts per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again in 5 minutes.' },
});

// Authenticated per-account limiter protects the upstream hotel service quota.
export const pmsLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: req => req.user!.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many guest lookups. Wait a minute before trying again.' },
});
