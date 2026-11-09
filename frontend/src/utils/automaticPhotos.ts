import { photoIds } from './photoCredits';
import type { BillItem, Item, DivePackage } from '../types';
import { billPersonalRates } from './personalRates';

const makeId = () => crypto.randomUUID();
const total = (line: BillItem) => line.unitPrice * line.quantity * (1 - line.discountPercent / 100);

interface AutoPhotoRates {
  price?: number;
  commission?: number;
}

/** Rebuild activity/photo pairs, including older drafts from the bundled-payment workflow. */
export function normalizeAutomaticPhotos(lines: BillItem[], catalogue: Item[], id = makeId, rates?: AutoPhotoRates): BillItem[] {
  const photos = new Map(lines.filter(line => line.autoPhotoFor).map(line => [line.autoPhotoFor!, line]));
  const result: BillItem[] = [];
  const photoPrice = rates?.price ?? 41.975;
  const photoCommission = rates?.commission ?? 4.5;
  for (const original of lines.filter(line => !line.autoPhotoFor)) {
    const item = catalogue.find(item => item.id === original.itemId);
    const included = (original.sourceLineId ? original.includesComplimentaryMedia : item?.includesComplimentaryMedia) ?? original.includesComplimentaryMedia ?? false;
    const key = original.clientLineId || id();
    const legacyPhotographers = photoIds(original);
    const parent: BillItem = { ...original, clientLineId: key, includesComplimentaryMedia: included };
    if (item && !original.sourceLineId) parent.personalCommissionsJson = billPersonalRates(item);
    if (included) {
      parent.photoStaffId = null; parent.photoStaffIds = []; parent.videoStaffId = null;
      // If an inactive item is absent from the catalogue, its old draft still
      // displays the new split. The API will require an active item before save.
      if (!item) parent.personalCommissionsJson = billPersonalRates({ personalRatesJson: parent.personalCommissionsJson, includesComplimentaryMedia: true });
    }
    parent.lineTotal = total(parent);
    result.push(parent);
    if (included) {
      const previous = photos.get(key);
      const selectedPhotoStaff = previous ? photoIds(previous) : legacyPhotographers;
      const photo: BillItem = {
        ...(previous?.sourceLineId ? { sourceLineId: previous.sourceLineId, id: previous.id } : {}),
        clientLineId: previous?.clientLineId || id(), autoPhotoFor: key, itemId: null,
        itemName: 'Photo', categoryName: 'Photo & Video', quantity: parent.quantity,
        unitPrice: previous?.sourceLineId ? previous.unitPrice : photoPrice, discountPercent: previous?.discountPercent ?? 0, lineTotal: 0,
        personalCommissionsJson: previous?.sourceLineId ? previous.personalCommissionsJson : JSON.stringify({ photo: photoCommission }), includesComplimentaryMedia: false,
        photoStaffId: selectedPhotoStaff[0] || null, photoStaffIds: selectedPhotoStaff,
        sellerStaffId: null, guideStaffId: null, instructorStaffId: null, videoStaffId: null,
      };
      photo.lineTotal = total(photo);
      result.push(photo);
    }
  }
  return result;
}

export function addActivityWithPhoto(lines: BillItem[], item: Item, catalogue: Item[], id = makeId, rates?: AutoPhotoRates): BillItem[] {
  const roots = lines.map(line => ({ ...line }));
  const existing = roots.find(line => !line.autoPhotoFor && !line.sourceLineId && line.itemId === item.id && line.discountPercent === 0);
  if (existing) existing.quantity++;
  else roots.push({ clientLineId: id(), itemId: item.id, itemName: item.name, categoryName: item.category?.name || 'General',
    quantity: 1, unitPrice: item.price, discountPercent: 0, lineTotal: item.price,
    includesComplimentaryMedia: item.includesComplimentaryMedia, personalCommissionsJson: billPersonalRates(item) });
  const result = normalizeAutomaticPhotos(roots, catalogue, id, rates);
  if (result.length > 200) throw new Error('A bill can contain up to 200 lines, including automatically added Photos.');
  return result;
}

