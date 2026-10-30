// Untrusted CSV/XLSX parsing stays outside the API thread and its V8 heap.
const { parentPort, workerData } = require('node:worker_threads');
const { Readable } = require('node:stream');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');

const MAX_COLUMNS = 14;
const MAX_ENTRIES = 64;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;

async function boundedWorkbook(bytes) {
  const archive = await JSZip.loadAsync(bytes);
  const entries = Object.values(archive.files);
  if (entries.length > MAX_ENTRIES) throw Error('Workbook contains too many archive entries.');
  let total = 0;
  const checked = new JSZip();
  for (const entry of entries) {
    if (entry.dir) continue;
    // Count actual emitted bytes, not attacker-controlled ZIP size fields.
    const content = await new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      const stream = entry.internalStream('nodebuffer');
      stream.on('data', chunk => {
        size += chunk.length;
        total += chunk.length;
        if (size > MAX_ENTRY_BYTES || total > MAX_EXPANDED_BYTES) {
          stream.pause();
          reject(Error('Workbook exceeds the expanded data limit.'));
          return;
        }
        chunks.push(chunk);
      }).on('error', reject).on('end', () => resolve(Buffer.concat(chunks, size))).resume();
    });
    checked.file(entry.name, content, { binary: true });
  }
  // ExcelJS consumes this bounded, normalized archive, never the unchecked input.
  return checked.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

async function parse() {
  const bytes = Buffer.from(workerData.bytes);
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) throw Error('Choose a CSV or Excel file up to 3 MB.');
  const workbook = new ExcelJS.Workbook();
  if (workerData.format === 'csv') {
    await workbook.csv.read(Readable.from(bytes), { map: value => value });
  } else if (workerData.format === 'xlsx') {
    await workbook.xlsx.load(await boundedWorkbook(bytes), {
      maxRows: 2001,
      maxCols: MAX_COLUMNS,
      // These presentation ranges can expand tiny XML into enormous cell arrays.
      ignoreNodes: ['mergeCells', 'cols'],
    });
  } else throw Error('Choose a CSV or Excel workbook.');
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount > 2001) throw Error('Import up to 2,000 items at a time.');
  if (sheet.columnCount > MAX_COLUMNS) throw Error('Use only the columns in the downloaded catalogue template.');
  const rows = [];
  let textBytes = 0;
  for (let row = 1; row <= sheet.rowCount; row++) {
    rows.push(Array.from({ length: MAX_COLUMNS }, (_, index) => {
      const cell = sheet.getRow(row).getCell(index + 1);
      if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Error) throw Error(`Row ${row}: use values rather than formulas or errors.`);
      const value = cell.text;
      const size = Buffer.byteLength(value, 'utf8');
      textBytes += size;
      // Shared-string references can multiply small XML into a huge IPC payload.
      // Bound data before structured cloning into the API thread's heap.
      if (size > 4096 || textBytes > 2 * 1024 * 1024) throw Error('Catalogue cell text exceeds the data limit.');
      return value.trim();
    }));
  }
  return rows;
}

parse().then(rows => parentPort.postMessage({ rows })).catch(error => {
  parentPort.postMessage({ error: error.message || 'The file could not be read.' });
});
