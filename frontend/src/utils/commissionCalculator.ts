import type { CommissionSelection } from './commissionEditor';
export function calculateCommissionPreview(input: {
  price: number; quantity: number; discount: number; poolType: string; poolRate: number;
  selections: CommissionSelection[]; combinedMedia: boolean; autoPhotoPrice?: number; autoPhotoCommission?: number; storeAttendantPool?: boolean;
}) {
  const { price, quantity, discount, poolType, poolRate, selections, combinedMedia } = input;
  if (!Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647 ||
      !Number.isFinite(discount) || discount < 0 || discount > 100 || !Number.isFinite(poolRate) || poolRate < 0) return null;
  const percentage = poolType === 'COURSE_POOL' || poolType === 'DIVE_POOL';
  if (percentage && poolRate > 100) return null;
  const selected = selections.filter(row => row.enabled && !(combinedMedia && ['photo', 'video'].includes(row.role)));
  if (selected.some(row => row.amount.trim() === '' || !Number.isFinite(Number(row.amount)) || Number(row.amount) < 0)) return null;
  const gross = price * quantity;
  const discountAmount = gross * discount / 100;
  const serviceTotal = gross - discountAmount;
  const photoPrice = input.autoPhotoPrice ?? 41.975;
  const photoCommission = input.autoPhotoCommission ?? 4.5;
  if (!Number.isFinite(photoPrice) || photoPrice < 0 || !Number.isFinite(photoCommission) || photoCommission < 0) return null;
  const photoCharge = combinedMedia ? photoPrice * quantity : 0;
  const billSubtotal = serviceTotal + photoCharge;
  const poolAmount = percentage ? serviceTotal * poolRate / 100 : poolType === 'CERTIFICATION_POOL' ? poolRate * quantity : 0;
  const payments = selected.map(row => ({ role: row.role as string, unitRate: Number(row.amount), amount: Number(row.amount) * quantity * (1 - discount / 100) }));
  if (combinedMedia) payments.push({ role: 'media', unitRate: photoCommission, amount: photoCommission * quantity });
  if (input.storeAttendantPool) payments.push({ role: 'storeAttendantPool', unitRate: price * .05, amount: Math.round(serviceTotal * 5) / 100 });
  const employeeTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (![gross, discountAmount, serviceTotal, photoCharge, billSubtotal, poolAmount, employeeTotal, ...payments.map(payment => payment.amount)].every(Number.isFinite)) return null;
  return { photoCharge, billSubtotal, gross, discountAmount, serviceTotal, percentage, poolAmount, payments, employeeTotal };
}
