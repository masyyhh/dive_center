import { isBusinessDate } from './dates';

export const tripsStartDate = process.env.TRIPS_START_DATE ?? '';
export const tripsAvailable = (propertyId: unknown): boolean =>
  typeof propertyId === 'string' && propertyId !== '' &&
  process.env.TRIPS_ENABLED === 'true' && isBusinessDate(tripsStartDate);
