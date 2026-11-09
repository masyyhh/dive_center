import { isSiyamWorld } from './propertyPresentation';

export const usesStoreAttendantPool = (property: { name: string } | null | undefined, categoryName: string | undefined) =>
  isSiyamWorld(property) && /^retail$/i.test(categoryName?.trim() || '');
