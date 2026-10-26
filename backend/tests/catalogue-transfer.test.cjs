const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { loadTypeScript } = require('./helpers/runtime.cjs');
const { parseCatalogue, catalogueHeaders } = loadTypeScript('src/services/catalogueTransfer.ts');
const row = ['', 'Boat dive', 'Diving', 75, 10, 'Active'];
async function workbook(count = 1, format = 'xlsx') {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Catalogue');
  sheet.addRow(catalogueHeaders);
  for (let i = 0; i < count; i++) sheet.addRow(row);
  return Buffer.from(await (format === 'csv' ? book.csv.writeBuffer() : book.xlsx.writeBuffer()));
}
const parse = (bytes, format = 'xlsx') => parseCatalogue(bytes.toString('base64'), format);

test('CSV/XLSX values round-trip and 2,000 catalogue items remain supported', async () => {
  for (const format of ['csv', 'xlsx']) {
    const rows = await parse(await workbook(2000, format), format);
    assert.equal(rows.length, 2000);
    assert.equal(rows[0].name, 'Boat dive');
    assert.equal(rows[1999].price, 75);
    assert.equal(rows[0].commission.poolContribution, 10);
    await assert.rejects(parse(await workbook(2001, format), format));
  }
});

test('unused ZIP entries cannot bypass actual expanded-byte or entry-count limits', async () => {
  const original = await workbook();
  const oversized = await JSZip.loadAsync(original);
  oversized.file('unused.txt', Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  const bytes = await oversized.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  assert(bytes.length < 3 * 1024 * 1024);
  await assert.rejects(parse(bytes), /expanded data limit/);
  const aggregate = await JSZip.loadAsync(original);
  for (let i = 0; i < 5; i++) aggregate.file(`unused-${i}.txt`, Buffer.alloc(2 * 1024 * 1024, 65));
  await assert.rejects(parse(await aggregate.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })), /expanded data limit/);
  const many = await JSZip.loadAsync(original);
  for (let i = 0; i < 65; i++) many.file(`empty-${i}.txt`, '');
  await assert.rejects(parse(await many.generateAsync({ type: 'nodebuffer' })), /too many archive entries/);
  assert.equal((await parse(original)).length, 1);
});

test('false ZIP size metadata and malformed archives fail without poisoning later imports', async () => {
  const archive = await JSZip.loadAsync(await workbook());
  archive.file('unused.txt', Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  const bytes = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  for (let i = 0; i < bytes.length - 46; i++) {
    if (bytes.readUInt32LE(i) === 0x02014b50 && bytes.subarray(i + 46, i + 56).toString() === 'unused.txt') bytes.writeUInt32LE(1, i + 24);
  }
  await assert.rejects(parse(bytes), /expanded data limit/);
  await assert.rejects(parse(Buffer.from('not a zip')));
  assert.equal((await parse(await workbook())).length, 1);
});

test('presentation ranges cannot expand worksheet cells; formulas and extra columns reject', async () => {
  const archive = await JSZip.loadAsync(await workbook());
  const sheetPath = 'xl/worksheets/sheet1.xml';
  let xml = await archive.file(sheetPath).async('string');
  xml = xml.replace('</sheetData>', '</sheetData><mergeCells count="1"><mergeCell ref="A1:XFD1048576"/></mergeCells>');
  xml = xml.replace('<sheetData>', '<cols><col min="1" max="16384" width="10"/></cols><sheetData>');
  archive.file(sheetPath, xml);
  assert.equal((await parse(await archive.generateAsync({ type: 'nodebuffer' }))).length, 1);
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Catalogue');
  sheet.addRow(catalogueHeaders); sheet.addRow(row);
  sheet.getCell('D2').value = { formula: '1+1', result: 2 };
  await assert.rejects(parse(Buffer.from(await book.xlsx.writeBuffer())), /rather than formulas/);
  sheet.getCell('D2').value = 75; sheet.getCell('G2').value = 'extra';
  await assert.rejects(parse(Buffer.from(await book.xlsx.writeBuffer())));
});

test('only one parser runs at once and quoted CSV values retain their meaning', async () => {
  const bytes = await workbook();
  const first = parse(bytes);
  await assert.rejects(parse(bytes), /Another catalogue/);
  await first;
  const csv = 'Item Code,Items,Category,Price,Commission,Status\r\n,"Boat, dive\nsecond line",Diving,75,10,Active\r\n';
  assert.equal((await parse(Buffer.from(csv), 'csv'))[0].name, 'Boat, dive\nsecond line');
});

test('shared strings cannot amplify the message copied into the API heap', async () => {
  for (const [count, length] of [[1, 4097], [2000, 2048]]) {
    const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Catalogue');
    sheet.addRow(catalogueHeaders);
    for (let i = 0; i < count; i++) sheet.addRow(['', 'A'.repeat(length), 'Diving', 75, 10, 'Active']);
    // Repeated cells refer to one shared string, so the archive stays small.
    const bytes = Buffer.from(await book.xlsx.writeBuffer({ useSharedStrings: true }));
    assert(bytes.length < 3 * 1024 * 1024);
    await assert.rejects(parse(bytes), /cell text exceeds/);
  }
  assert.equal((await parse(await workbook())).length, 1);
});