export function addPackageWithPhoto(
  lines: BillItem[],
  pkg: DivePackage,
  catalogue: Item[],
  id = makeId,
  rates?: AutoPhotoRates
): BillItem[] {
  const roots = lines.map(line => ({ ...line }));
  for (const pkgItem of pkg.items) {
    const item = catalogue.find(c => c.id === pkgItem.itemId);
    if (!item || item.isActive === false) throw new Error('A package item is unavailable. Refresh the catalogue before adding this package.');
    roots.push({
      clientLineId: id(),
      itemId: item.id,
      itemName: item.name,
      categoryName: item.category?.name || 'Package',
      quantity: pkgItem.quantity,
      unitPrice: item.price,
      discountPercent: 0,
      lineTotal: item.price * pkgItem.quantity,
      includesComplimentaryMedia: item.includesComplimentaryMedia,
      personalCommissionsJson: billPersonalRates(item),
    });
  }
  const result = normalizeAutomaticPhotos(roots, catalogue, id, rates);
  if (result.length > 200) throw new Error('A bill can contain up to 200 lines, including automatically added Photos.');
  return result;
}

export function updateLinkedQuantity(lines: BillItem[], index: number, delta: number, catalogue: Item[], rates?: AutoPhotoRates): BillItem[] {
  const target = lines[index];
  const key = target.autoPhotoFor || target.clientLineId;
  const updated = lines.map((line, position) => !line.autoPhotoFor && (key ? line.clientLineId === key : position === index)
    ? { ...line, quantity: Math.max(1, line.quantity + delta) } : { ...line });
  return normalizeAutomaticPhotos(updated, catalogue, makeId, rates);
}

export function removeActivityWithPhoto(lines: BillItem[], index: number): BillItem[] {
  const target = lines[index];
  const key = target.autoPhotoFor || target.clientLineId;
  return lines.filter((line, position) => key ? line.clientLineId !== key && line.autoPhotoFor !== key : position !== index);
}

/** Separate selected units so price, commission and linked Photo quantities remain explicit. */
export function discountSelectedQuantity(lines: BillItem[], index: number, quantity: number, percent: number, id = makeId): BillItem[] {
  const target = lines[index];
  if (!target || !Number.isInteger(quantity) || quantity < 1 || quantity > target.quantity || !Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Choose a whole quantity on this line and a discount from 0 to 100%.');
  if (quantity === target.quantity) return lines.map((line, i) => i === index ? { ...line, discountPercent: percent, lineTotal: line.unitPrice * line.quantity * (1 - percent / 100) } : line);
  const rootKey = target.autoPhotoFor || target.clientLineId;
  const root = lines.find(line => !line.autoPhotoFor && line.clientLineId === rootKey);
  if (!root || !rootKey) throw new Error('Reload the bill before splitting this line.');
  const photo = lines.find(line => line.autoPhotoFor === rootKey);
  if (lines.length + (photo ? 2 : 1) > 200) throw new Error('This discount would exceed the 200-line bill limit.');
  const partKey = id();
  const remaining = { ...root, quantity: root.quantity - quantity };
  const part = { ...root, id: undefined, clientLineId: partKey, quantity, discountPercent: target.autoPhotoFor ? root.discountPercent : percent };
  const replacements: BillItem[] = [remaining];
  if (photo) replacements.push({ ...photo, quantity: remaining.quantity });
  replacements.push(part);
  if (photo) replacements.push({ ...photo, id: undefined, clientLineId: id(), autoPhotoFor: partKey, quantity, discountPercent: target.autoPhotoFor ? percent : photo.discountPercent });
  const recomputed = replacements.map(line => ({ ...line, lineTotal: total(line) }));
  return lines.flatMap(line => line === root ? recomputed : line === photo ? [] : [line]);
}
