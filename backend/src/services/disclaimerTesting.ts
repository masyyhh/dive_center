import { readSecret } from '../config/secrets';
import { businessToday } from '../utils/dates';
import type { PmsGuest } from './pmsService';

// NODE_ENV remains production in the hardened testing containers. Require an
// explicit deployment mode AND the standalone testing datasource instead.
export const disclaimerTestGuestsEnabled = (): boolean => {
  if (process.env.DISCLAIMER_TEST_GUESTS !== 'true') return false;
  let database: URL;
  try { database = new URL(readSecret('DATABASE_URL')); }
  catch { throw new Error('Disclaimer test guests require the isolated testing database.'); }
  if (process.env.APP_DEPLOYMENT_MODE !== 'testing'
    || !['postgresql:', 'postgres:'].includes(database.protocol)
    || database.hostname !== 'db'
    || database.pathname !== '/dive_center_testing'
    || database.username !== 'dive_center_testing'
    || process.env.TESTING_LIVE_AUTH !== 'false'
    || readSecret('PMS_API_KEY')) {
    throw new Error('Disclaimer test guests require standalone testing mode, the isolated testing database and disabled live integrations.');
  }
  return true;
};

// Only Disclaimer uses these records. Billing and ordinary PMS lookup are unchanged.
export const disclaimerTestGuests = (roomNumber: string): PmsGuest[] => {
  if (!disclaimerTestGuestsEnabled()) throw new Error('Disclaimer test guests are disabled.');
  const names = roomNumber === '0012' ? ['TEST ONLY — Alex Guest', 'TEST ONLY — Sam Guest']
    : roomNumber === '0013' ? ['TEST ONLY — Child Participant'] : [];
  const today = businessToday();
  const checkout = new Date(`${today}T12:00:00.000Z`);
  checkout.setUTCDate(checkout.getUTCDate() + 7);
  return names.map((fullName, index) => ({
    propertyCode: 'VILU', roomNumber, fullName, guestType: index === 0 ? 'main' : 'sharer',
    nationality: null, nationalityCode: null, arrivalDate: today,
    checkoutDate: checkout.toISOString().slice(0, 10),
    confirmationNumber: `DISCLAIMER-TEST-${roomNumber}-${index + 1}`,
  }));
};
