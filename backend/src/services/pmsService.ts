import { boundedArray } from '../utils/validation';
import { z } from 'zod';
import { readSecret } from '../config/secrets';
import { isBusinessDate } from '../utils/dates';

export const pmsPropertyCodes = ['OLHU', 'SSO', 'SW', 'MLEIR', 'SAIV', 'VILU', 'AQUA'] as const;
export const pmsPropertyCodeSchema = z.enum(pmsPropertyCodes);
export class PmsLookupError extends Error {
  constructor(public status: number, message: string, public requestId?: string) { super(message); }
}
const dateField = z.string().refine(isBusinessDate).nullish().transform(value => value || null);
const guestSchema = z.object({
  propertyCode: pmsPropertyCodeSchema,
  roomNumber: z.string().trim().min(1).max(32),
  fullName: z.string().trim().min(1).max(300),
  guestType: z.enum(['main', 'sharer']),
  nationality: z.string().max(200).nullish().transform(value => value ?? null),
  nationalityCode: z.string().max(10).nullish().transform(value => value ?? null),
  checkoutDate: dateField,
  arrivalDate: dateField,
  confirmationNumber: z.string().max(100).nullish().transform(value => value ?? null),
});
export type PmsGuest = z.infer<typeof guestSchema>;
const responseSchema = z.object({
  property_code: pmsPropertyCodeSchema,
  room_number: z.string().trim(),
  data: boundedArray(guestSchema, 100),
});
const safeRequestId = (response: globalThis.Response) => {
  const value = response.headers.get('X-Request-ID');
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
};

export const lookupInhouseGuests = async (propertyCode: typeof pmsPropertyCodes[number], roomNumber: string) => {
  let key: string;
  try { key = readSecret('PMS_API_KEY'); } catch { throw new PmsLookupError(503, 'PMS guest lookup is not configured. Contact your administrator.'); }
  if (!key) throw new PmsLookupError(503, 'PMS guest lookup is not configured. Contact your administrator.');
  const url = new URL('https://pmsapi.ssrsys.com/api/v1/inhouse/guests');
  url.searchParams.set('property_code', propertyCode);
  url.searchParams.set('room_number', roomNumber);
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: globalThis.Response;
    try {
      response = await fetch(url, { headers: { 'X-API-Key': key, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000) });
    } catch (err) {
      console.error('PMS fetch error:', err instanceof Error ? err.message : err);
      throw new PmsLookupError(503, 'The PMS could not be reached. Try again or enter guest details manually.');
    }
    const requestId = safeRequestId(response);
    console.info('PMS guest lookup response', { status: response.status, requestId: requestId || 'unavailable' });
    if (response.status === 503 && attempt === 0) { await response.body?.cancel(); continue; }
    if (!response.ok) {
      const status = response.status === 429 ? 429 : response.status === 503 ? 503 : 502;
      const message = response.status === 401 ? 'PMS authentication failed. Ask your administrator to check the API key.'
        : response.status === 403 ? 'PMS access is not enabled for this resort. Contact your administrator.'
        : response.status === 422 ? 'The PMS did not accept this room or resort. Check the room number and property PMS setting.'
        : response.status === 429 ? 'The PMS is busy with too many lookups. Wait before trying again.'
        : 'The PMS is temporarily unavailable. Try again or enter guest details manually.';
      await response.body?.cancel();
      throw new PmsLookupError(status, message, requestId);
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new PmsLookupError(502, 'The PMS returned an unreadable response. Enter guest details manually or try again.', requestId); }
    const parsed = responseSchema.safeParse(payload);
    const allowed = propertyCode === 'OLHU' ? ['OLHU', 'SSO'] : [propertyCode];
    if (!parsed.success || parsed.data.property_code !== propertyCode || parsed.data.room_number !== roomNumber || parsed.data.data.some(guest => guest.roomNumber !== roomNumber || !allowed.includes(guest.propertyCode))) {
      throw new PmsLookupError(502, 'The PMS returned unexpected guest details. Enter guest details manually or contact your administrator.', requestId);
    }
    return { guests: parsed.data.data, requestId };
  }
  throw new PmsLookupError(503, 'The PMS is temporarily unavailable. Try again later.');
};
