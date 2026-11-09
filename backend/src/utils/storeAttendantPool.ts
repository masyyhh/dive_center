export const STORE_ATTENDANT_RETAIL_RATE = 5;

export const usesStoreAttendantPool = (propertyName: string | undefined, categoryName: string) =>
  /^(sun\s+)?siyam\s+world$/i.test(propertyName?.trim() || '') && /^retail$/i.test(categoryName.trim());

export const isStoreAttendant = (roleTitle: string) => /^store\s+attendant$/i.test(roleTitle.trim());

/** Split whole cents deterministically so allocated payments reconcile to the pool. */
export function splitStorePool(amount: number, staffIds: string[]) {
  const ids = [...new Set(staffIds)].sort();
  if (!ids.length) return [];
  const cents = Math.round(amount * 100);
  const share = Math.floor(cents / ids.length);
  const remainder = cents % ids.length;
  return ids.map((staffId, index) => ({ staffId, amount: (share + (index < remainder ? 1 : 0)) / 100 }));
}
