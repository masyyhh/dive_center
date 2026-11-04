import ExcelJS from 'exceljs';

/** Common metadata for both existing Excel export formats. */
export function createReportWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Dive Centre Manager';
  workbook.created = new Date();
  return workbook;
}

/** Existing plain or colored headers, with no changes to workbook layout. */
export function styleReportHeader(sheet: ExcelJS.Worksheet, color?: string) {
  sheet.getRow(1).font = color
    ? { bold: true, color: { argb: 'FFFFFFFF' } }
    : { bold: true };
  if (color) {
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: color },
    };
  }
}
