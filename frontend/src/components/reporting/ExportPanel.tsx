import { Download, FileSpreadsheet } from 'lucide-react';

interface ExportPanelProps {
  exportDate: string;
  setExportDate: (date: string) => void;
  exportMonth: string;
  setExportMonth: (month: string) => void;
  lockLoading: boolean;
  payrollLoading: boolean;
  payrollLocked: boolean | null;
  payrollError: string;
  canManageLocks: boolean;
  handleDownloadDaily: () => void;
  handleDownloadMonthly: () => void;
  onConfirmLock: () => void;
  onRetryPayroll: () => void;
}
export function ExportPanel({ exportDate, setExportDate, exportMonth, setExportMonth, lockLoading, payrollLoading, payrollLocked, payrollError, canManageLocks, handleDownloadDaily, handleDownloadMonthly, onConfirmLock, onRetryPayroll }: ExportPanelProps) {
  return (
<section id="panel-exports" role="tabpanel" aria-labelledby="tab-exports" className="space-y-6">
      {/* Export Cards Section (PDF Page 6: Daily & Monthly independent downloads) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Daily Report Download */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm export-card flex flex-col items-stretch justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
              <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
              <span>Daily Report (.xlsx)</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Bills and commissions.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="date"
              aria-label="Daily report date"
              value={exportDate}
              onChange={(e) => setExportDate(e.target.value)}
              className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white"
            />
            <button
              onClick={handleDownloadDaily}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition flex items-center space-x-1 shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
          </div>
        </div>

        {/* Monthly Payroll Workbook Download */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm export-card flex flex-col items-stretch justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
              <FileSpreadsheet className="w-4 h-4 text-sky-500" />
              <span>Monthly Workbook (.xlsx)</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Summary, bills, attendance and staff.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="month"
              aria-label="Payroll workbook month"
              value={exportMonth}
              disabled={lockLoading}
              onChange={(e) => setExportMonth(e.target.value)}
              className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white"
            />
            <button
              onClick={handleDownloadMonthly}
              className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm transition flex items-center space-x-1 shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Workbook</span>
            </button>
          </div>
        </div>
      </div>

        <div className="surface payroll-panel"><div><span className="eyebrow">PAYROLL CONTROL</span><h2>Month lock</h2><p>Locking prevents changes to bills and attendance.</p></div><div className="payroll-control-row"><label htmlFor="payroll-month">Payroll month</label><input id="payroll-month" type="month" value={exportMonth} disabled={lockLoading} onChange={event => setExportMonth(event.target.value)} /><span className={`status-badge ${payrollLocked ? 'status-rebated' : 'status-active'}`}>{payrollLoading ? 'Checking…' : payrollLocked === null ? 'Unavailable' : payrollLocked ? 'Locked' : 'Open'}</span>{canManageLocks && <button className="secondary-button" disabled={payrollLoading || payrollLocked === null || lockLoading} onClick={() => onConfirmLock()}>{payrollLocked ? 'Unlock month' : 'Lock month'}</button>}</div>{!canManageLocks && <p>Your property manager controls payroll locks.</p>}{payrollError && <div className="notice notice-error" role="alert"><span>{payrollError}</span><button onClick={() => onRetryPayroll()}>Retry</button></div>}</div>
      </section>
  );
}
