import { z } from 'zod';

export const passwordPolicyMessage = 'Password must be exactly 12 characters and include uppercase and lowercase letters, a number, and a symbol (no spaces).';
export const passwordSchema = z.string().length(12, passwordPolicyMessage)
  .regex(/[A-Z]/, passwordPolicyMessage).regex(/[a-z]/, passwordPolicyMessage)
  .regex(/[0-9]/, passwordPolicyMessage).regex(/[^A-Za-z0-9\s]/, passwordPolicyMessage)
  .regex(/^\S+$/, passwordPolicyMessage);
