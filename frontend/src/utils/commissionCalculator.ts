import type { CommissionSelection } from './commissionEditor';
export function calculateCommissionPreview(input: {
  price: number; quantity: number; discount: number; poolType: string; poolRate: number;
  selections: CommissionSelection[]; combinedMedia: boolean;
}) {
  const { price, quantity, discount, poolType, poolRate, selections, combinedMedia } = input;
  if (!Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity < 1 ||
      !Number.isFinite(discount) || discount < 0 || discount > 100 || !Number.isFinite(poolRate) || poolRate < 0) return null;
  const percentage = poolType === 'COURSE_POOL' || poolType === 'DIVE_POOL';
  if (percentage && poolRate > 100) return null;
  const selected = selections.filter(row => row.enabled && !(combinedMedia && ['photo', 'video'].includes(row.role)));
  if (selected.some(row => row.amount.trim() === '' || !Number.isFinite(Number(row.amount)) || Number(row.amount) < 0)) return null;
  const gross = price * quantity;
  const discountAmount = gross * discount / 100;
  const serviceTotal = gross - discountAmount;
  const photoCharge = combinedMedia ? 57.5 * quantity : 0;
  const billSubtotal = serviceTotal + photoCharge;
  const poolAmount = percentage ? serviceTotal * poolRate / 100 : poolType === 'CERTIFICATION_POOL' ? poolRate * quantity : 0;
  const payments = selected.map(row => ({ role: row.role as string, unitRate: Number(row.amount), amount: Number(row.amount) * quantity }));
  if (combinedMedia) payments.push({ role: 'media', unitRate: 4.5, amount: 4.5 * quantity });
  if (![gross, discountAmount, serviceTotal, photoCharge, billSubtotal, poolAmount, ...payments.map(payment => payment.amount)].every(Number.isFinite)) return null;
  return { photoCharge, billSubtotal, gross, discountAmount, serviceTotal, percentage, poolAmount, payments, employeeTotal: payments.reduce((sum, payment) => sum + payment.amount, 0) };
}
