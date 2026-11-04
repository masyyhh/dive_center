import { Modal } from '../Modal';

import { CalendarDays, RotateCcw, Trash2 } from 'lucide-react';
import type { BillsModel } from './useBillsController';

export function BillActionDialogs({ model }: { model: BillsModel }) {
  const {
    actionLoading, deleteModalOpen, errorMsg, handleDelete,
    handleRebate, handleRedate, newRedateDate, rebateModalOpen,
    rebateReason, redateModalOpen, selectedBill, setDeleteModalOpen,
    setErrorMsg, setNewRedateDate, setRebateModalOpen, setRebateReason,
    setRedateModalOpen,
  } = model;
  return (
    <>
      {/* Re-date Action Modal */}
      {redateModalOpen && selectedBill && (
        <Modal label="Change business date" onClose={() => { if (!actionLoading) { setRedateModalOpen(false); setErrorMsg(null); } }} busy={actionLoading} error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full p-5 space-y-4">
            <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <CalendarDays className="w-4 h-4 text-sky-500" />
              <span>Re-date Check #{selectedBill.checkNumber}</span>
            </h4>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Move this bill to a different business date. The check number stays the same and an entry is logged in the change log.
            </p>

            <div>
              <label htmlFor="billsview-field-1" className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">
                New Business Date:
              </label>
              <input id="billsview-field-1"
                type="date"
                value={newRedateDate}
                onChange={(e) => setNewRedateDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="dialog-actions flex">
              <button
                type="button"
                onClick={() => setRedateModalOpen(false)}
                className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading || !newRedateDate}
                onClick={handleRedate}
                className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-bold transition"
              >
                {actionLoading ? 'Saving...' : 'Apply Re-date'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Rebate Action Modal */}
      {rebateModalOpen && selectedBill && (
        <Modal label="Rebate bill" onClose={() => { if (!actionLoading) { setRebateModalOpen(false); setErrorMsg(null); } }} busy={actionLoading} error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full p-5 space-y-4">
            <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <RotateCcw className="w-4 h-4 text-amber-500" />
              <span>Rebate Check #{selectedBill.checkNumber}</span>
            </h4>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Reversing this bill zeroes out all staff commissions for this check. The original bill stays on record for audit trails.
            </p>

            <div>
              <label htmlFor="billsview-field-2" className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Reason for Rebate *
              </label>
              <textarea id="billsview-field-2"
                rows={3}
                value={rebateReason}
                onChange={(e) => setRebateReason(e.target.value)}
                placeholder="e.g. Guest had medical issue; dive refunded per doctor note."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="dialog-actions flex">
              <button
                type="button"
                onClick={() => setRebateModalOpen(false)}
                className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading || !rebateReason.trim()}
                onClick={handleRebate}
                className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold transition"
              >
                {actionLoading ? 'Processing...' : 'Confirm Rebate'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Action Modal */}
      {deleteModalOpen && selectedBill && (
        <Modal label="Delete bill" onClose={() => { if (!actionLoading) { setDeleteModalOpen(false); setErrorMsg(null); } }} busy={actionLoading} error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full p-5 space-y-4">
            <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <Trash2 className="w-4 h-4 text-rose-500" />
              <span>Soft-Delete Check #{selectedBill.checkNumber}?</span>
            </h4>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Soft deleting removes this bill from revenue totals and frees check number <strong>#{selectedBill.checkNumber}</strong> so it can be reused. It will remain in administrator history.
            </p>

            <div className="dialog-actions flex">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleDelete}
                className="flex-1 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-bold transition"
              >
                {actionLoading ? 'Deleting...' : 'Confirm Soft Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
