import type { PmsGuest } from '../types';
export const pmsResortCodes = ['OLHU', 'SSO', 'SW', 'MLEIR', 'SAIV', 'VILU', 'AQUA'];
// Missing PMS values clear previous guest values instead of carrying details across guests.
export const guestBillFields = (guest: PmsGuest) => ({ guestName: guest.fullName, departureDate: guest.checkoutDate || '', nationality: guest.nationality ?? '' });
