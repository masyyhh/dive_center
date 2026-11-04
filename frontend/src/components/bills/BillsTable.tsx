import { TableScroll } from '../TableScroll';
import { formatMoney } from '../../utils/format';
import { displayDate } from '../../utils/dates';

import { Receipt } from 'lucide-react';
import type { BillsModel } from './useBillsController';

export function BillsTable({ model }: { model: BillsModel }) {
  const {
    currencySymbol, loading, openBillDetails, resetFilters,
    visibleBills,
  } = model;
  return (
    <>
      {/* Bills Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm text-slate-400">Loading bills...</div>
        ) : visibleBills.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
            <Receipt className="mx-auto mb-4 text-sky-600" size={30} /><strong className="block text-base mb-2 text-slate-800 dark:text-slate-200">No bills match your filters</strong><p>Try another guest, room, check number, or date range.</p><button className="text-button mt-4" onClick={resetFilters}>Reset filters</button>
          </div>
        ) : (
          <TableScroll label="Bills" className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm bills-data-table">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4">Check #</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Room</th>
                  <th className="py-3 px-4">Guest Name</th>
                  <th className="py-3 px-4">Revenue</th>
                  <th className="py-3 px-4">Discounts</th>
                  <th className="py-3 px-4 font-semibold text-slate-900 dark:text-white text-right">Net Total</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleBills.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => openBillDetails(b.id)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition cursor-pointer"
                  >
                    <td className="py-3 px-4 font-mono font-bold text-sky-600 dark:text-sky-400">
                      <button className="text-button" aria-label={`View bill ${b.checkNumber}`} onClick={event => { event.stopPropagation(); openBillDetails(b.id); }}>#{b.checkNumber}</button>
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-600 dark:text-slate-300">
                      {displayDate(b.businessDate)}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200">
                      Room {b.roomNumber}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900 dark:text-white">
                      {b.guestName}
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-white">
                      {formatMoney(b.grossAmount - b.discountAmount, currencySymbol)}
                    </td>
                    <td className="py-3 px-4 font-mono">{formatMoney(b.discountAmount, currencySymbol)}</td>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-white">
                      {formatMoney(b.netAmount, currencySymbol)}
                    </td>
                    <td className="py-3 px-4">
                      {b.status === 'ACTIVE' ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          Active
                        </span>
                      ) : b.status === 'REBATED' ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          Rebated
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                          Deleted
                        </span>
                      )}
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </div>

    </>
  );
}
