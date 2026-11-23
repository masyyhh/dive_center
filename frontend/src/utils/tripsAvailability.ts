export const tripsAvailable = (propertyId?: string): boolean =>
  Boolean(propertyId && propertyId === import.meta.env.VITE_TRIPS_PROPERTY_ID);
