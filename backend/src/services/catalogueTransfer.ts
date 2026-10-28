import { parseCatalogueCells } from './catalogueParser';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

export const catalogueHeaders = ['Item Code', 'Items', 'Category', 'Price', 'Commission', 'Status'];
const poolType = z.enum(['NONE', 'COURSE_POOL', 'DIVE_POOL']);
const rates = z.partialRecord(z.enum(['seller', 'guide', 'instructor', 'photo', 'video']), z.number().finite().nonnegative());
const commissionSchema = z.object({ poolType, poolContribution: z.number().finite().nonnegative(), personalRates: rates.default({}) }).strict();
export type CatalogueRow = { row: number; code: string; name: string; category: string; price: number; isActive: boolean; commission: z.infer<typeof commissionSchema> };
export class CatalogueError extends Error {}
export const categoryPrefix = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3).padEnd(3, 'X');
export const itemCodeAllocator = (codes: Iterable<string>) => {
  const counters = new Map<string, bigint>();
  for (const code of codes) {
    const match = /^([A-Z]{3})-(\d+)$/.exec(code);
    if (match) {
      const number = BigInt(match[2]);
      if (number > (counters.get(match[1]) ?? 0n)) counters.set(match[1], number);
    }
  }
  return (category: string) => {
    const prefix = categoryPrefix(category);
    const number = (counters.get(prefix) ?? 0n) + 1n;
    counters.set(prefix, number);
    return `${prefix}-${String(number).padStart(3, '0')}`;
  };
};
export const nextItemCode = async (tx: Prisma.TransactionClient, propertyId: string, category: string) => {
  const prefix = categoryPrefix(category);
  const items = await tx.item.findMany({ where: { propertyId, code: { startsWith: `${prefix}-` } }, select: { code: true } });
  return itemCodeAllocator(items.map(item => item.code))(category);
};
export const parseCatalogue = async (content: string, format: 'csv' | 'xlsx'): Promise<CatalogueRow[]> => {
  const bytes = Buffer.from(content, 'base64');
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) throw new CatalogueError('Choose a CSV or Excel file up to 3 MB.');
  let cells: string[][];
  try {
    cells = await parseCatalogueCells(bytes, format);
  } catch (error) { throw new CatalogueError(error instanceof Error ? error.message : 'The file could not be read. Choose a valid CSV or Excel workbook.'); }
  const text = (row: number, col: number): string => {
    const value = cells[row - 1]?.[col - 1] || '';
    return /^'+[\s\x00-\x1f]*[=+\-@]/.test(value) ? value.slice(1) : value;
  };
  if (catalogueHeaders.some((header, index) => text(1, index + 1).toLowerCase() !== header.toLowerCase())) throw new CatalogueError(`Use these six columns in order: ${catalogueHeaders.join(', ')}.`);
  const rows: CatalogueRow[] = [];
  const codes = new Set<string>();
  for (let row = 2; row <= cells.length; row++) {
    const [code, name, category, priceText, commissionText, status] = catalogueHeaders.map((_, index) => text(row, index + 1));
    if (![code, name, category, priceText, commissionText, status].some(Boolean)) continue;
    if (code.length > 50 || name.length < 2 || name.length > 200 || !category || category.length > 80 || !priceText || !Number.isFinite(Number(priceText)) || Number(priceText) < 0 || !['active', 'inactive'].includes(status.toLowerCase())) throw new CatalogueError(`Row ${row}: enter an item, category, nonnegative price and Active or Inactive status.`);
    if (code && codes.has(code)) throw new CatalogueError(`Row ${row}: duplicate item code ${code}.`);
    if (code) codes.add(code);
    let commission: unknown;
    try {
      const value = commissionText ? JSON.parse(commissionText) : 0;
      commission = typeof value === 'number' ? { poolType: /cour/i.test(category) ? 'COURSE_POOL' : 'DIVE_POOL', poolContribution: value, personalRates: {} } : value;
    } catch { throw new CatalogueError(`Row ${row}: Commission must be a nonnegative pool amount or a commission JSON object.`); }
    const parsed = commissionSchema.safeParse(commission);
    if (!parsed.success || parsed.data.poolType === 'NONE' && parsed.data.poolContribution !== 0) throw new CatalogueError(`Row ${row}: invalid Commission. Use nonnegative amounts and supported pool/role names.`);
    rows.push({ row, code, name, category, price: Number(priceText), isActive: status.toLowerCase() === 'active', commission: parsed.data });
  }
  if (!rows.length) throw new CatalogueError('The file has no items to import.');
  return rows;
};
export const commissionCell = (item: { poolType: string; poolContribution: number; personalRatesJson: string | null }) => {
  let personalRates = {};
  try { personalRates = JSON.parse(item.personalRatesJson || '{}'); } catch { /* Preserve usable pool settings for old catalogue entries. */ }
  return JSON.stringify({ poolType: item.poolType, poolContribution: item.poolContribution, personalRates });
};
export const safeSpreadsheetText = (value: string) => /^'*[\s\x00-\x1f]*[=+\-@]/.test(value) ? `'${value}` : value;
