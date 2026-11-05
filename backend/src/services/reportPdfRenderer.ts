import PDFDocument from 'pdfkit';
import path from 'node:path';

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

/** A print layout with repeated headers, readable column widths and no clipped rows. */
export function renderReportPdf(title: string, subtitle: string, tables: ReportTable[]): Promise<Buffer> {
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
    const pageWidth = 841.89;
    const available = pageWidth - 64;
    let page = 0;
    let y = 100;
    const bottom = 550;
    const lineHeight = 12;
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
          // Every element is positioned explicitly; leave the footer inside the page
          // without PDFKit's flow engine inserting an extra page at the margin.
          doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 }); page++;
          doc.font('ReportBold').fontSize(16).fillColor('#172b3a').text(title, 32, 25, { width: available, lineBreak: false });
          doc.font('Report').fontSize(9).fillColor('#536575').text(subtitle, 32, 49, { width: available, lineBreak: false });
          doc.font('ReportBold').fontSize(12).fillColor('#172b3a').text(table.title + (groups.length > 1 ? ` - columns ${band + 1}/${groups.length}` : ''), 32, 73, { width: available, lineBreak: false });
          doc.font('Report').fontSize(7.5).fillColor('#536575').text(`Dive Centre Manager | ${table.title} | Page ${page}`, 32, 571, { width: available, lineBreak: false });
          y = 98;
          doc.rect(32, y, totalWidth, headerHeight).fill('#e9eff3');
          let x = 32;
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
            if (rowIndex % 2 === 1) doc.rect(32, y, totalWidth, height).fill('#f5f8fa');
            let x = 32;
            doc.font('Report').fontSize(8.5).fillColor('#243744');
            cells.forEach((lines, i) => {
              lines.slice(offset, offset + count).forEach((line, j) => doc.text(line, x + 7, y + padding / 2 + j * lineHeight, {
                width: colWidths[i] - 14, lineBreak: false, align: table.columns[indices[i]].numeric ? 'right' : 'left',
              }));
              x += colWidths[i];
            });
            y += height;
            doc.moveTo(32, y).lineTo(32 + totalWidth, y).lineWidth(.3).strokeColor('#dce4e9').stroke();
            offset += count;
            if (offset < maxLines) startPage();
          }
        });
        if (table.note) {
          doc.font('Report').fontSize(8);
          for (const line of wrap(table.note, totalWidth)) {
            if (y + 20 > bottom) startPage();
            doc.font('Report').fontSize(8).fillColor('#536575').text(line, 32, y + 8, { lineBreak: false });
            y += 13;
          }
        }
      }
    }
    doc.end();
  } catch (error) {
    doc.emit('error', error instanceof Error ? error : new Error(String(error)));
    doc.end();
  }
  return result;
}
