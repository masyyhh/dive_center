/** Quote CSV values and prevent text cells being interpreted as spreadsheet formulas. */
export function csvCell(value: string | number | null) {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
