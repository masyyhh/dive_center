export const commissionRoles = [
  { id: 'seller', label: 'Seller', description: 'Employee who sold the service' },
  { id: 'guide', label: 'Guide / Divemaster', description: 'Employee who guided the activity' },
  { id: 'instructor', label: 'Instructor', description: 'Employee who taught the course' },
  { id: 'photo', label: 'Photographer', description: 'Employee who took the photos' },
  { id: 'video', label: 'Videographer', description: 'Employee who recorded the video' },
] as const;

export type CommissionRole = typeof commissionRoles[number]['id'];
export type CommissionSelection = { role: CommissionRole; enabled: boolean; amount: string };

export function hasNoCommissions(item: { poolType: string; personalRoles?: string | null; personalRatesJson?: string | null; includesComplimentaryMedia: boolean }) {
  return item.poolType === 'NONE' && !item.includesComplimentaryMedia && readCommissionSelections(item.personalRoles, item.personalRatesJson)
    .every(row => !row.enabled || (row.amount.trim() !== '' && Number(row.amount) === 0));
}

export function readCommissionSelections(roles: string | null | undefined, json: string | null | undefined): CommissionSelection[] {
  let rates: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(json || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) rates = parsed;
  } catch { /* Prompt for amounts on legacy roles with invalid settings. */ }
  const selected = new Set((roles || '').split(',').map(role => role.trim().toLowerCase()));
  return commissionRoles.map(({ id }) => {
    const amount = rates[id];
    const valid = typeof amount === 'number' && Number.isFinite(amount) && amount >= 0;
    return { role: id, enabled: selected.has(id) || valid, amount: valid ? String(amount) : '' };
  });
}

export function serializeCommissionSelections(selections: CommissionSelection[], combinedMedia = false) {
  const rates: Partial<Record<CommissionRole, number>> = {};
  for (const selection of selections) {
    if (!selection.enabled) continue;
    const amount = Number(selection.amount);
    const valid = selection.amount.trim() !== '' && Number.isFinite(amount) && amount >= 0;
    const paused = combinedMedia && (selection.role === 'photo' || selection.role === 'video');
    if (!valid && !paused) {
      const role = commissionRoles.find(role => role.id === selection.role)!;
      throw new Error(`Enter a payment of zero or more for ${role.label}.`);
    }
    // Keep separate media settings for when the combined payment is turned off.
    rates[selection.role] = valid ? amount : 0;
  }
  return { personalRoles: Object.keys(rates).join(','), personalRatesJson: JSON.stringify(rates) };
}
