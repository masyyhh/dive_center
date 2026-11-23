import { isBusinessDate } from './dates';

export const tripsStartDate = process.env.TRIPS_START_DATE ?? '';
export const tripsAvailable = (propertyId: unknown): boolean =>
  typeof propertyId === 'string' && propertyId !== '' &&
  propertyId === process.env.TRIPS_PROPERTY_ID && isBusinessDate(tripsStartDate);
