"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addUnallocatedCommissionSheet = addUnallocatedCommissionSheet;
const commissionMoney_1 = require("../utils/commissionMoney");
/** A separate balance: undistributed pools must never inflate staff payroll. */
function addUnallocatedCommissionSheet(workbook, rows, currency) {
    if (!rows?.length)
        return;
    const sheet = workbook.addWorksheet('Unallocated commissions');
    sheet.columns = [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Source', key: 'source', width: 40 },
        { header: 'Category', key: 'kind', width: 20 },
        { header: 'Reason', key: 'reason', width: 30 },
        { header: `Amount (${currency})`, key: 'amount', width: 22 },
    ];
    for (const row of rows)
        sheet.addRow([row.businessDate, row.sourceId, row.kind, row.reason, row.amountCents / 100]);
    sheet.addRow(['TOTAL', '', '', '', (0, commissionMoney_1.addCents)(...rows.map((row) => row.amountCents)) / 100]).font = { bold: true };
    sheet.getColumn(5).numFmt = '#,##0.00';
    sheet.getRow(1).font = { bold: true };
}
