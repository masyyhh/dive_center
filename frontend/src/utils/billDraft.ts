import { BillItem } from '../types';
export interface BillDraft {
  version: 1;
  checkNumber: number;
  businessDate: string;
  roomNumber: string;
  guestName: string;
  departureDate: string;
  nationality: string;
  tipAmount: number;
  tipStaffIds: string[];
  billLines: BillItem[];
  notes: string;
  checkEdited: boolean;
}
export const billDraftKey = (userId: string, propertyId: string) => `${import.meta.env?.VITE_DEPLOYMENT_MODE === 'testing' ? 'dcm_testing_' : 'dcm_'}bill_draft:${userId}:${propertyId}`;
export const isBillDraft = (value: unknown): value is BillDraft => {
  if (!value || typeof value !== 'object') return false;
  const d = value as BillDraft;
  return d.version === 1 && Number.isInteger(d.checkNumber) && d.checkNumber > 0 &&
    typeof d.businessDate === 'string' && (d.businessDate === '' || /^\d{4}-\d{2}-\d{2}$/.test(d.businessDate)) &&
    ['roomNumber', 'guestName', 'departureDate', 'nationality', 'notes'].every(key => typeof d[key as keyof BillDraft] === 'string') &&
    typeof d.checkEdited === 'boolean' && Number.isFinite(d.tipAmount) && d.tipAmount >= 0 &&
    Array.isArray(d.tipStaffIds) && d.tipStaffIds.every(id => typeof id === 'string') &&
    Array.isArray(d.billLines) && d.billLines.every(line =>
      line && typeof line.itemName === 'string' && typeof line.categoryName === 'string' &&
      Number.isInteger(line.quantity) && line.quantity > 0 && Number.isFinite(line.unitPrice) && line.unitPrice >= 0 &&
      Number.isFinite(line.discountPercent) && line.discountPercent >= 0 && line.discountPercent <= 100 && Number.isFinite(line.lineTotal));
};
export const loadBillDraft = (key: string): BillDraft | null => {
  try {
    const data: unknown = JSON.parse(sessionStorage.getItem(key) || 'null');
    return isBillDraft(data) ? data : null;
  } catch { return null; }
};
