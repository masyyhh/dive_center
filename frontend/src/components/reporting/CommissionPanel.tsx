import { TableScroll } from '../TableScroll';

import { Download, RefreshCw, Users } from 'lucide-react';
import { formatMoney } from '../../utils/format';
import type { ReportPanelProps } from './types';

interface CommissionPanelProps extends ReportPanelProps {
  loading: boolean;
  recomputing: boolean;
  handleRecompute: () => void;
  setBreakdownStaffId: (staffId: string) => void;
}
export function CommissionPanel({ report, currencySymbol, downloadChartCsv, loading, recomputing, handleRecompute, setBreakdownStaffId }: CommissionPanelProps) {
  return (
<section id="panel-commissions" role="tabpanel" aria-labelledby="tab-commissions" className="space-y-6"><div className="section-toolbar">
            {/* Recompute Commission Button (PDF Page 6) */}
            <button
              onClick={handleRecompute}
              disabled={loading || !report || recomputing || report?.period.isLocked}
              title={report?.period.isLocked ? 'Recompute disabled while month is locked for payroll' : 'Forces recalculation of commission'}
              className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm font-bold text-slate-700 dark:text-slate-200 transition flex items-center space-x-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${recomputing ? 'animate-spin' : ''}`} />
              <span>Recompute Commission</span>
            </button>

</div>
      {(report?.headline.storeAttendantPoolTotal ?? 0) > 0 && <div className="notice notice-info" role="status"><span>Store attendant Retail pool: {formatMoney(report!.headline.storeAttendantPoolTotal!, currencySymbol)}. Eligible Store attendants share 5% after discounts; payments are included under Personal and listed in employee payment details.{(report?.headline.unallocatedStoreAttendantPoolTotal ?? 0) > 0 && ` Unallocated (no eligible Store attendants): ${formatMoney(report!.headline.unallocatedStoreAttendantPoolTotal!, currencySymbol)}.`}</span></div>}
      {/* Staff Commission Table (PDF Page 6 & 7: Course, Dive, Override, Tips, Personal) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden space-y-4 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <Users className="w-5 h-5 text-teal-500" />
              <span>Staff Commission Breakdown</span>
            </h3>

          </div>

          <button
            onClick={() =>
              downloadChartCsv(
                'Staff_Commission',
                ['Staff Name', 'Role', 'Course Pool', 'Dive Pool', 'Override', 'Tips', 'Personal', 'Total'],
                (report?.staffCommissions || []).map((s) => [
                  s.staffName,
                  s.roleTitle,
                  s.courseCommission,
                  s.diveCommission,
                  s.overrideCommission,
                  s.tipsCommission,
                  s.personalCommission,
                  s.totalCommission,
                ])
              )
            }
            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-sm font-semibold text-slate-700 dark:text-slate-200 transition flex items-center space-x-1"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Table CSV</span>
          </button>
        </div>

        <TableScroll paginate label="Staff commissions" className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm staff-commission-table">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Course Pool</th>
                <th className="py-3 px-4">Dive Pool</th>
                <th className="py-3 px-4">BL Override (+10%)</th>
                <th className="py-3 px-4">Tips Share</th>
                <th className="py-3 px-4">Personal</th>
                <th className="py-3 px-4 font-bold text-slate-900 dark:text-white">Total commission</th>
                <th className="py-3 px-4">Breakdown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {report?.staffCommissions && report.staffCommissions.length > 0 ? (
                report.staffCommissions.map((s) => (
                  <tr key={s.staffId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                      {s.staffName}
                    </td>
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                      {s.roleTitle}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium">
                      {formatMoney(s.courseCommission, currencySymbol)}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium">
                      {formatMoney(s.diveCommission, currencySymbol)}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium">
                      {s.overrideCommission > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400 font-bold">
                          {formatMoney(s.overrideCommission, currencySymbol)}
                        </span>
                      ) : (
                        <span>$0.00</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium">
                      {formatMoney(s.tipsCommission, currencySymbol)}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium">
                      {formatMoney(s.personalCommission, currencySymbol)}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-teal-600 dark:text-teal-400 text-sm">
                      {formatMoney(s.totalCommission, currencySymbol)}
                    </td>
                    <td className="py-3 px-4"><button type="button" className="text-button" onClick={() => setBreakdownStaffId(s.staffId)} aria-label={`Why this amount for ${s.staffName}?`}>Why this amount?</button></td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    No staff commission recorded for this date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScroll>
      </div>

      {/* "Who Did What" Personal Commission Table (PDF Page 6 & 7) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden space-y-4 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              "Who Did What" Personal Commission Detail
            </h3>

          </div>

          <button
            onClick={() =>
              downloadChartCsv(
                'Personal_Commission_Detail',
                ['Date', 'Check', 'Room', 'Guest', 'Item', 'Role', 'Staff', 'Amount'],
                (report?.personalDetails || []).map((p) => [
                  p.businessDate,
                  p.checkNumber,
                  p.roomNumber,
                  p.guestName,
                  p.itemName,
                  p.role,
                  p.staffName,
                  p.amount,
                ])
              )
            }
            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-sm font-semibold text-slate-700 dark:text-slate-200 transition flex items-center space-x-1"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>

        <TableScroll paginate label="Personal commission details" className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm personal-commission-table">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Check #</th>
                <th className="py-3 px-4">Room</th>
                <th className="py-3 px-4">Guest</th>
                <th className="py-3 px-4">Item / Activity</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4 font-bold text-right text-slate-900 dark:text-white">Credited Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {report?.personalDetails && report.personalDetails.length > 0 ? (
                report.personalDetails.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{p.businessDate}</td>
                    <td className="py-3 px-4 font-mono font-bold text-sky-600 dark:text-sky-400">#{p.checkNumber}</td>
                    <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">Room {p.roomNumber}</td>
                    <td className="py-3 px-4 font-medium text-slate-900 dark:text-white">{p.guestName}</td>
                    <td className="py-3 px-4 text-slate-800 dark:text-slate-200">{p.itemName}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                        {p.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{p.staffName}</td>
                    <td className="py-3 px-4 font-mono font-bold text-right text-emerald-600 dark:text-emerald-400">
                      {formatMoney(p.amount, currencySymbol)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No personal commission lines recorded in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScroll>
      </div>
      </section>
  );
}
