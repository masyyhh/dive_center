import { instructorIds } from './instructorCredits';
import type { Bill } from '../types';
import type { BillDraft } from './billDraft';

export const billToEditDraft = (bill: Bill): BillDraft => ({
  version: 1, expectedUpdatedAt: bill.updatedAt, editReason: '', checkNumber: bill.checkNumber,
  businessDate: bill.businessDate, roomNumber: bill.roomNumber, guestName: bill.guestName,
  departureDate: bill.departureDate || '', nationality: bill.nationality, tipAmount: bill.tipAmount,
  tipStaffIds: JSON.parse(bill.tipStaffIdsJson || '[]'), notes: bill.notes || '', checkEdited: true,
  checkoutDiscountPercent: '',
  // Saved percentages already include any previous checkout discount.
  billLines: bill.items.map(line => ({ ...line, instructorStaffIds: instructorIds(line), sourceLineId: line.id, clientLineId: line.id, autoPhotoFor: line.autoPhotoForLineId || null })),
});
