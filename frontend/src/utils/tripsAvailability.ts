export const tripsAvailable = (propertyId?: string): boolean =>
  Boolean(propertyId && import.meta.env.VITE_TRIPS_ENABLED === 'true');
