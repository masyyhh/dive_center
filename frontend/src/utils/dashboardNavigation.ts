import { isBusinessDate } from './dates';

export function investigationPeriod(section = '') {
  const params = new URLSearchParams(section.split('?')[1] || '');
  const startDate = params.get('startDate') || '';
  const endDate = params.get('endDate') || '';
  return isBusinessDate(startDate) && isBusinessDate(endDate) && startDate <= endDate
    ? { startDate, endDate, discountedOnly: params.get('discounted') === 'true' } : null;
}

export function investigationSection(kind: 'revenue' | 'discounts' | 'commissions', startDate: string, endDate: string) {
  const params = new URLSearchParams({ startDate, endDate });
  if (kind === 'discounts') params.set('discounted', 'true');
  return `${kind === 'commissions' ? 'commissions' : 'range'}?${params}`;
}
