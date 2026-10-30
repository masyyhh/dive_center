import type { BillItem, Item } from '../types';
import { billPersonalRates } from './personalRates';

const makeId = () => crypto.randomUUID();
const total = (line: BillItem) => line.unitPrice * line.quantity * (1 - line.discountPercent / 100);

/** Rebuild activity/photo pairs, including older drafts from the bundled-payment workflow. */
export function normalizeAutomaticPhotos(lines: BillItem[], catalogue: Item[], id = makeId): BillItem[] {
  const photos = new Map(lines.filter(line => line.autoPhotoFor).map(line => [line.autoPhotoFor!, line]));
  const result: BillItem[] = [];
  for (const original of lines.filter(line => !line.autoPhotoFor)) {
    const item = catalogue.find(item => item.id === original.itemId);
    const included = item?.includesComplimentaryMedia ?? original.includesComplimentaryMedia ?? false;
    const key = original.clientLineId || id();
    const legacyPhotographer = original.photoStaffId;
    const parent: BillItem = { ...original, clientLineId: key, includesComplimentaryMedia: included };
    if (item) parent.personalCommissionsJson = billPersonalRates(item);
    if (included) {
      parent.photoStaffId = null; parent.videoStaffId = null;
      // If an inactive item is absent from the catalogue, its old draft still
      // displays the new split. The API will require an active item before save.
      if (!item) parent.personalCommissionsJson = billPersonalRates({ personalRatesJson: parent.personalCommissionsJson, includesComplimentaryMedia: true });
    }
    parent.lineTotal = total(parent);
    result.push(parent);
    if (included) {
      const previous = photos.get(key);
      const photo: BillItem = {
        clientLineId: previous?.clientLineId || id(), autoPhotoFor: key, itemId: null,
        itemName: 'Photo', categoryName: 'Photo & Video', quantity: parent.quantity,
        unitPrice: 57.5, discountPercent: previous?.discountPercent ?? 0, lineTotal: 0,
        personalCommissionsJson: '{"photo":4.5}', includesComplimentaryMedia: false,
        photoStaffId: previous?.photoStaffId || legacyPhotographer || null,
        sellerStaffId: null, guideStaffId: null, instructorStaffId: null, videoStaffId: null,
      };
      photo.lineTotal = total(photo);
      result.push(photo);
    }
  }
  return result;
}

export function addActivityWithPhoto(lines: BillItem[], item: Item, catalogue: Item[], id = makeId): BillItem[] {
  const roots = lines.map(line => ({ ...line }));
  const existing = roots.find(line => !line.autoPhotoFor && line.itemId === item.id);
  if (existing) existing.quantity++;
  else roots.push({ clientLineId: id(), itemId: item.id, itemName: item.name, categoryName: item.category?.name || 'General',
    quantity: 1, unitPrice: item.price, discountPercent: 0, lineTotal: item.price,
    includesComplimentaryMedia: item.includesComplimentaryMedia, personalCommissionsJson: billPersonalRates(item) });
  const result = normalizeAutomaticPhotos(roots, catalogue, id);
  if (result.length > 200) throw new Error('A bill can contain up to 200 lines, including automatically added Photos.');
  return result;
}

export function updateLinkedQuantity(lines: BillItem[], index: number, delta: number, catalogue: Item[]): BillItem[] {
  const target = lines[index];
  const key = target.autoPhotoFor || target.clientLineId;
  const updated = lines.map((line, position) => !line.autoPhotoFor && (key ? line.clientLineId === key : position === index)
    ? { ...line, quantity: Math.max(1, line.quantity + delta) } : { ...line });
  return normalizeAutomaticPhotos(updated, catalogue);
}

export function removeActivityWithPhoto(lines: BillItem[], index: number): BillItem[] {
  const target = lines[index];
  const key = target.autoPhotoFor || target.clientLineId;
  return lines.filter((line, position) => key ? line.clientLineId !== key && line.autoPhotoFor !== key : position !== index);
}
