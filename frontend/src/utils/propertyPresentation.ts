import type { Property } from '../types';

// Deliberately match the full property name, rather than the shared Sun Siyam brand.
export function usesCompactBilling(property: Pick<Property, 'name'> | null | undefined): boolean {
  return /^(sun\s+)?siyam\s+world$/i.test(property?.name?.trim() ?? '');
}
