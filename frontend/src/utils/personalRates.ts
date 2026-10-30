export function billPersonalRates(item: { personalRatesJson?: string | null; includesComplimentaryMedia: boolean }): string {
  let rates: Record<string, number> = {};
  try {
    const parsed = JSON.parse(item.personalRatesJson || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      rates = Object.fromEntries(Object.entries(parsed).filter(([role, amount]) =>
        ['seller', 'guide', 'instructor', 'photo', 'video'].includes(role) && typeof amount === 'number' && Number.isFinite(amount) && amount >= 0)) as Record<string, number>;
    }
  } catch { /* Invalid legacy rates are ignored. */ }
  if (item.includesComplimentaryMedia) {
    delete rates.photo;
    delete rates.video;
  }
  return JSON.stringify(rates);
}
