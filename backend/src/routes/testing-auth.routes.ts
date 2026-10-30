import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAccountAuth, requireLogoutAuth } from '../middleware/auth';
import { authLimiter } from '../middleware/security';
import { createTestingLiveSession, testingUserResponse, TestingAuthError } from '../services/testingLiveAuth';
import { logAuditEvent } from '../services/auditService';

export const testingAuthRouter = Router();
testingAuthRouter.post('/live-session', authLimiter, async (req, res) => {
  const parsed = z.object({ liveToken: z.string().min(20).max(8192).regex(/^[A-Za-z0-9._-]+$/) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Sign in to live first, then connect your live sign-in.' });
  try {
    const result = await createTestingLiveSession(parsed.data.liveToken);
    req.user = { ...result.user, role: result.user.role as any, assignedPropertyIds: result.user.assignedProperties.map(property => property.id) };
    await logAuditEvent({ req, action: 'TESTING_LIVE_LOGIN', targetType: 'User', targetId: result.user.id });
    return res.json(result);
  } catch (error) {
    return res.status(error instanceof TestingAuthError ? error.status : 503).json({ error: error instanceof TestingAuthError ? error.message : 'Testing sign-in is temporarily unavailable.' });
  }
});
testingAuthRouter.get('/me', requireAccountAuth, async (req, res) => {
  try { return res.json({ user: await testingUserResponse(req.user!.id, req.testingLiveUsername!) }); }
  catch { return res.status(503).json({ error: 'Testing sign-in is temporarily unavailable.' }); }
});
testingAuthRouter.post('/logout', requireLogoutAuth, async (req, res) => {
  try {
    await prisma.testingLiveSession.deleteMany({ where: { id: req.testingLiveSessionId! } });
    await logAuditEvent({ req, action: 'TESTING_LOGOUT', targetType: 'User', targetId: req.user!.id });
    return res.json({ message: 'Signed out of testing. Your live session is unchanged.' });
  } catch { return res.status(503).json({ error: 'Could not sign out of testing. Please try again.' }); }
});
// Never proxy password changes, enrollment, resets or local-password logins to live.
testingAuthRouter.use((_req, res) => res.status(403).json({ error: 'Manage passwords and authenticators in the live version. Testing uses only selected live accounts.' }));
