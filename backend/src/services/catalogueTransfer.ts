import { parseCatalogueCells } from './catalogueParser';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { validPoolRate } from '../utils/poolRates';

export const catalogueHeaders = ['Item Code', 'Items', 'Category', 'Price', 'Commission', 'Status'];
export const catalogueSpreadsheetHeaders = [
  'Item Code', 'Service Name', 'Category', 'Price', 'Pool', 'Pool Rate (%)',
  'Certifications Amount / Unit', 'Seller Payment / Unit', 'Guide Payment / Unit',
  'Instructor Payment / Unit', 'Photographer Payment / Unit', 'Videographer Payment / Unit',
  'Include Photo ($57.50)', 'Status',
];
export const cataloguePoolLabels: Record<string, string> = { COURSE_POOL: 'Course pool', DIVE_POOL: 'Dive pool', CERTIFICATION_POOL: 'Certifications', NONE: 'No pool' };

const poolType = z.enum(['NONE', 'COURSE_POOL', 'CERTIFICATION_POOL', 'DIVE_POOL']);
const rates = z.partialRecord(z.enum(['seller', 'guide', 'instructor', 'photo', 'video']), z.number().finite().nonnegative());
const commissionSchema = z.object({ poolType, poolContribution: z.number().finite().nonnegative(), personalRates: rates.default({}), includesComplimentaryMedia: z.boolean().optional() }).strict().refine(data => validPoolRate(data.poolType, data.poolContribution), 'Course and dive pool rates must be between 0 and 100 percent.');
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
  const matches = (headers: string[]) => headers.every((header, index) => text(1, index + 1).toLowerCase() === header.toLowerCase()) && !cells[0].slice(headers.length).some(Boolean);
  const labelled = matches(catalogueSpreadsheetHeaders) || matches(catalogueSpreadsheetHeaders.map(header => header === 'Include Photo ($57.50)' ? 'Complimentary Photo / Video' : header));
  if (!labelled && !matches(catalogueHeaders)) throw new CatalogueError('Use the downloaded catalogue template, or the original six-column catalogue format. Keep column names and order unchanged.');
  const rows: CatalogueRow[] = [];
  const codes = new Set<string>();
  const amount = (value: string, row: number, label: string, required = false): number | undefined => {
    if (!value) {
      if (required) throw new CatalogueError(`Row ${row}: enter ${label}. Use 0 for no contribution.`);
      return undefined;
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new CatalogueError(`Row ${row}: ${label} must be a nonnegative number.`);
    return number;
  };
  for (let row = 2; row <= cells.length; row++) {
    const headers = labelled ? catalogueSpreadsheetHeaders : catalogueHeaders;
    const values = headers.map((_, index) => text(row, index + 1));
    if (cells[row - 1].slice(headers.length).some(Boolean)) throw new CatalogueError(`Row ${row}: unexpected extra columns. Keep the template columns unchanged.`);
    if (!values.some(Boolean)) continue;
    const [code, name, category, priceText] = values;
    const status = values[labelled ? 13 : 5];
    if (code.length > 50 || name.length < 2 || name.length > 200 || !category || category.length > 80 || !priceText || !Number.isFinite(Number(priceText)) || Number(priceText) < 0 || !['active', 'inactive'].includes(status.toLowerCase())) throw new CatalogueError(`Row ${row}: enter a service, category, nonnegative price and Active or Inactive status.`);
    if (code && codes.has(code)) throw new CatalogueError(`Row ${row}: duplicate item code ${code}.`);
    if (code) codes.add(code);
    let commission: unknown;
    if (labelled) {
      const poolValue = values[4].toLowerCase();
      const selectedPool = Object.keys(cataloguePoolLabels).find(key => key.toLowerCase() === poolValue || cataloguePoolLabels[key].toLowerCase() === poolValue);
      if (!selectedPool) throw new CatalogueError(`Row ${row}: choose Course pool, Dive pool, Certifications or No pool.`);
      const percentage = ['COURSE_POOL', 'DIVE_POOL'].includes(selectedPool);
      const rate = amount(values[5].replace(/%$/, '').trim(), row, 'a pool rate (%)', percentage);
      const fixed = amount(values[6], row, 'a Certifications amount per unit', selectedPool === 'CERTIFICATION_POOL');
      if ((!percentage && rate !== undefined && rate !== 0) || (selectedPool !== 'CERTIFICATION_POOL' && fixed !== undefined && fixed !== 0)) throw new CatalogueError(`Row ${row}: use Pool Rate (%) for course/dive pools and Certifications Amount / Unit for Certifications. Leave the other amount blank.`);
      const personalRates: Record<string, number> = {};
      for (const [index, role] of ['seller', 'guide', 'instructor', 'photo', 'video'].entries()) {
        const payment = amount(values[7 + index], row, `${role} payment per unit`);
        if (payment !== undefined) personalRates[role] = payment;
      }
      const media = values[12].toLowerCase();
      if (media && !['yes', 'no', 'true', 'false', '1', '0'].includes(media)) throw new CatalogueError(`Row ${row}: Include Photo ($57.50) must be Yes or No, or blank to retain the existing setting.`);
      commission = { poolType: selectedPool, poolContribution: percentage ? rate! : selectedPool === 'CERTIFICATION_POOL' ? fixed! : 0,
        personalRates, ...(media ? { includesComplimentaryMedia: ['yes', 'true', '1'].includes(media) } : {}) };
    } else {
      try {
        const value = values[4] ? JSON.parse(values[4]) : 0;
        commission = typeof value === 'number' ? { poolType: /^certifications?$/i.test(category.trim()) ? 'CERTIFICATION_POOL' : /cour/i.test(category) ? 'COURSE_POOL' : 'DIVE_POOL', poolContribution: value, personalRates: {} } : value;
      } catch { throw new CatalogueError(`Row ${row}: Commission must be a nonnegative pool amount or a commission JSON object.`); }
    }
    const parsed = commissionSchema.safeParse(commission);
    if (!parsed.success || parsed.data.poolType === 'NONE' && parsed.data.poolContribution !== 0) throw new CatalogueError(`Row ${row}: invalid Commission. Use a pool rate from 0–100%, nonnegative amounts and supported pool/role names.`);
    rows.push({ row, code, name, category, price: Number(priceText), isActive: status.toLowerCase() === 'active', commission: parsed.data });
  }
  if (!rows.length) throw new CatalogueError('The file has no items to import.');
  return rows;
};
export const commissionCell = (item: { poolType: string; poolContribution: number; personalRatesJson: string | null; includesComplimentaryMedia?: boolean }) => {
  let personalRates = {};
  try { personalRates = JSON.parse(item.personalRatesJson || '{}'); } catch { /* Preserve usable pool settings for old catalogue entries. */ }
  return JSON.stringify({ poolType: item.poolType, poolContribution: item.poolContribution, personalRates, ...(item.includesComplimentaryMedia !== undefined ? { includesComplimentaryMedia: item.includesComplimentaryMedia } : {}) });
};
export function catalogueSpreadsheetRow(item: { code: string; name: string; category: { name: string }; price: number; poolType: string; poolContribution: number; personalRatesJson: string | null; includesComplimentaryMedia?: boolean; isActive: boolean }): (string | number | null)[] {
  let rates: Record<string, unknown> = {};
  try { const value = JSON.parse(item.personalRatesJson || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) rates = value; } catch { /* Invalid legacy rates export as blank cells. */ }
  const percentage = ['COURSE_POOL', 'DIVE_POOL'].includes(item.poolType);
  return [item.code, item.name, item.category.name, item.price, cataloguePoolLabels[item.poolType] || 'No pool',
    percentage ? item.poolContribution : null, item.poolType === 'CERTIFICATION_POOL' ? item.poolContribution : null,
    ...['seller', 'guide', 'instructor', 'photo', 'video'].map(role => typeof rates[role] === 'number' && Number.isFinite(rates[role]) && Number(rates[role]) >= 0 ? rates[role] as number : null),
    item.includesComplimentaryMedia ? 'Yes' : 'No', item.isActive ? 'Active' : 'Inactive'];
}
export const safeSpreadsheetText = (value: string) => /^'*[\s\x00-\x1f]*[=+\-@]/.test(value) ? `'${value}` : value;
