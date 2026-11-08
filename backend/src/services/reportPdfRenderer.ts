import PDFDocument from 'pdfkit';
import path from 'node:path';
import { businessToday } from '../utils/dates';
import { electronicDocumentNotice } from '../utils/documentNotice';

export type ReportCell = string | number;
export interface ReportTable {
  title: string;
  columns: { label: string; width?: number; minWidth?: number; numeric?: boolean; align?: 'left' | 'center' | 'right' }[];
  rows: ReportCell[][];
  /** Repeat these identity columns when a wide table is split horizontally. */
  repeatColumns?: number;
  note?: string;
  compact?: boolean;
  emphasizeRows?: number[];
  /** Compact records flow vertically, without dividing their columns into panels. */
  singleTable?: boolean;
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
    let page = 0;
    let y = 100;
    const bottom = branded ? 710 : 532;
    const lineHeight = 13;
    const startReportPage = (section: string, panel?: string) => {
      // Keep every element positioned explicitly, including the supplied footer.
      doc.addPage({ size: 'A4', layout: branded ? 'portrait' : 'landscape', margin: 0 }); page++;
      if (branded) doc.image(path.resolve(__dirname, '../../assets/letterheads/iru-fushi.jpg'), 0, 0, { width: 595.28, height: 841.89 });
      const titleY = branded ? 108 : 28;
      const titleLineHeight = branded ? 19 : 22;
      doc.font('ReportBold').fontSize(branded ? 14 : 17).fillColor('#193b47');
      const titleLines = wrap(title, available);
      titleLines.forEach((line, index) => doc.text(line, left, titleY + index * titleLineHeight, { width: available, lineBreak: false }));
      const subtitleY = titleY + titleLines.length * titleLineHeight + 5;
      doc.font('Report').fontSize(8.5).fillColor('#607480').text(subtitle, left, subtitleY, { width: available, lineBreak: false });
      const sectionY = subtitleY + 24;
      doc.font('ReportBold').fontSize(12).fillColor('#193b47').text(section, left, sectionY, { width: available - (panel ? 110 : 0), lineBreak: false });
      if (panel) doc.font('Report').fontSize(8).fillColor('#607480').text(panel, left + available - 110, sectionY + 3, { width: 110, align: 'right', lineBreak: false });
      y = sectionY + 26;
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
      const padding = table.compact ? 5 : 12;
      const repeat = table.repeatColumns ?? 1;
      const widths = table.columns.map(column => Math.max(48, column.width ?? 78));
      doc.font('ReportBold').fontSize(9);
      const minimums = table.columns.map((column, index) => {
        const minimum = column.minWidth ?? Math.max(48, widths[index] * .75);
        // Keep formatted amounts together instead of breaking a number across lines.
        const amountWidth = column.numeric ? Math.min(180, table.rows.reduce((maximum, row) => Math.max(maximum, doc.widthOfString(String(row[index] ?? ''))), 0) + 16) : 0;
        return Math.max(minimum, amountWidth);
      });
      const identity = Array.from({ length: Math.min(repeat, widths.length) }, (_, i) => i);
      const groups: number[][] = [];
      let group = [...identity];
      let used = identity.reduce((sum, index) => sum + minimums[index], 0);
      for (let index = identity.length; !table.singleTable && index < widths.length; index++) {
        if (used + minimums[index] > available && group.length > identity.length) {
          groups.push(group); group = [...identity]; used = identity.reduce((sum, id) => sum + minimums[id], 0);
        }
        group.push(index); used += minimums[index];
      }
      groups.push(table.singleTable ? widths.map((_, index) => index) : group);
      // Avoid a final panel containing just one amount when adjacent panels can share the space.
      if (groups.length > 1) {
        const previous = groups[groups.length - 2];
        const last = groups[groups.length - 1];
        while (previous.length - last.length > 1) {
          const candidate = previous[previous.length - 1];
          if (last.reduce((total, index) => total + minimums[index], 0) + minimums[candidate] > available) break;
          previous.pop(); last.splice(identity.length, 0, candidate);
        }
      }
      for (let band = 0; band < groups.length; band++) {
        const indices = groups[band];
        const naturalWidth = indices.reduce((sum, index) => sum + Math.max(widths[index], minimums[index]), 0);
        const minimumWidth = indices.reduce((sum, index) => sum + minimums[index], 0);
        const flex = naturalWidth - minimumWidth;
        const colWidths = indices.map(index => available >= naturalWidth
          ? Math.max(widths[index], minimums[index]) * available / naturalWidth
          : minimumWidth >= available ? minimums[index] * available / minimumWidth
          : minimums[index] + (Math.max(widths[index], minimums[index]) - minimums[index]) * (available - minimumWidth) / flex);
        const totalWidth = colWidths.reduce((sum, value) => sum + value, 0);
        doc.font('ReportBold').fontSize(9);
        const headers = indices.map((index, i) => wrap(table.columns[index].label, colWidths[i] - 16));
        const headerHeight = Math.max(...headers.map(lines => lines.length)) * lineHeight + 16;
        const startPage = () => {
          startReportPage(table.title, groups.length > 1 ? `Panel ${band + 1} of ${groups.length}` : undefined);
          doc.rect(left, y, totalWidth, headerHeight).fill('#224b59');
          let x = left;
          doc.font('ReportBold').fontSize(9).fillColor('#ffffff');
          headers.forEach((lines, i) => {
            const inset = (headerHeight - lines.length * lineHeight) / 2;
            lines.forEach((line, j) => doc.text(line, x + 8, y + inset + j * lineHeight, { width: colWidths[i] - 16, align: table.columns[indices[i]].align ?? (table.columns[indices[i]].numeric ? 'right' : table.compact && indices[i] > 0 ? 'center' : 'left'), lineBreak: false }));
            x += colWidths[i];
          });
          y += headerHeight;
        };
        startPage();
        const bodyCapacity = bottom - y;
        const rows = table.rows.length ? table.rows : [['No records for this period.']];
        rows.forEach((row, rowIndex) => {
          const label = String(row[0] ?? '');
          const total = /^TOTAL$/i.test(label) || Boolean(table.emphasizeRows?.includes(rowIndex));
          const subtotal = / subtotal$/i.test(label);
          const font = total || subtotal ? 'ReportBold' : 'Report';
          doc.font(font).fontSize(9);
          const cells = indices.map((index, i) => wrap(String(row[index] ?? ''), colWidths[i] - 16));
          const maxLines = Math.max(...cells.map(lines => lines.length));
          const next = rows[rowIndex + 1];
          if (rowIndex === rows.length - 2 && next && (/^TOTAL(?:\n|$)/i.test(String(next[0])) || table.emphasizeRows?.includes(rowIndex + 1))) {
            doc.font('ReportBold').fontSize(9);
            const nextLines = Math.max(...indices.map((index, i) => wrap(String(next[index] ?? ''), colWidths[i] - 16).length));
            const pairHeight = (maxLines + nextLines) * lineHeight + padding * 2;
            if (pairHeight <= bodyCapacity && y + pairHeight > bottom) startPage();
          }
          if (maxLines * lineHeight + padding <= bodyCapacity && y + maxLines * lineHeight + padding > bottom) startPage();
          let offset = 0;
          while (offset < maxLines) {
            if (y + padding + lineHeight > bottom) startPage();
            const count = Math.min(maxLines - offset, Math.floor((bottom - y - padding) / lineHeight));
            const height = count * lineHeight + padding;
            if (total || subtotal || rowIndex % 2 === 1) doc.rect(left, y, totalWidth, height).fill(total ? '#e8f0f3' : subtotal ? '#eef3f5' : '#f7f9fa');
            if (total && offset === 0) doc.moveTo(left, y).lineTo(left + totalWidth, y).lineWidth(.7).strokeColor('#9eb3bc').stroke();
            let x = left;
            doc.font(font).fontSize(9).fillColor('#243d49');
            cells.forEach((lines, i) => {
              const visible = lines.slice(offset, offset + count);
              const inset = (height - visible.length * lineHeight) / 2;
              visible.forEach((line, j) => doc.text(line, x + 8, y + inset + j * lineHeight, {
                width: colWidths[i] - 16, lineBreak: false, align: table.columns[indices[i]].align ?? (table.columns[indices[i]].numeric ? 'right' : table.compact && indices[i] > 0 ? 'center' : 'left'),
              }));
              x += colWidths[i];
            });
            y += height;
            doc.moveTo(left, y).lineTo(left + totalWidth, y).lineWidth(.3).strokeColor('#dce4e9').stroke();
            offset += count;
            if (offset < maxLines) startPage();
          }
        });
        if (table.note && band === groups.length - 1) {
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
      const preparedDateOffset = Math.max(68, 34 + preparedName.length * lineHeight + 12);
      const signOffHeight = 28 + preparedDateOffset + lineHeight + 8;
      if (!page || y + signOffHeight > bottom) startReportPage('Report sign-off');
      const top = y + 28;
      ['PREPARED BY', 'RECEIVED BY'].forEach((label, index) => {
        const x = left + index * (width + 48);
        doc.font('ReportBold').fontSize(10).fillColor('#172b3a').text(label, x, top, { width, lineBreak: false });
        if (index === 0) {
          doc.font('Report').fontSize(8.5).fillColor('#536575').text('Name:', x, top + 34, { lineBreak: false });
          preparedName.forEach((line, i) => doc.text(line, x + 48, top + 34 + i * lineHeight, { width: width - 48, lineBreak: false }));
          const dateY = top + preparedDateOffset;
          doc.text('Date:', x, dateY, { lineBreak: false });
          doc.text(options.preparedBy?.date ?? businessToday(), x + 48, dateY, { width: width - 48, lineBreak: false });
          return;
        }
        for (const [field, offset] of [['Name', 34], ['Date', preparedDateOffset]] as const) {
          doc.font('Report').fontSize(8.5).fillColor('#536575').text(`${field}:`, x, top + offset, { lineBreak: false });
          doc.moveTo(x + 48, top + offset + 12).lineTo(x + width, top + offset + 12).lineWidth(.5).strokeColor('#8393a0').stroke();
        }
      });
    }
    if (!page) startReportPage('Report');
    doc.font('Report').fontSize(8).fillColor('#536575');
    wrap(electronicDocumentNotice, available).forEach((line, index) => {
      doc.text(line, left, (branded ? 720 : 542) + index * 10, { width: available, align: 'center', lineBreak: false });
    });
    doc.end();
  } catch (error) {
    doc.emit('error', error instanceof Error ? error : new Error(String(error)));
    doc.end();
  }
  return result;
}
