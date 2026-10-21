/** Quoting prevents delimiter injection; prefixing also keeps spreadsheet formulas inert. */
export const csvCell = (value: unknown): string => {
  let text = value == null ? '' : String(value);
  if (typeof value !== 'number' && (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
export const serializeCsv = (rows: unknown[][]): string => rows.map(row => row.map(csvCell).join(',')).join('\r\n');
