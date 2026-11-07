import PDFDocument from 'pdfkit';
import path from 'node:path';
import { businessToday } from '../utils/dates';

export type ReportCell = string | number;
export interface ReportTable {
  title: string;
  columns: { label: string; width?: number; numeric?: boolean }[];
  rows: ReportCell[][];
  /** Repeat these identity columns when a wide table is split horizontally. */
  repeatColumns?: number;
  note?: string;
  compact?: boolean;
}

export interface ReportPdfOptions {
  signOff?: boolean;
  letterhead?: 'iru-fushi';
  preparedBy?: { name: string; date: string };
}

/** A print layout with repeated headers, readable column widths and no clipped rows. */
export function renderReportPdf(title: string, subtitle: string, tables: ReportTable[], options: ReportPdfOptions = {}): Promise<Buffer> {
  const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', layout: 'landscape', margin: 32,
    info: { Title: title, Subject: subtitle, Author: 'Dive Centre Manager' } });
  doc.registerFont('Report', path.resolve(__dirname, '../../assets/fonts/DejaVuSans.ttf'));
  doc.registerFont('ReportBold', path.resolve(__dirname, '../../assets/fonts/DejaVuSans-Bold.ttf'));
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
  try {
    const branded = options.letterhead === 'iru-fushi';
    const pageWidth = branded ? 595.28 : 841.89;
    const left = branded ? 43.2 : 32;
    const available = pageWidth - left * 2;
    const tableTop = branded ? 180 : 98;
    let page = 0;
    let y = 100;
    const bottom = branded ? 730 : 550;
    const lineHeight = 12;
    const startReportPage = (section: string) => {
      // Keep every element positioned explicitly, including the supplied footer.
      doc.addPage({ size: 'A4', layout: branded ? 'portrait' : 'landscape', margin: 0 }); page++;
      if (branded) doc.image(path.resolve(__dirname, '../../assets/letterheads/iru-fushi.jpg'), 0, 0, { width: 595.28, height: 841.89 });
      doc.font('ReportBold').fontSize(branded ? 13 : 16).fillColor('#172b3a').text(title, left, branded ? 110 : 25, { width: available, lineBreak: false });
      doc.font('Report').fontSize(9).fillColor('#536575').text(subtitle, left, branded ? 134 : 49, { width: available, lineBreak: false });
      doc.font('ReportBold').fontSize(12).fillColor('#172b3a').text(section, left, branded ? 154 : 73, { width: available, lineBreak: false });
      doc.font('Report').fontSize(7.5).fillColor('#536575').text(`Dive Centre Manager | ${section} | Page ${page}`, left, branded ? 747 : 571, { width: available, lineBreak: false });
      y = tableTop;
    };
    // Wrap using the actual embedded font metrics, including long unbroken values.
    const wrap = (text: string, width: number): string[] => {
      const lines: string[] = [];
      for (const paragraph of text.replace(/\r/g, '').split('\n')) {
        let line = '';
        for (const word of paragraph.split(/(\s+)/)) {
          if (doc.widthOfString(line + word) <= width) { line += word; continue; }
          if (line.trim()) lines.push(line.trimEnd());
          line = word.trimStart();
          if (doc.widthOfString(line) > width) {
            let part = '';
            for (const char of line) {
              if (part && doc.widthOfString(part + char) > width) { lines.push(part); part = ''; }
              part += char;
            }
            line = part;
          }
        }
        lines.push(line.trimEnd());
      }
      return lines.length ? lines : [''];
    };
    for (const table of tables) {
      const padding = table.compact ? 6 : 14;
      const repeat = table.repeatColumns ?? 1;
      const widths = table.columns.map(column => Math.max(48, column.width ?? 78));
      const identity = Array.from({ length: Math.min(repeat, widths.length) }, (_, i) => i);
      const groups: number[][] = [];
      let group = [...identity];
      let used = identity.reduce((sum, index) => sum + widths[index], 0);
      for (let index = identity.length; index < widths.length; index++) {
        if (used + widths[index] > available && group.length > identity.length) {
          groups.push(group); group = [...identity]; used = identity.reduce((sum, id) => sum + widths[id], 0);
        }
        group.push(index); used += widths[index];
      }
      groups.push(group);
      for (let band = 0; band < groups.length; band++) {
        const indices = groups[band];
        const naturalWidth = indices.reduce((sum, index) => sum + widths[index], 0);
        const colWidths = indices.map(index => widths[index] * Math.min(1.35, available / naturalWidth));
        const totalWidth = colWidths.reduce((sum, value) => sum + value, 0);
        doc.font('ReportBold').fontSize(8.5);
        const headers = indices.map((index, i) => wrap(table.columns[index].label, colWidths[i] - 14));
        const headerHeight = Math.max(...headers.map(lines => lines.length)) * lineHeight + 14;
        const startPage = () => {
          startReportPage(table.title + (groups.length > 1 ? ` - columns ${band + 1}/${groups.length}` : ''));
          doc.rect(left, y, totalWidth, headerHeight).fill('#e9eff3');
          let x = left;
          doc.font('ReportBold').fontSize(8.5).fillColor('#172b3a');
          headers.forEach((lines, i) => {
            lines.forEach((line, j) => doc.text(line, x + 7, y + 7 + j * lineHeight, { width: colWidths[i] - 14, lineBreak: false }));
            x += colWidths[i];
          });
          y += headerHeight;
        };
        startPage();
        const rows = table.rows.length ? table.rows : [['No records for this period.']];
        rows.forEach((row, rowIndex) => {
          doc.font('Report').fontSize(8.5);
          const cells = indices.map((index, i) => wrap(String(row[index] ?? ''), colWidths[i] - 14));
          const maxLines = Math.max(...cells.map(lines => lines.length));
          let offset = 0;
          while (offset < maxLines) {
            if (y + padding + lineHeight > bottom) startPage();
            const count = Math.min(maxLines - offset, Math.floor((bottom - y - padding) / lineHeight));
            const height = count * lineHeight + padding;
            if (rowIndex % 2 === 1) doc.rect(left, y, totalWidth, height).fill('#f5f8fa');
            let x = left;
            doc.font('Report').fontSize(8.5).fillColor('#243744');
            cells.forEach((lines, i) => {
              lines.slice(offset, offset + count).forEach((line, j) => doc.text(line, x + 7, y + padding / 2 + j * lineHeight, {
                width: colWidths[i] - 14, lineBreak: false, align: table.columns[indices[i]].numeric ? 'right' : 'left',
              }));
              x += colWidths[i];
            });
            y += height;
            doc.moveTo(left, y).lineTo(left + totalWidth, y).lineWidth(.3).strokeColor('#dce4e9').stroke();
            offset += count;
            if (offset < maxLines) startPage();
          }
        });
        if (table.note) {
          doc.font('Report').fontSize(8);
          for (const line of wrap(table.note, totalWidth)) {
            if (y + 20 > bottom) startPage();
            doc.font('Report').fontSize(8).fillColor('#536575').text(line, left, y + 8, { lineBreak: false });
            y += 13;
          }
        }
      }
    }
    if (options.signOff) {
      const width = (available - 48) / 2;
      doc.font('Report').fontSize(8.5);
      const preparedName = wrap(options.preparedBy?.name ?? 'System generated', width - 48);
      const preparedDateOffset = Math.max(82, 42 + preparedName.length * lineHeight + 12);
      const signOffHeight = 30 + Math.max(134, preparedDateOffset + lineHeight);
      if (!page || y + signOffHeight > bottom) startReportPage('Report sign-off');
      const top = y + 30;
      ['PREPARED BY', 'RECEIVED BY'].forEach((label, index) => {
        const x = left + index * (width + 48);
        doc.font('ReportBold').fontSize(10).fillColor('#172b3a').text(label, x, top, { width, lineBreak: false });
        if (index === 0) {
          doc.font('Report').fontSize(8.5).fillColor('#536575').text('Name:', x, top + 42, { lineBreak: false });
          preparedName.forEach((line, i) => doc.text(line, x + 48, top + 42 + i * lineHeight, { width: width - 48, lineBreak: false }));
          const dateY = top + preparedDateOffset;
          doc.text('Date:', x, dateY, { lineBreak: false });
          doc.text(options.preparedBy?.date ?? businessToday(), x + 48, dateY, { width: width - 48, lineBreak: false });
          return;
        }
        for (const [field, offset] of [['Name', 42], ['Signature', 82], ['Date', 122]] as const) {
          doc.font('Report').fontSize(8.5).fillColor('#536575').text(`${field}:`, x, top + offset, { lineBreak: false });
          doc.moveTo(x + 48, top + offset + 12).lineTo(x + width, top + offset + 12).lineWidth(.5).strokeColor('#8393a0').stroke();
        }
      });
    }
    doc.end();
  } catch (error) {
    doc.emit('error', error instanceof Error ? error : new Error(String(error)));
    doc.end();
  }
  return result;
}
